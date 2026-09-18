// VPC topology: each logical router with the subnets hanging off it and the
// namespaces bound to them.
//
// This is the shape Kube-OVN has that a per-node CNI does not. A pod's network
// is decided by which subnet its namespace is bound to, and which VPC that
// subnet belongs to; two pods in different VPCs cannot reach each other however
// ordinary their Services look. Drawing the tree makes that visible rather than
// something to work out from three kinds of object.

(function () {
    'use strict';

    var kit = window.KubeOVN.kit;
    var model = window.KubeOVN.model;
    var el = kit.el;

    k8sdockside
        .ready()
        .then(start)
        .catch(kit.showError);

    async function start() {
        var view;
        try {
            view = await model.load();
        } catch (err) {
            kit.showError(err);
            return;
        }
        drawIntro(view);
        drawVPCs(view);
        drawOrphans(view);
    }

    function drawIntro(view) {
        var host = kit.clear(document.getElementById('intro'));
        if (!view.vpcs.length) {
            host.appendChild(kit.verdict('warn', 'No VPCs', 'Kube-OVN has no VPCs here.'));
            return;
        }

        var custom = view.vpcs.filter(function (v) {
            return v.name !== 'ovn-cluster';
        });

        host.appendChild(
            kit.verdict(
                view.orphanedSubnets.length ? 'error' : 'ok',
                view.vpcs.length === 1 ? 'One VPC: ' + view.vpcs[0].name : view.vpcs.length + ' VPCs',
                custom.length
                    ? custom.length +
                          ' of them are custom. Pods in different VPCs are isolated from each other by routing, not policy.'
                    : 'Only the default VPC, so every subnet shares one router and everything is mutually routable.'
            )
        );
    }

    function drawVPCs(view) {
        var host = document.getElementById('vpcs');
        kit.clear(host);
        host.hidden = false;

        var body = el('div', {});
        view.groups.forEach(function (group) {
            body.appendChild(vpcBlock(group.vpc, group.subnets));
        });

        host.appendChild(
            kit.section('Routers and their subnets', 'Click a subnet to open it.', view.groups.length ? body : kit.empty('No VPCs.'))
        );
    }

    function vpcBlock(vpc, subnets) {
        var head = el(
            'div',
            { class: 'vpc-head' },
            el('span', { class: 'vpc-name', text: vpc.name }),
            vpc.ready ? kit.badge('ready') : kit.badge('not ready'),
            vpc.enableExternal ? kit.badge('external') : null,
            vpc.enableBfd ? kit.badge('BFD') : null,
            vpc.staticRoutes.length ? kit.badge(vpc.staticRoutes.length + ' static routes') : null,
            el('span', {
                class: 'meter-count',
                text: subnets.length + ' subnet' + (subnets.length === 1 ? '' : 's'),
            })
        );

        var grid = el('div', { class: 'vpc-subnets' });
        subnets.forEach(function (s) {
            var card = kit.subnetCard(s, function () {
                kit.openSubnet(s.name);
            });
            // Which namespaces land here: the subnet's own binding, else the
            // VPC's. A subnet with neither takes whatever the default gives it.
            var bound = s.namespaces.length ? s.namespaces : [];
            card.appendChild(
                el('div', {
                    class: 'subnet-card-cidr',
                    text: bound.length
                        ? 'namespaces: ' + bound.join(', ')
                        : s.isDefault
                          ? 'namespaces: any not bound elsewhere'
                          : 'namespaces: none bound',
                })
            );
            grid.appendChild(card);
        });

        var block = el('div', { class: 'vpc' }, head, subnets.length ? grid : kit.empty('No subnets in this VPC.'));

        if (vpc.namespaces.length) {
            block.appendChild(
                el('div', { class: 'subnet-card-cidr', style: 'margin-top:10px' }, 'VPC namespaces: ' + vpc.namespaces.join(', '))
            );
        }
        if (vpc.staticRoutes.length) {
            var table = el('table', { class: 'rows', style: 'margin-top:10px' });
            table.appendChild(
                el(
                    'thead',
                    {},
                    el('tr', {}, el('th', { text: 'CIDR' }), el('th', { text: 'Next hop' }), el('th', { text: 'Policy' }))
                )
            );
            var tbody = el('tbody', {});
            vpc.staticRoutes.forEach(function (r) {
                tbody.appendChild(
                    el(
                        'tr',
                        {},
                        el('td', { class: 'mono', text: r.cidr || '—' }),
                        el('td', { class: 'mono', text: r.nextHopIP || '—' }),
                        el('td', { text: r.policy || '—' })
                    )
                );
            });
            table.appendChild(tbody);
            block.appendChild(table);
        }

        return block;
    }

    function drawOrphans(view) {
        var host = document.getElementById('orphans');
        kit.clear(host);
        if (!view.orphanedSubnets.length) {
            host.hidden = true;
            return;
        }
        host.hidden = false;

        host.appendChild(
            kit.section(
                'Subnets without a router',
                null,
                kit.problemList(
                    view.orphanedSubnets.map(function (s) {
                        return {
                            tone: 'error',
                            title: s.name + ' points at VPC "' + s.vpc + '", which does not exist',
                            detail: 'Nothing in ' + s.cidrs.join(', ') + ' is routed until that VPC is created or the subnet is repointed.',
                        };
                    })
                )
            )
        );
    }
})();
