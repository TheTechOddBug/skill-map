// Conformance fixture: an analyzer whose `ui` map declares the RETIRED
// `inspector.header.badge.counter` slot. That sub-slot (alongside
// `inspector.header.badge.tag`) was folded into the unified
// `inspector.header.badge` slot, so the id is no longer a member of
// `view-slots.schema.json#/$defs/SlotName`. The loader MUST reject this
// extension as invalid-manifest (AJV rejects the unknown slot name) and
// degrade the plugin, leaving the rest of the scan pipeline running.
//
// The companion case `view-action-button.json` asserts the stderr
// rejection text and that `sm scan` survives with the good plugin and
// the markdown node intact.
export default {
  version: '0.1.0',
  description: 'analyzer declaring the retired inspector.header.badge.counter slot',
  mode: 'deterministic',

  ui: {
    keywords: {
      slot: 'inspector.header.badge.counter',
      icon: 'pi-search',
      label: 'keywords',
    },
  },

  evaluate() {
    return [];
  },
};
