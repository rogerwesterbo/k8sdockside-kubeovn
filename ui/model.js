// What the pages know about Kube-OVN.
//
// Kube-OVN keeps its own accounting: a Subnet's status carries how many
// addresses are used and available per family, and every allocated address is a
// real IP object naming the pod and node that hold it. So this file reads that
// rather than counting subnets by hand — the numbers on the page are the ones
// kube-ovn-controller itself published.
//
// Everything below the loaders is pure: objects in, objects out.

(function () {
    'use strict';

    var GROUP = '.kubeovn.io';

    function kind(plural) {
        return 'crd:' + plural + GROUP;
    }

    // The components Kube-OVN needs, and what each one failing actually breaks.
    // ovs-ovn is the one worth naming: the control plane stays green while it
    // crash-loops, and nothing on that node can reach the network.
    var COMPONENTS = [
        {
            id: 'ovn-central',
            label: 'ovn-central',
            selector: 'app=ovn-central',
            perNode: false,
            breaks: 'The OVN northbound and southbound databases. Without it no new address or route can be programmed.',
        },
        {
            id: 'kube-ovn-controller',
            label: 'kube-ovn-controller',
            selector: 'app=kube-ovn-controller',
            perNode: false,
            breaks: 'The controller that turns Subnets, VPCs and Pods into OVN objects. Existing traffic keeps flowing; nothing new is set up.',
        },
        {
            id: 'ovs-ovn',
            label: 'ovs-ovn',
            selector: 'app=ovs',
            perNode: true,
            breaks: 'Open vSwitch and ovn-controller on the node. Where this is down the node has no dataplane at all, however healthy the control plane looks.',
        },
        {
            id: 'kube-ovn-cni',
            label: 'kube-ovn-cni',
            selector: 'app=kube-ovn-cni',
            perNode: true,
            breaks: 'The CNI binary and the daemon that wires a pod up when it starts. Pods scheduled to this node will not get an address.',
        },
        {
            id: 'kube-ovn-pinger',
            label: 'kube-ovn-pinger',
            selector: 'app=kube-ovn-pinger',
            perNode: true,
            optional: true,
            breaks: 'Only the latency and packet-loss metrics. Traffic is unaffected.',
        },
    ];

    // ---------------------------------------------------------------- subnets

    // readSubnet reduces a Subnet to what the pages draw. The status fields are
    // Kube-OVN's own IPAM accounting; when a subnet has just been created they
    // are absent, which is different from being zero.
    function readSubnet(obj) {
        var meta = obj.metadata || {};
        var spec = obj.spec || {};
        var status = obj.status || {};

        var families = [];
        if (has(status.v4usingIPs) || has(status.v4availableIPs)) {
            families.push(family(4, status.v4usingIPs, status.v4availableIPs, status.v4usingIPrange, status.v4availableIPrange));
        }
        if (has(status.v6usingIPs) || has(status.v6availableIPs)) {
            families.push(family(6, status.v6usingIPs, status.v6availableIPs, status.v6usingIPrange, status.v6availableIPrange));
        }

        return {
            name: meta.name || '',
            cidrs: splitList(spec.cidrBlock),
            gateways: splitList(spec.gateway),
            protocol: spec.protocol || null,
            vpc: spec.vpc || null,
            provider: spec.provider || null,
            isDefault: !!spec.default,
            natOutgoing: !!spec.natOutgoing,
            private: !!spec.private,
            gatewayType: spec.gatewayType || null,
            gatewayNode: spec.gatewayNode || null,
            vlan: spec.vlan || null,
            namespaces: Array.isArray(spec.namespaces) ? spec.namespaces.slice() : [],
            excludeIps: Array.isArray(spec.excludeIps) ? spec.excludeIps.slice() : [],
            families: families,
            // No status yet means the controller has not reconciled it.
            reconciled: families.length > 0,
            conditions: readConditions(status.conditions),
            raw: obj,
        };
    }

    function family(version, using, available, usingRange, availableRange) {
        var used = Number(using) || 0;
        var free = Number(available) || 0;
        var total = used + free;
        return {
            version: version,
            used: used,
            available: free,
            total: total,
            // Share of the addresses the subnet manages that are handed out.
            fraction: total > 0 ? used / total : 0,
            usingRange: usingRange || null,
            availableRange: availableRange || null,
        };
    }

    function has(v) {
        return v !== undefined && v !== null;
    }

    function splitList(value) {
        if (typeof value !== 'string' || !value) return [];
        return value
            .split(',')
            .map(function (s) {
                return s.trim();
            })
            .filter(Boolean);
    }

    // readConditions keeps the ones that are not "everything is fine".
    function readConditions(conditions) {
        if (!Array.isArray(conditions)) return [];
        return conditions
            .filter(function (c) {
                if (!c || !c.type) return false;
                // Kube-OVN uses Ready/Validated true = good.
                return c.status === 'False';
            })
            .map(function (c) {
                return { type: c.type, reason: c.reason || '', message: c.message || '' };
            });
    }

    // -------------------------------------------------------------------- VPCs

    function readVPC(obj) {
        var meta = obj.metadata || {};
        var spec = obj.spec || {};
        var status = obj.status || {};
        return {
            name: meta.name || '',
            namespaces: Array.isArray(spec.namespaces) ? spec.namespaces.slice() : [],
            staticRoutes: Array.isArray(spec.staticRoutes) ? spec.staticRoutes.slice() : [],
            enableExternal: !!spec.enableExternal,
            enableBfd: !!spec.enableBfd,
            subnets: Array.isArray(status.subnets) ? status.subnets.slice() : [],
            defaultLogicalSwitch: status.defaultLogicalSwitch || null,
            router: status.router || null,
            standby: status.standby !== false,
            ready: status.ready !== false,
            raw: obj,
        };
    }

    // --------------------------------------------------------------- addresses

    function readIP(obj) {
        var meta = obj.metadata || {};
        var spec = obj.spec || {};
        return {
            name: meta.name || '',
            addresses: splitList(spec.ipAddress),
            v4: spec.v4IpAddress || null,
            v6: spec.v6IpAddress || null,
            mac: spec.macAddress || null,
            node: spec.nodeName || null,
            pod: spec.podName || null,
            namespace: spec.namespace || null,
            subnet: spec.subnet || null,
            podType: spec.podType || '',
            raw: obj,
        };
    }

    // ------------------------------------------------------------- components

    // readComponents works out what is serving and what is not. A daemonset is
    // judged against the nodes it should cover, a deployment against its
    // replicas, because "2 of 3" means something different in each case.
    function readComponents(pods, nodeCount) {
        return COMPONENTS.map(function (c) {
            var mine = pods.filter(function (p) {
                var labels = (p.metadata && p.metadata.labels) || {};
                var pair = c.selector.split('=');
                return labels[pair[0]] === pair[1];
            });

            var ready = mine.filter(function (p) {
                return podReady(p);
            });
            var expected = c.perNode ? nodeCount : Math.max(1, mine.length);

            var tone = 'ok';
            if (!mine.length) tone = c.optional ? 'warn' : 'error';
            else if (!ready.length) tone = 'error';
            else if (ready.length < expected) tone = 'warn';

            return {
                id: c.id,
                label: c.label,
                selector: c.selector,
                perNode: c.perNode,
                optional: !!c.optional,
                breaks: c.breaks,
                pods: mine,
                ready: ready.length,
                total: mine.length,
                expected: expected,
                tone: tone,
                troubles: mine
                    .filter(function (p) {
                        return !podReady(p);
                    })
                    .map(function (p) {
                        return {
                            name: p.metadata.name,
                            node: (p.spec && p.spec.nodeName) || null,
                            reason: podTrouble(p),
                        };
                    }),
            };
        });
    }

    function podReady(pod) {
        var status = pod.status || {};
        if (status.phase !== 'Running') return false;
        var conds = status.conditions || [];
        for (var i = 0; i < conds.length; i++) {
            if (conds[i].type === 'Ready') return conds[i].status === 'True';
        }
        // No Ready condition yet: fall back to the container statuses.
        var cs = status.containerStatuses || [];
        return cs.length > 0 && cs.every(function (c) {
            return c.ready;
        });
    }

    // podTrouble returns a short reason a pod is not serving.
    function podTrouble(pod) {
        var status = pod.status || {};
        if (status.phase && status.phase !== 'Running' && status.phase !== 'Succeeded') {
            var init = status.initContainerStatuses || [];
            for (var j = 0; j < init.length; j++) {
                if (!init[j].ready && init[j].state && init[j].state.waiting && init[j].state.waiting.reason) {
                    return 'init: ' + init[j].state.waiting.reason;
                }
            }
            return status.reason || status.phase;
        }
        var cs = status.containerStatuses || [];
        for (var i = 0; i < cs.length; i++) {
            if (cs[i].ready) continue;
            var state = cs[i].state || {};
            if (state.waiting && state.waiting.reason) return state.waiting.reason;
            if (state.terminated && state.terminated.reason) return state.terminated.reason;
            return 'not ready';
        }
        // Running, all containers ready, but the pod is not: an init container
        // is usually still going.
        var initPending = (status.initContainerStatuses || []).filter(function (c) {
            return !c.ready;
        });
        if (initPending.length) return 'waiting on init';
        return 'not ready';
    }

    // ----------------------------------------------------------------- the whole

    function build(input) {
        var subnets = (input.subnets || []).map(readSubnet);
        var vpcs = (input.vpcs || []).map(readVPC);
        var ips = (input.ips || []).map(readIP);
        var nodes = input.nodes || [];
        var components = readComponents(input.pods || [], nodes.length);

        // Hang subnets off their VPC, and note any that point at one that is
        // not there — those pods get no routing.
        var byVPC = {};
        vpcs.forEach(function (v) {
            byVPC[v.name] = { vpc: v, subnets: [] };
        });
        var orphaned = [];
        subnets.forEach(function (s) {
            if (s.vpc && byVPC[s.vpc]) byVPC[s.vpc].subnets.push(s);
            else if (s.vpc) orphaned.push(s);
        });

        // Addresses per subnet, so a subnet can list who holds what.
        var ipsBySubnet = {};
        ips.forEach(function (ip) {
            if (!ip.subnet) return;
            (ipsBySubnet[ip.subnet] = ipsBySubnet[ip.subnet] || []).push(ip);
        });

        subnets.sort(function (a, b) {
            if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        return {
            subnets: subnets,
            vpcs: vpcs,
            ips: ips,
            nodes: nodes,
            components: components,
            groups: Object.keys(byVPC).map(function (k) {
                return byVPC[k];
            }),
            orphanedSubnets: orphaned,
            ipsBySubnet: ipsBySubnet,
            problems: findProblems(subnets, vpcs, components, orphaned),
        };
    }

    // findProblems names what is wrong, worst first.
    function findProblems(subnets, vpcs, components, orphaned) {
        var problems = [];

        components.forEach(function (c) {
            if (c.tone === 'ok') return;
            var title;
            if (!c.total) title = c.label + ' is not running at all';
            else if (c.perNode) title = c.label + ' is ready on ' + c.ready + ' of ' + c.expected + ' nodes';
            else title = c.label + ' is ready on ' + c.ready + ' of ' + c.total + ' pods';

            var detail = c.breaks;
            if (c.troubles.length) {
                detail +=
                    ' Not serving: ' +
                    c.troubles
                        .slice(0, 6)
                        .map(function (t) {
                            return t.name + (t.reason ? ' (' + t.reason + ')' : '');
                        })
                        .join(', ') +
                    '.';
            }
            problems.push({ id: 'component-' + c.id, tone: c.optional ? 'warn' : c.tone, title: title, detail: detail });
        });

        subnets.forEach(function (s) {
            if (!s.reconciled) {
                problems.push({
                    id: 'unreconciled-' + s.name,
                    tone: 'warn',
                    title: 'Subnet ' + s.name + ' has no IPAM status yet',
                    detail: 'kube-ovn-controller has not published how many addresses it holds. It may have only just been created — or the controller is not running.',
                });
            }
            s.conditions.forEach(function (c) {
                problems.push({
                    id: 'subnet-' + s.name + '-' + c.type,
                    tone: 'error',
                    title: 'Subnet ' + s.name + ' is not ' + c.type,
                    detail: (c.reason ? c.reason + ': ' : '') + (c.message || 'No message given.'),
                });
            });
            s.families.forEach(function (f) {
                if (f.total > 0 && f.fraction >= 0.9) {
                    problems.push({
                        id: 'full-' + s.name + '-v' + f.version,
                        tone: f.fraction >= 0.98 ? 'error' : 'warn',
                        title:
                            'Subnet ' + s.name + ' is ' + Math.round(f.fraction * 100) + '% full (IPv' + f.version + ')',
                        detail: f.available + ' addresses left of ' + f.total + '. New pods in this subnet will fail to get one when it runs out.',
                    });
                }
            });
        });

        orphaned.forEach(function (s) {
            problems.push({
                id: 'orphan-' + s.name,
                tone: 'error',
                title: 'Subnet ' + s.name + ' names a VPC that does not exist',
                detail: 'It points at "' + s.vpc + '". Without a router, nothing in this subnet is routed.',
            });
        });

        vpcs.forEach(function (v) {
            if (!v.ready) {
                problems.push({
                    id: 'vpc-' + v.name,
                    tone: 'error',
                    title: 'VPC ' + v.name + ' is not ready',
                    detail: 'Its logical router has not been programmed.',
                });
            }
        });

        var defaults = subnets.filter(function (s) {
            return s.isDefault;
        });
        if (!defaults.length && subnets.length) {
            problems.push({
                id: 'no-default-subnet',
                tone: 'warn',
                title: 'No subnet is marked default',
                detail: 'Pods in a namespace that is not bound to a subnet have nowhere to get an address from.',
            });
        } else if (defaults.length > 1) {
            problems.push({
                id: 'many-default-subnets',
                tone: 'error',
                title: 'More than one subnet is marked default',
                detail:
                    defaults
                        .map(function (s) {
                            return s.name;
                        })
                        .join(', ') + ' all claim it. Which one a pod gets is not defined.',
            });
        }

        return problems;
    }

    // ------------------------------------------------------------------ loading

    async function load() {
        var subnets = await safeList({ kind: kind('subnets') });
        var vpcs = await safeList({ kind: kind('vpcs') });
        var ips = await safeList({ kind: kind('ips') });
        var nodes = await safeList({ kind: 'nodes' });
        var pods = await safeList({ kind: 'pods' });

        return build({ subnets: subnets, vpcs: vpcs, ips: ips, nodes: nodes, pods: pods });
    }

    async function safeList(query) {
        try {
            var items = await k8sdockside.list(query);
            return Array.isArray(items) ? items : [];
        } catch (err) {
            // A kind that is not installed is not an error worth a banner: the
            // page shows what it could read and says what was missing.
            return [];
        }
    }

    window.KubeOVN = window.KubeOVN || {};
    window.KubeOVN.model = {
        GROUP: GROUP,
        kind: kind,
        COMPONENTS: COMPONENTS,
        readSubnet: readSubnet,
        readVPC: readVPC,
        readIP: readIP,
        readComponents: readComponents,
        podReady: podReady,
        podTrouble: podTrouble,
        splitList: splitList,
        build: build,
        findProblems: findProblems,
        load: load,
        safeList: safeList,
    };
})();
