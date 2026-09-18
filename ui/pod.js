// The Kube-OVN panel on a Pod: the IP object Kube-OVN keeps for it, which
// subnet and VPC it lives in, and whether the node it runs on can actually
// carry its traffic.
//
// That last part is the one worth having here: a pod can hold a perfectly good
// address in a healthy subnet and still be unreachable because ovs-ovn is down
// on its node.

(function () {
    'use strict';

    var kit = window.KubeOVN.kit;
    var model = window.KubeOVN.model;
    var el = kit.el;

    k8sdockside.ready().then(start).catch(kit.showError);

    async function start() {
        var pod = await k8sdockside.object();
        var host = kit.clear(document.getElementById('body'));
        var spec = pod.spec || {};
        var status = pod.status || {};
        var meta = pod.metadata || {};

        if (spec.hostNetwork) {
            host.appendChild(
                kit.verdict(
                    'ok',
                    'This pod is on the host network',
                    'It shares ' + (spec.nodeName || 'its node') + '’s addresses and does not get one from Kube-OVN.'
                )
            );
            return resize();
        }

        var body = el('div', {});
        body.appendChild(kit.field('Pod address', status.podIP || 'none yet', { mono: true, tone: status.podIP ? '' : 'warn' }));

        // Kube-OVN names its IP objects <pod>.<namespace>.
        var ips = await model.safeList({ kind: model.kind('ips') });
        var mine = ips
            .map(model.readIP)
            .filter(function (ip) {
                return ip.pod === meta.name && ip.namespace === meta.namespace;
            })[0];

        if (mine) {
            body.appendChild(kit.field('MAC', mine.mac, { mono: true }));
            body.appendChild(kit.field('Subnet', mine.subnet, { mono: true }));
            if (mine.v6) body.appendChild(kit.field('IPv6', mine.v6, { mono: true }));

            var subnets = await model.safeList({ kind: model.kind('subnets') });
            var subnet = subnets.map(model.readSubnet).filter(function (s) {
                return s.name === mine.subnet;
            })[0];
            if (subnet) {
                if (subnet.vpc) body.appendChild(kit.field('VPC', subnet.vpc));
                if (subnet.gateways.length) body.appendChild(kit.field('Gateway', subnet.gateways.join(', '), { mono: true }));
                body.appendChild(kit.field('NAT outgoing', subnet.natOutgoing ? 'on' : 'off'));
                if (subnet.private) body.appendChild(kit.field('Subnet is private', 'yes', { tone: 'warn' }));
            }
        } else if (status.podIP) {
            body.appendChild(
                kit.field('Kube-OVN IP object', 'none found for this pod', { tone: 'warn' })
            );
        }

        host.appendChild(body);

        // Can the node this pod runs on actually carry traffic?
        if (spec.nodeName) {
            var pods = await model.safeList({ kind: 'pods' });
            var onNode = pods.filter(function (p) {
                return p.spec && p.spec.nodeName === spec.nodeName;
            });
            var broken = [];
            // The label value is not the component's name ("app=ovs" is
            // ovs-ovn), so each carries the name to show.
            [
                { label: 'ovs-ovn', selector: 'app=ovs' },
                { label: 'kube-ovn-cni', selector: 'app=kube-ovn-cni' },
            ].forEach(function (c) {
                var pair = c.selector.split('=');
                var found = onNode.filter(function (p) {
                    return ((p.metadata && p.metadata.labels) || {})[pair[0]] === pair[1];
                });
                if (!found.length) broken.push(c.label + ' is not running on ' + spec.nodeName);
                else if (!found.some(model.podReady)) {
                    broken.push(c.label + ' on ' + spec.nodeName + ': ' + model.podTrouble(found[0]));
                }
            });
            if (broken.length) {
                host.appendChild(
                    kit.problemList([
                        {
                            tone: 'error',
                            title: 'This pod’s node has no working dataplane',
                            detail: broken.join('; ') + '. The address above is allocated, but traffic will not flow.',
                        },
                    ])
                );
            }
        }

        resize();
    }

    function resize() {
        if (k8sdockside.resize) k8sdockside.resize(document.body.scrollHeight + 12);
    }
})();
