// Conformance fixture: an analyzer whose `ui` map declares the two
// new inspector slots, the unified `inspector.header.badge` and the
// `inspector.action.button` dispatch slot. Both manifest declarations
// are well-formed against `view-slots.schema.json#/$defs/IViewContribution`,
// so the loader MUST accept the plugin and register it.
//
// At evaluate time the analyzer emits well-formed payloads for each
// slot: a header badge ({ count, icon }) the kernel validates against
// `$defs/payloads/inspector.header.badge`, and an action button
// ({ actionId, label, enabled }) it validates against
// `$defs/payloads/inspector.action.button`. The companion case
// `view-action-button.json` asserts the plugin loads (no stderr
// rejection) and `sm scan` exits cleanly.
export default {
  version: '0.1.0',
  description: 'analyzer declaring inspector.header.badge + inspector.action.button',
  mode: 'deterministic',

  ui: {
    keywords: {
      slot: 'inspector.header.badge',
      label: 'keywords',
    },
    bump: {
      slot: 'inspector.action.button',
    },
  },

  evaluate(ctx) {
    for (const node of ctx.nodes) {
      // Well-formed `inspector.header.badge` payload (count + icon).
      ctx.emitContribution(node.path, 'keywords', { count: 3, icon: 'pi-search' });
      // Well-formed `inspector.action.button` payload.
      ctx.emitContribution(node.path, 'bump', {
        actionId: 'core/node-bump',
        label: 'Bump version',
        icon: 'pi-arrow-up',
        enabled: true,
      });
    }
    return [];
  },
};
