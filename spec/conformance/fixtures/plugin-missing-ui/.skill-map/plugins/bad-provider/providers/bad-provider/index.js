// Conformance fixture: provider whose `kinds/markdown/kind.json`
// deliberately omits the required `ui` block (structure-as-truth
// refactor moved the kind catalog from the manifest map to per-kind
// folders on disk). The plugin loader MUST reject this manifest with
// a clear "missing required property 'ui'" diagnostic and the plugin
// MUST end up in `invalid-manifest` status. The companion case
// `plugin-missing-ui-rejected.json` asserts the stderr text and that
// `sm scan` survives (the loader degrades the bad plugin and lets the
// rest of the pipeline continue).
export default {
  // Provider-level `presentation` is present and valid, so the loader
  // gets past manifest validation and fails specifically on the KIND's
  // missing `ui` block (the focus of this case).
  presentation: { label: 'Bad', color: '#000000' },
  async *walk() {},
  classify() {
    return 'markdown';
  },
};
