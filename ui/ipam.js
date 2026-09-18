// Subnets & IPAM: every subnet with what it has handed out against what it has
// left, and the addresses in it listed by who holds each one.
//
// The counts come from each subnet's status, which is what Kube-OVN's IPAM
// allocates against. The address list comes from the IP objects. They can
// disagree while the controller catches up, and when they do the page says so
// rather than quietly showing one of them.

(function () {
    'use strict';

    var kit = window.KubeOVN.kit;
    var model = window.KubeOVN.model;
    var el = kit.el;

    var view = null;
    var selected = null;

    k8sdockside
        .ready()
        .then(start)
        .catch(kit.showError);

    async function start() {
        try {
            view = await model.load();
        } catch (err) {
            kit.showError(err);
            return;
        }
        if (view.subnets.length) selected = view.subnets[0].name;
        draw();
    }

    function draw() {
        drawIntro();
        drawSubnets();
        drawAddresses();
    }

    function drawIntro() {
        var host = kit.clear(document.getElementById('intro'));
        if (!view.subnets.length) {
            host.appendChild(
                kit.verdict('warn', 'No subnets', 'Kube-OVN has no subnets here, so there is no IPAM to show.')
            );
            return;
        }

        var tight = view.subnets.filter(function (s) {
            return s.families.some(function (f) {
                return f.total > 0 && f.fraction >= 0.9;
            });
        });

        host.appendChild(
            tight.length
                ? kit.verdict(
                      'warn',
                      tight.length === 1
                          ? 'One subnet is nearly full'
                          : tight.length + ' subnets are nearly full',
                      tight
                          .map(function (s) {
                              return s.name;
                          })
                          .join(', ') + ' — a pod that asks for an address when one runs out will not start.'
                  )
                : kit.verdict(
                      'ok',
                      view.subnets.length + ' subnets, ' + view.ips.length + ' addresses handed out',
                      'Every subnet has room.'
                  )
        );
    }

    function drawSubnets() {
        var host = document.getElementById('subnets');
        kit.clear(host);
        host.hidden = false;

        var grid = el('div', { class: 'vpc-subnets' });
        view.subnets.forEach(function (s) {
            var card = kit.subnetCard(s, function () {
                selected = s.name;
                draw();
            });
            if (s.name === selected) card.className += ' is-selected';
            grid.appendChild(card);
        });

        host.appendChild(
            kit.section(
                'Subnets',
                'Used against free, from each subnet’s own status. Click one to list its addresses.',
                grid
            )
        );
    }

    function drawAddresses() {
        var host = document.getElementById('addresses');
        kit.clear(host);
        host.hidden = false;

        var subnet = view.subnets.filter(function (s) {
            return s.name === selected;
        })[0];
        if (!subnet) {
            host.hidden = true;
            return;
        }

        var ips = (view.ipsBySubnet[subnet.name] || []).slice().sort(function (a, b) {
            return (a.node || '').localeCompare(b.node || '') || (a.pod || '').localeCompare(b.pod || '');
        });

        var body = el('div', {});

        // Detail Kube-OVN keeps but does not show anywhere obvious.
        var facts = el('div', { class: 'chips' });
        if (subnet.vpc) facts.appendChild(kit.chip('VPC', subnet.vpc));
        if (subnet.gateways.length) facts.appendChild(kit.chip('Gateway', subnet.gateways.join(', ')));
        if (subnet.provider) facts.appendChild(kit.chip('Provider', subnet.provider));
        if (subnet.gatewayNode) facts.appendChild(kit.chip('Gateway node', subnet.gatewayNode));
        if (subnet.excludeIps.length) facts.appendChild(kit.chip('Excluded', subnet.excludeIps.join(', ')));
        if (subnet.namespaces.length) facts.appendChild(kit.chip('Namespaces', subnet.namespaces.join(', ')));
        body.appendChild(facts);

        // Where the two sources of truth disagree, say which is which.
        var counted = ips.length;
        var claimed = subnet.families.length ? subnet.families[0].used : null;
        if (claimed !== null && counted !== claimed) {
            body.appendChild(
                el('div', { style: 'height:10px' }),
                kit.problemList([
                    {
                        tone: 'info',
                        title: 'The status and the IP objects disagree',
                        detail:
                            'The subnet’s status says ' +
                            claimed +
                            ' addresses are in use; ' +
                            counted +
                            ' IP objects name this subnet. The status is what IPAM allocates against; the difference is usually the controller catching up, or addresses held for nodes rather than pods.',
                    },
                ])
            );
        }

        var table = el('table', { class: 'rows' });
        table.appendChild(
            el(
                'thead',
                {},
                el(
                    'tr',
                    {},
                    el('th', { text: 'Address' }),
                    el('th', { text: 'Held by' }),
                    el('th', { text: 'Namespace' }),
                    el('th', { text: 'Node' }),
                    el('th', { text: 'MAC' })
                )
            )
        );
        var tbody = el('tbody', {});
        ips.forEach(function (ip) {
            var row = el(
                'tr',
                { class: ip.pod ? 'is-clickable' : '' },
                el('td', { class: 'mono', text: ip.addresses.join(', ') }),
                el('td', { text: ip.pod || '—' }),
                el('td', { text: ip.namespace || '—' }),
                el('td', { text: ip.node || '—' }),
                el('td', { class: 'mono', text: ip.mac || '—' })
            );
            if (ip.pod && ip.namespace) {
                row.onclick = function () {
                    k8sdockside.open({ kind: 'pods', namespace: ip.namespace, name: ip.pod });
                };
            }
            tbody.appendChild(row);
        });
        table.appendChild(tbody);

        body.appendChild(el('div', { style: 'height:12px' }));
        body.appendChild(ips.length ? table : kit.empty('No IP objects name this subnet.'));

        host.appendChild(
            kit.section(
                'Addresses in ' + subnet.name,
                ips.length ? 'Click a row to open the pod holding it.' : null,
                body
            )
        );
    }
})();
