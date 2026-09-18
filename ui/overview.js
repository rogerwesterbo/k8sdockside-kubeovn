// The overview: is Kube-OVN actually carrying traffic, what does this network
// look like, and what needs attention.
//
// The component list is deliberately first among equals. Kube-OVN's control
// plane and its dataplane fail independently: ovn-central and the controller can
// be green — subnets reconciled, addresses allocated, every object healthy —
// while ovs-ovn crash-loops on every node and nothing can actually talk. A page
// that only listed custom resources would call that cluster fine.

(function () {
    'use strict';

    var kit = window.KubeOVN.kit;
    var model = window.KubeOVN.model;
    var el = kit.el;

    k8sdockside
        .ready()
        .then(render)
        .catch(kit.showError);

    async function render() {
        var view;
        try {
            view = await model.load();
        } catch (err) {
            kit.showError(err);
            return;
        }

        drawVerdict(view);
        drawSummary(view);
        drawComponents(view);
        drawAttention(view);
        drawSubnets(view);
        await drawEvents();
    }

    function drawVerdict(view) {
        var host = kit.clear(document.getElementById('verdict'));

        var dataplane = view.components.filter(function (c) {
            return c.id === 'ovs-ovn' || c.id === 'kube-ovn-cni';
        });
        var dataplaneBroken = dataplane.filter(function (c) {
            return c.tone === 'error';
        });
        var controlPlaneOK = view.components.every(function (c) {
            return c.perNode || c.tone === 'ok';
        });

        var tone;
        var headline;
        var detail;

        if (!view.subnets.length && !view.vpcs.length) {
            tone = 'warn';
            headline = 'Kube-OVN does not appear to be installed here';
            detail = 'No subnets and no VPCs. If this cluster uses another CNI, that plugin will have more to say.';
        } else if (dataplaneBroken.length && controlPlaneOK) {
            // The failure worth stating plainly, because everything else looks fine.
            tone = 'error';
            headline = 'The control plane is healthy but the dataplane is not';
            detail =
                dataplaneBroken
                    .map(function (c) {
                        return c.label + ' is ready on ' + c.ready + ' of ' + c.expected + ' nodes';
                    })
                    .join('; ') +
                '. Subnets and addresses will look correct while no pod on those nodes can reach the network.';
        } else if (worst(view.problems) === 'error') {
            tone = 'error';
            headline = 'Kube-OVN is not healthy';
            detail = 'What is wrong is listed below.';
        } else if (worst(view.problems) === 'warn') {
            tone = 'warn';
            headline = 'Kube-OVN is up, with something worth a look';
            detail = view.subnets.length + ' subnets across ' + view.vpcs.length + ' VPCs.';
        } else {
            tone = 'ok';
            headline = 'Kube-OVN is healthy';
            detail =
                view.subnets.length +
                ' subnets across ' +
                view.vpcs.length +
                ' VPC' +
                (view.vpcs.length === 1 ? '' : 's') +
                ', ' +
                view.ips.length +
                ' addresses handed out.';
        }

        host.appendChild(kit.verdict(tone, headline, detail));
    }

    function worst(problems) {
        var tone = 'none';
        problems.forEach(function (p) {
            if (p.tone === 'error') tone = 'error';
            else if (p.tone === 'warn' && tone !== 'error') tone = 'warn';
        });
        return tone;
    }

    function drawSummary(view) {
        var host = document.getElementById('summary');
        kit.clear(host);
        host.hidden = false;

        var used = 0;
        var free = 0;
        view.subnets.forEach(function (s) {
            s.families.forEach(function (f) {
                if (f.version !== 4) return;
                used += f.used;
                free += f.available;
            });
        });

        var stats = el(
            'div',
            { class: 'stats' },
            kit.stat(view.vpcs.length, 'VPCs'),
            kit.stat(view.subnets.length, 'subnets'),
            kit.stat(view.ips.length, 'addresses held'),
            kit.stat(used.toLocaleString(), 'IPv4 in use'),
            kit.stat(free.toLocaleString(), 'IPv4 free')
        );

        var chips = el('div', { class: 'chips' });
        var def = view.subnets.filter(function (s) {
            return s.isDefault;
        })[0];
        if (def) {
            chips.appendChild(kit.chip('Default subnet', def.name));
            chips.appendChild(kit.chip('Pod network', def.cidrs.join(', ')));
            if (def.protocol) chips.appendChild(kit.chip('Protocol', def.protocol));
            chips.appendChild(kit.chip('NAT outgoing', def.natOutgoing ? 'on' : 'off'));
            if (def.gatewayType) chips.appendChild(kit.chip('Gateway', def.gatewayType));
        }
        chips.appendChild(kit.chip('Nodes', view.nodes.length));

        host.appendChild(
            kit.section(
                'This network',
                'Address counts are Kube-OVN’s own, from each subnet’s status.',
                el('div', {}, stats, el('div', { style: 'height:12px' }), chips)
            )
        );
    }

    function drawComponents(view) {
        var host = kit.clear(document.getElementById('components'));
        document.getElementById('columns').hidden = false;

        var body = el('div', {});
        view.components.forEach(function (c) {
            body.appendChild(kit.componentRow(c));
        });

        host.appendChild(
            kit.section(
                'Kube-OVN itself',
                'ovs-ovn and kube-ovn-cni run on every node; the rest is the control plane.',
                body
            )
        );
    }

    function drawAttention(view) {
        var host = kit.clear(document.getElementById('attention'));
        host.appendChild(
            kit.section(
                'What needs attention',
                null,
                view.problems.length
                    ? kit.problemList(view.problems)
                    : kit.empty('Nothing. Every component is serving and every subnet has room.')
            )
        );
    }

    function drawSubnets(view) {
        var host = document.getElementById('subnets');
        kit.clear(host);
        if (!view.subnets.length) {
            host.hidden = true;
            return;
        }
        host.hidden = false;

        var grid = el('div', { class: 'vpc-subnets' });
        view.subnets.forEach(function (s) {
            grid.appendChild(
                kit.subnetCard(s, function () {
                    kit.openSubnet(s.name);
                })
            );
        });

        host.appendChild(kit.section('Subnets', 'Click one to open it.', grid));
    }

    async function drawEvents() {
        var host = document.getElementById('events');
        var events = await model.safeList({ kind: 'events' });
        var mine = events
            .filter(function (e) {
                var name = (e.involvedObject && e.involvedObject.name) || '';
                var component = (e.source && e.source.component) || '';
                return name.indexOf('ovn') >= 0 || name.indexOf('ovs') >= 0 || component.indexOf('ovn') >= 0;
            })
            .sort(function (a, b) {
                return Date.parse(b.lastTimestamp || b.eventTime || 0) - Date.parse(a.lastTimestamp || a.eventTime || 0);
            })
            .slice(0, 12);

        if (!mine.length) {
            host.hidden = true;
            return;
        }
        host.hidden = false;
        kit.clear(host);

        var table = el('table', { class: 'rows' });
        table.appendChild(
            el(
                'thead',
                {},
                el(
                    'tr',
                    {},
                    el('th', { text: 'When' }),
                    el('th', { text: 'Reason' }),
                    el('th', { text: 'Object' }),
                    el('th', { text: 'Message' })
                )
            )
        );
        var tbody = el('tbody', {});
        mine.forEach(function (e) {
            tbody.appendChild(
                el(
                    'tr',
                    {},
                    el('td', { text: kit.relative(e.lastTimestamp || e.eventTime) }),
                    el('td', { class: e.type === 'Warning' ? 'tone-warn' : '', text: e.reason || '' }),
                    el('td', { class: 'mono', text: (e.involvedObject && e.involvedObject.name) || '' }),
                    el('td', { text: e.message || '' })
                )
            );
        });
        table.appendChild(tbody);
        host.appendChild(kit.section('Recent events', null, table));
    }
})();
