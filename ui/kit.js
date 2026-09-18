// The drawing kit the pages share: elements, chips, stats, the usage meter a
// subnet is read through, subnet cards and the component health rows.
//
// Everything a cluster supplies reaches the page as text, never as markup. The
// frame is sandboxed, but a page that let a subnet's name run as HTML would
// still be a page that lets a subnet's name run as HTML.

(function () {
    'use strict';

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (key) {
                var value = attrs[key];
                if (value === null || value === undefined || value === false) return;
                if (key === 'class') node.className = value;
                else if (key === 'text') node.textContent = value;
                else if (key === 'style') node.setAttribute('style', value);
                else if (key.slice(0, 2) === 'on' && typeof value === 'function') node[key.toLowerCase()] = value;
                else node.setAttribute(key, value === true ? '' : value);
            });
        }
        var rest = Array.prototype.slice.call(arguments, 2);
        rest.forEach(function add(child) {
            if (child === null || child === undefined || child === false) return;
            if (Array.isArray(child)) {
                child.forEach(add);
                return;
            }
            node.appendChild(
                typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child
            );
        });
        return node;
    }

    function clear(node) {
        while (node && node.firstChild) node.removeChild(node.firstChild);
        return node;
    }

    // ------------------------------------------------------------------ pieces

    function chip(label, value, tone) {
        return el(
            'span',
            { class: 'chip' + (tone ? ' chip-' + tone : '') },
            el('span', { class: 'chip-label', text: label }),
            el('span', {
                class: 'chip-value',
                text: value === null || value === undefined || value === '' ? '—' : String(value),
            })
        );
    }

    function stat(value, caption, tone) {
        return el(
            'div',
            { class: 'stat' + (tone ? ' stat-' + tone : '') },
            el('div', { class: 'stat-value', text: String(value) }),
            el('div', { class: 'stat-caption', text: caption })
        );
    }

    function field(label, value, opts) {
        var options = opts || {};
        return el(
            'div',
            { class: 'field' },
            el('span', { class: 'field-label', text: label }),
            el('span', {
                class: 'field-value' + (options.mono ? ' mono' : '') + (options.tone ? ' tone-' + options.tone : ''),
                text: value === null || value === undefined || value === '' ? '—' : String(value),
            })
        );
    }

    function badge(text, kindName) {
        return el('span', { class: 'badge' + (kindName ? ' badge-' + kindName : ''), text: text });
    }

    // ------------------------------------------------------------------ meter
    //
    // A subnet's address usage for one family. Kube-OVN publishes used and
    // available in the subnet's status, so this shows its numbers rather than
    // counting IP objects — the two can differ while the controller catches up,
    // and the status is the one IPAM actually allocates against.

    // formatCount keeps an address count readable. An IPv6 /56 holds
    // 4,722,366,482,869,645,213,696 addresses; printed in full that is noise and
    // pushes the rest of the line off the card, so past a point it becomes a
    // power of ten. Small counts stay exact, because the difference between 6
    // and 7 addresses left is the one that matters.
    var SUPERSCRIPT = ['\u2070', '\u00b9', '\u00b2', '\u00b3', '\u2074', '\u2075', '\u2076', '\u2077', '\u2078', '\u2079'];

    function formatCount(n) {
        if (!isFinite(n)) return String(n);
        if (n < 1e7) return n.toLocaleString();
        var exponent = Math.floor(Math.log10(n));
        var mantissa = n / Math.pow(10, exponent);
        var digits = String(exponent)
            .split('')
            .map(function (d) {
                return SUPERSCRIPT[Number(d)] || d;
            })
            .join('');
        return String(Math.round(mantissa * 10) / 10) + '\u00d710' + digits;
    }

    function usageMeter(family, opts) {
        var options = opts || {};
        // A dual-stack v6 subnet is so large that the used share rounds to zero;
        // showing "0%" next to "6 used" reads as broken rather than as empty, so
        // a non-zero usage that rounds away is shown as "<0.1%".
        var percent = Math.round(family.fraction * 1000) / 10;
        var percentText = percent === 0 && family.used > 0 ? '<0.1%' : percent + '%';
        var tone = 'ok';
        if (family.fraction >= 0.98) tone = 'error';
        else if (family.fraction >= 0.9) tone = 'warn';

        var head = el(
            'div',
            { class: 'meter-head' },
            el('span', { class: 'meter-name', text: options.label || 'IPv' + family.version }),
            el('span', {
                class: 'meter-count',
                text:
                    formatCount(family.used) +
                    ' used · ' +
                    formatCount(family.available) +
                    ' free · ' +
                    percentText,
            })
        );

        var fill = el('div', { class: 'meter-fill' });
        // A subnet with a handful of addresses out of 65,000 is a sliver; keep
        // it visible so "some" never looks like "none".
        fill.style.width = Math.min(100, Math.max(family.used > 0 ? 1.5 : 0, family.fraction * 100)) + '%';

        var parts = [head, el('div', { class: 'meter-track' }, fill)];
        if (family.usingRange || family.availableRange) {
            parts.push(
                el(
                    'div',
                    { class: 'meter-range' },
                    el('span', { class: 'mono', text: family.usingRange ? 'in use ' + family.usingRange : '' }),
                    el('span', { class: 'mono', text: family.availableRange ? 'free ' + family.availableRange : '' })
                )
            );
        }

        return el('div', { class: 'meter meter-' + tone }, parts);
    }

    // ------------------------------------------------------------ subnet card

    function subnetCard(subnet, onOpen) {
        var badges = el('div', { class: 'badges' });
        if (subnet.isDefault) badges.appendChild(badge('default', 'default'));
        if (subnet.protocol) badges.appendChild(badge(subnet.protocol));
        if (subnet.natOutgoing) badges.appendChild(badge('NAT'));
        if (subnet.private) badges.appendChild(badge('private'));
        if (subnet.gatewayType) badges.appendChild(badge(subnet.gatewayType));
        if (subnet.vlan) badges.appendChild(badge('vlan ' + subnet.vlan));
        if (!subnet.reconciled) badges.appendChild(badge('no status'));

        var card = el(
            'div',
            { class: 'subnet-card', tabindex: '0', role: 'button' },
            el(
                'div',
                { class: 'subnet-card-name' },
                el('span', { text: subnet.name }),
                el('span', {
                    class: 'meter-count',
                    text: subnet.families
                        .map(function (f) {
                            return 'v' + f.version + ' ' + formatCount(f.used);
                        })
                        .join(' · '),
                })
            ),
            el('div', { class: 'subnet-card-cidr mono', text: subnet.cidrs.join(', ') || 'no CIDR' }),
            subnet.families.map(function (f) {
                return usageMeter(f);
            }),
            badges
        );
        if (onOpen) {
            card.onclick = onOpen;
            card.onkeydown = function (ev) {
                if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    onOpen();
                }
            };
        }
        return card;
    }

    // -------------------------------------------------------------- components

    function componentRow(component) {
        var count = component.perNode
            ? component.ready + ' / ' + component.expected + ' nodes'
            : component.ready + ' / ' + component.total;

        var detail;
        if (!component.total) detail = 'Not running.' + (component.optional ? ' It is optional.' : '');
        else if (component.troubles.length) {
            detail = component.troubles
                .slice(0, 4)
                .map(function (t) {
                    return (t.node || t.name) + ': ' + t.reason;
                })
                .join(' · ');
        } else detail = 'All pods ready.';

        return el(
            'div',
            { class: 'component component-' + component.tone },
            el('div', { class: 'component-dot' }),
            el(
                'div',
                { class: 'component-body' },
                el('div', { class: 'component-name', text: component.label }),
                el('div', { class: 'component-detail', text: detail })
            ),
            el('div', { class: 'component-count', text: count })
        );
    }

    // ---------------------------------------------------------------- problems

    function problemList(problems) {
        var order = { error: 0, warn: 1, info: 2 };
        var sorted = problems.slice().sort(function (a, b) {
            return (order[a.tone] || 9) - (order[b.tone] || 9);
        });
        var list = el('ul', { class: 'problems' });
        sorted.forEach(function (p) {
            list.appendChild(
                el(
                    'li',
                    { class: 'problem problem-' + (p.tone || 'info') },
                    el('div', { class: 'problem-title', text: p.title }),
                    p.detail ? el('div', { class: 'problem-detail', text: p.detail }) : null
                )
            );
        });
        return list;
    }

    function verdict(tone, headline, detail) {
        return el(
            'div',
            { class: 'verdict verdict-' + tone },
            el('div', { class: 'verdict-dot' }),
            el(
                'div',
                { class: 'verdict-body' },
                el('div', { class: 'verdict-headline', text: headline }),
                detail ? el('div', { class: 'verdict-detail', text: detail }) : null
            )
        );
    }

    function section(title, subtitle, body) {
        return el(
            'section',
            { class: 'panel' },
            el(
                'header',
                { class: 'panel-head' },
                el('h2', { class: 'panel-title', text: title }),
                subtitle ? el('p', { class: 'panel-sub', text: subtitle }) : null
            ),
            body
        );
    }

    function empty(message) {
        return el('p', { class: 'empty', text: message });
    }

    function showError(err) {
        var banner = document.getElementById('error');
        if (!banner) return;
        banner.textContent = err && err.message ? err.message : String(err);
        banner.hidden = false;
    }

    function relative(iso) {
        if (!iso) return '';
        var then = Date.parse(iso);
        if (!isFinite(then)) return '';
        var secs = Math.max(0, Math.round((Date.now() - then) / 1000));
        if (secs < 60) return secs + 's ago';
        if (secs < 3600) return Math.round(secs / 60) + 'm ago';
        if (secs < 86400) return Math.round(secs / 3600) + 'h ago';
        return Math.round(secs / 86400) + 'd ago';
    }

    // openSubnet is the one navigation every page does, so it lives here.
    function openSubnet(name) {
        k8sdockside.open({ kind: 'crd:subnets.kubeovn.io', name: name });
    }

    window.KubeOVN = window.KubeOVN || {};
    window.KubeOVN.kit = {
        el: el,
        clear: clear,
        chip: chip,
        stat: stat,
        field: field,
        badge: badge,
        formatCount: formatCount,
        usageMeter: usageMeter,
        subnetCard: subnetCard,
        componentRow: componentRow,
        problemList: problemList,
        verdict: verdict,
        section: section,
        empty: empty,
        showError: showError,
        relative: relative,
        openSubnet: openSubnet,
    };
})();
