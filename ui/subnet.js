// The Addresses panel on a Subnet: its usage per family and who holds what.

(function () {
    'use strict';

    var kit = window.KubeOVN.kit;
    var model = window.KubeOVN.model;
    var el = kit.el;

    k8sdockside.ready().then(start).catch(kit.showError);

    async function start() {
        var obj = await k8sdockside.object();
        var host = kit.clear(document.getElementById('body'));
        var subnet = model.readSubnet(obj);

        if (!subnet.reconciled) {
            host.appendChild(
                kit.verdict(
                    'warn',
                    'No IPAM status yet',
                    'kube-ovn-controller has not published how many addresses this subnet holds. It may have only just been created — or the controller is not running.'
                )
            );
            return resize();
        }

        var body = el('div', {});
        subnet.families.forEach(function (f) {
            body.appendChild(kit.usageMeter(f));
        });

        var facts = el('div', { class: 'chips', style: 'margin-top:12px' });
        if (subnet.vpc) facts.appendChild(kit.chip('VPC', subnet.vpc));
        if (subnet.protocol) facts.appendChild(kit.chip('Protocol', subnet.protocol));
        if (subnet.gateways.length) facts.appendChild(kit.chip('Gateway', subnet.gateways.join(', ')));
        if (subnet.gatewayType) facts.appendChild(kit.chip('Gateway type', subnet.gatewayType));
        if (subnet.natOutgoing) facts.appendChild(kit.chip('NAT outgoing', 'on'));
        if (subnet.private) facts.appendChild(kit.chip('Private', 'yes'));
        body.appendChild(facts);

        host.appendChild(body);

        var ips = (await model.safeList({ kind: model.kind('ips') }))
            .map(model.readIP)
            .filter(function (ip) {
                return ip.subnet === subnet.name;
            })
            .sort(function (a, b) {
                return (a.node || '').localeCompare(b.node || '');
            });

        if (ips.length) {
            var table = el('table', { class: 'rows', style: 'margin-top:12px' });
            table.appendChild(
                el(
                    'thead',
                    {},
                    el('tr', {}, el('th', { text: 'Address' }), el('th', { text: 'Held by' }), el('th', { text: 'Node' }))
                )
            );
            var tbody = el('tbody', {});
            ips.forEach(function (ip) {
                var row = el(
                    'tr',
                    { class: ip.pod ? 'is-clickable' : '' },
                    el('td', { class: 'mono', text: ip.addresses.join(', ') }),
                    el('td', { text: ip.pod ? (ip.namespace ? ip.namespace + '/' + ip.pod : ip.pod) : '—' }),
                    el('td', { text: ip.node || '—' })
                );
                if (ip.pod && ip.namespace) {
                    row.onclick = function () {
                        k8sdockside.open({ kind: 'pods', namespace: ip.namespace, name: ip.pod });
                    };
                }
                tbody.appendChild(row);
            });
            table.appendChild(tbody);
            host.appendChild(table);
        }

        resize();
    }

    function resize() {
        if (k8sdockside.resize) k8sdockside.resize(document.body.scrollHeight + 12);
    }
})();
