// The Kube-OVN panel on a Node: whether this node can carry pod traffic, its
// address on the join subnet, and how many pods hold addresses here.
//
// ovs-ovn and kube-ovn-cni are per-node, and a node whose ovs-ovn is down is
// invisible from anywhere else in the app — the node itself stays Ready.

(function () {
    'use strict';

    var kit = window.KubeOVN.kit;
    var model = window.KubeOVN.model;
    var el = kit.el;

    k8sdockside.ready().then(start).catch(kit.showError);

    async function start() {
        var node = await k8sdockside.object();
        var host = kit.clear(document.getElementById('body'));
        var name = (node.metadata && node.metadata.name) || '';

        var pods = await model.safeList({ kind: 'pods' });
        var onNode = pods.filter(function (p) {
            return p.spec && p.spec.nodeName === name;
        });

        // The two per-node components, judged on this node alone.
        var rows = el('div', {});
        var broken = 0;
        [
            { label: 'ovs-ovn', selector: 'app=ovs' },
            { label: 'kube-ovn-cni', selector: 'app=kube-ovn-cni' },
            { label: 'kube-ovn-pinger', selector: 'app=kube-ovn-pinger', optional: true },
        ].forEach(function (c) {
            var pair = c.selector.split('=');
            var found = onNode.filter(function (p) {
                return ((p.metadata && p.metadata.labels) || {})[pair[0]] === pair[1];
            });
            var ready = found.filter(model.podReady);
            var tone = ready.length ? 'ok' : found.length ? 'error' : c.optional ? 'warn' : 'error';
            if (tone === 'error' && !c.optional) broken++;
            rows.appendChild(
                kit.componentRow({
                    label: c.label,
                    perNode: false,
                    optional: !!c.optional,
                    tone: tone,
                    ready: ready.length,
                    total: found.length,
                    expected: 1,
                    troubles: found.filter(function (p) {
                        return !model.podReady(p);
                    }).map(function (p) {
                        return { name: p.metadata.name, node: name, reason: model.podTrouble(p) };
                    }),
                })
            );
        });

        host.appendChild(
            broken
                ? kit.verdict('error', 'This node has no working dataplane', 'Pods here cannot reach the network, however healthy the node itself looks.')
                : kit.verdict('ok', 'This node can carry pod traffic', null)
        );
        host.appendChild(rows);

        // Addresses held on this node, and its own join-subnet address.
        var ips = (await model.safeList({ kind: model.kind('ips') })).map(model.readIP).filter(function (ip) {
            return ip.node === name;
        });

        var body = el('div', { style: 'margin-top:10px' });
        body.appendChild(kit.field('Addresses held here', String(ips.length)));

        var nodeIP = ips.filter(function (ip) {
            return ip.pod === ('node-' + name) || (ip.subnet === 'join');
        })[0];
        if (nodeIP) {
            body.appendChild(kit.field('On the join subnet', nodeIP.addresses.join(', '), { mono: true }));
        }

        var bySubnet = {};
        ips.forEach(function (ip) {
            if (ip.subnet) bySubnet[ip.subnet] = (bySubnet[ip.subnet] || 0) + 1;
        });
        Object.keys(bySubnet)
            .sort()
            .forEach(function (s) {
                body.appendChild(kit.field(s, bySubnet[s] + ' addresses'));
            });

        host.appendChild(body);
        resize();
    }

    function resize() {
        if (k8sdockside.resize) k8sdockside.resize(document.body.scrollHeight + 12);
    }
})();
