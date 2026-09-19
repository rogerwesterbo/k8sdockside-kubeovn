# Kube-OVN for K8s Dockside

A plugin for the [K8s Dockside](https://github.com/k8sdockside/k8sdockside)
desktop app that shows [Kube-OVN](https://github.com/kubeovn/kube-ovn) as the
shape it actually has: VPCs are logical routers, subnets are logical switches
with their own IPAM, and every pod address is an object you can look up. Plain
HTML and script, no build step. Needs **K8s Dockside 0.0.27 or newer**;
Prometheus is optional, for charts.

## What it shows

- **Overview** — whether Kube-OVN is carrying traffic, the size of the network,
  every component with what its failure would break, what needs attention, the
  subnets, and Kube-OVN's recent events.
- **Subnets & IPAM** — every subnet with what it has handed out against what it
  has left, per address family, plus the in-use and free ranges Kube-OVN
  publishes. Pick a subnet to list its addresses by the pod and node holding
  each one.
- **VPC topology** — each logical router with the subnets hanging off it, the
  namespaces bound to them, and any static routes. Subnets pointing at a VPC
  that does not exist are called out separately.
- **Panels** on Pods (its IP object, subnet, VPC, and whether its node can
  actually carry traffic), Subnets (usage and who holds what) and Nodes (the
  per-node components, and the addresses held there).
- **Tables** for all 24 `kubeovn.io` kinds and for Kube-OVN's own pods.

### The failure it is built around

Kube-OVN's control plane and its dataplane fail independently. `ovn-central` and
`kube-ovn-controller` can be perfectly healthy — subnets reconciled, addresses
allocated, every custom resource green — while `ovs-ovn` crash-loops on every
node and nothing can actually talk. A plugin that only listed custom resources
would call that cluster fine.

So the overview checks `ovs-ovn` and `kube-ovn-cni` **per node** and says so
plainly when the control plane is healthy and the dataplane is not; the Pod
panel says when a pod's address is allocated but its node cannot carry it; and
the Node panel says when a node that Kubernetes reports `Ready` has no working
dataplane at all.

It also names: a subnet with no IPAM status yet, a subnet above 90% full, a
subnet whose VPC does not exist, more than one subnet claiming `default`, and
none claiming it.

## Installing

**Settings → Plugins → From a repository** with:

```
https://github.com/k8sdockside/kubeovn.git
```

## What it reads, and what it changes

It reads the `kubeovn.io` kinds (Subnets, VPCs, IPs, IP pools, VLANs, provider
networks, NAT gateways and the rest), plus **Pods**, **Nodes**, **Namespaces**,
**DaemonSets**, **Deployments** and **Events**.

It **changes nothing**. The manifest declares `"write": false`, so the app will
not offer it a way to, and it asks for no network, no registries and no
services. It reads no Secrets, and the app would refuse if it tried.

Address counts come from each subnet's `status` — Kube-OVN's own IPAM
accounting, which is what allocation happens against — rather than from counting
IP objects. Where the two disagree the page says so instead of quietly picking
one.

## Charts

The queries use metrics this plugin verified against a running cluster:

| Chart | Metric | Exposed by |
| --- | --- | --- |
| Addresses in use / available | `subnet_used_ip_count`, `subnet_available_ip_count` | `kube-ovn-controller`, port 10660 |
| Pod-to-pod latency and loss | `pinger_pod_ping_latency_ms`, `pinger_pod_ping_lost_total` | `kube-ovn-pinger`, port 8080 |
| API server latency from the pods | `pinger_apiserver_latency_ms` | `kube-ovn-pinger`, port 8080 |

The pinger metrics are milliseconds; those queries divide by 1000 so the chart's
unit is honest. The pinger charts stay empty unless `kube-ovn-pinger` is running
and scraped.

## Developing

```sh
# what CI runs: loads the plugin exactly as the app does
go run github.com/k8sdockside/k8sdockside/cmd/plugincheck@main .
```

The pages are plain classic scripts — no build, no bundler, nothing generated.
Edit a file in `ui/` and reopen its tab in the app; press **Reload** in
**Settings → Plugins** after changing `plugin.json`.

`ui/model.js` holds everything that is not drawing: reading subnets, VPCs and IP
objects, judging component health, and deciding what counts as a problem. It is
free of DOM calls on purpose, so it can be exercised on its own.

## Licence

[MIT](LICENSE)
