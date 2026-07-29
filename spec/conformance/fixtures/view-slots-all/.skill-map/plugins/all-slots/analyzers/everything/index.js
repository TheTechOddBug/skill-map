// Conformance fixture: an analyzer whose `ui` map declares a contribution to
// EVERY one of the 14 view slots in the closed catalog. The counter slots
// (`card.subtitle.left`, `card.footer.left`, `card.footer.right`) and the
// standalone icon slot (`card.title.right`) require `icon` in the manifest;
// the rest only need `slot`. The `ui` keys are kebab-case (the manifest schema
// constrains contribution ids). The companion case `view-slots-all.json`
// asserts the plugin loads clean (`sm plugins doctor` reports ok), locking
// that every catalog slot id is a valid manifest declaration. `evaluate`
// emits nothing: this case exercises manifest validation, not emission.
export default {
  mode: 'deterministic',

  ui: {
    'card-title': { slot: 'card.title.right', icon: 'pi-flag' },
    'card-subtitle': { slot: 'card.subtitle.left', icon: 'pi-hashtag' },
    'card-footer-left': { slot: 'card.footer.left', icon: 'pi-download' },
    'card-footer-right': { slot: 'card.footer.right', icon: 'pi-upload' },
    'graph-alert': { slot: 'graph.node.alert' },
    'header-badge': { slot: 'inspector.header.badge' },
    'action-button': { slot: 'inspector.action.button' },
    'breakdown': { slot: 'inspector.body.panel.breakdown' },
    'records': { slot: 'inspector.body.panel.records' },
    'tree': { slot: 'inspector.body.panel.tree' },
    'key-values': { slot: 'inspector.body.panel.key-values' },
    'link-list': { slot: 'inspector.body.panel.link-list' },
    'markdown': { slot: 'inspector.body.panel.markdown' },
    'scope-stat': { slot: 'topbar.nav.start' },
  },

  evaluate() {
    return [];
  },
};
