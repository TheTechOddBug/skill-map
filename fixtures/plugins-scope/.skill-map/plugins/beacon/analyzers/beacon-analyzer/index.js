/**
 * Second demo plugin, "beacon". Emits rich data on EVERY node across
 * three body panels (key-values, records, tree) so its inspector section
 * is always full. `beacon`'s plugin `order` (10) is lower than
 * `example`'s (20), so the `beacon` section sorts ABOVE `example`
 * regardless of plugin id alphabetical order.
 */
export default {
  version: '0.1.0',
  description: 'Demo analyzer: key-values + records + tree under its own plugin section.',
  mode: 'deterministic',
  order: 10,

  ui: {
    'aaa': {
      slot: 'inspector.body.pasnel.key-values',
      label: 'Node facts',
      priority: 10,
    },
    'metrics': {
      slot: 'inspector.body.panel.records',
      label: 'Link metrics',
      priority: 20,
    },
    'outline': {
      slot: 'inspector.body.panel.tree',
      label: 'Structure',
      priority: 30,
    },
  },

  evaluate(ctx) {
    for (const node of ctx.nodes) {
      console.log('aaaa', node);
      const fm = node.frontmatter ?? {};
      const name = typeof fm.name === 'string' ? fm.name : node.path.split('/').pop() ?? node.path;
      const toolCount = Array.isArray(fm.tools) ? fm.tools.length : 0;
      const ext = node.externalRefsCount ?? 0;

      // KEY-VALUES (always)
      ctx.emitContribution(node.path, 'aaas', {
        entries: [
          { key: 'name', value: name },
          { key: 'kind', value: node.kind },
          { key: 'provider', value: node.provider },
          { key: 'path', value: node.path },
          { key: 'tools', value: toolCount },
          { key: 'links out', value: node.linksOutCount },
          { key: 'links in', value: node.linksInCount },
          { key: 'external refs', value: ext },
        ],
      });

      // RECORDS (always)
      ctx.emitContribution(node.path, 'metrics', {
        columns: [
          { key: 'metric', label: 'Metric' },
          { key: 'count', label: 'Count' },
        ],
        rows: [
          { metric: 'links out', count: node.linksOutCount },
          { metric: 'links in', count: node.linksInCount },
          { metric: 'external refs', count: ext },
          { metric: 'tools', count: toolCount },
        ],
      });

      // TREE (always)
      ctx.emitContribution(node.path, 'outline', {
        label: name,
        marker: 'pi-folder',
        children: [
          { label: `kind: ${node.kind}`, marker: 'pi-tag' },
          { label: `provider: ${node.provider}`, marker: 'pi-box' },
          {
            label: 'links',
            marker: 'pi-link',
            children: [
              { label: `out: ${node.linksOutCount}` },
              { label: `in: ${node.linksInCount}` },
            ],
          },
        ],
      });
    }
    return [];
  },
};
