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
// Contributions are declared as consts and emitted BY REFERENCE (the kernel
// recovers the id from the `ui` map by object identity); `ui` lists them by
// shorthand so each const and its `ui` entry are the same object.
const keywords = {
  slot: 'inspector.header.badge',
  label: 'keywords',
};
const bump = {
  slot: 'inspector.action.button',
};

export default {
  mode: 'deterministic',

  ui: { keywords, bump },

  evaluate(ctx) {
    for (const node of ctx.nodes) {
      // Well-formed `inspector.header.badge` payload (count + icon).
      ctx.emitContribution(node.path, keywords, { count: 3, icon: 'pi-search' });
      // Well-formed `inspector.action.button` payload.
      ctx.emitContribution(node.path, bump, {
        actionId: 'core/node-bump',
        label: 'Bump version',
        icon: 'pi-arrow-up',
        enabled: true,
      });
    }
    return [];
  },
};
