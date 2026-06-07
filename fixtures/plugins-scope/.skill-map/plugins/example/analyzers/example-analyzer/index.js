/**
 * EXAMPLE drop-in analyzer, "inspector slots tour".
 *
 * Emits rich data on EVERY node so the `example` inspector section is
 * always full: a header badge plus four body panels (key-values,
 * breakdown, link-list, markdown). Together with the `beacon` plugin
 * (key-values, records, tree) the demo showcases all six panel types.
 *
 * The `ui:` map (static) declares WHICH slot each contributionId targets
 * + static chrome; `evaluate()` emits the per-node payload, validated by
 * the kernel against `view-slots.schema.json#/$defs/payloads/<slot>`.
 */
export default {
  version: '0.1.0',
  description: 'Demo analyzer: header badge + key-values + breakdown + link-list + markdown.',
  mode: 'deterministic',
  // Extension-level ordering hint (inspector-only): orders this
  // extension's bricks within the `example` plugin section.
  order: 10,

  ui: {
    'header-badge': {
      slot: 'inspector.header.badge',
      icon: 'pi-bolt',
      label: 'tools',
      priority: 10,
    },
    'summary': {
      slot: 'inspector.body.panel.key-values',
      label: 'Summary',
      priority: 10,
    },
    'distribution': {
      slot: 'inspector.body.panel.breakdown',
      label: 'Size breakdown (chars)',
      priority: 20,
    },
    'related': {
      slot: 'inspector.body.panel.link-list',
      label: 'Related nodes',
      priority: 30,
      emitWhenEmpty: false,
    },
    'notes': {
      slot: 'inspector.body.panel.markdown',
      label: 'Notes',
      priority: 40,
    },
  },

  evaluate(ctx) {
    for (const node of ctx.nodes) {
      const fm = node.frontmatter ?? {};
      const name = typeof fm.name === 'string' ? fm.name : node.path.split('/').pop() ?? node.path;
      const desc = typeof fm.description === 'string' ? fm.description : '';
      const toolCount = Array.isArray(fm.tools) ? fm.tools.length : 0;
      const tools = Array.isArray(fm.tools) ? fm.tools.join(', ') : '(none)';

      // 1. HEADER BADGE
      ctx.emitContribution(node.path, 'header-badge', {
        icon: 'pi-bolt',
        count: toolCount,
        severity: 'info',
        tooltip: `${toolCount} tools declared`,
      });

      // 2. KEY-VALUES (always)
      ctx.emitContribution(node.path, 'summary', {
        entries: [
          { key: 'name', value: name },
          { key: 'kind', value: node.kind },
          { key: 'provider', value: node.provider },
          { key: 'tools', value: tools, tooltip: `${toolCount} declared` },
          { key: 'description', value: desc || '(none)' },
          { key: 'links out', value: node.linksOutCount },
          { key: 'links in', value: node.linksInCount },
        ],
      });

      // 3. BREAKDOWN (always, derived from data present on every node)
      ctx.emitContribution(node.path, 'distribution', {
        entries: [
          { label: 'name', value: name.length },
          { label: 'description', value: desc.length },
          { label: 'tools', value: toolCount },
          { label: 'links out', value: node.linksOutCount },
          { label: 'links in', value: node.linksInCount },
        ],
      });

      // 4. LINK-LIST (only when the node has outgoing links)
      const outgoing = ctx.links.filter((l) => l.source === node.path);
      const related = outgoing.slice(0, 10).map((l) => ({ path: l.target, kind: l.kind }));
      if (related.length > 0) {
        ctx.emitContribution(node.path, 'related', { entries: related });
      }

      // 5. MARKDOWN (always)
      ctx.emitContribution(node.path, 'notes', {
        markdown: [
          `## ${name}`,
          '',
          desc || 'No description provided.',
          '',
          `- kind: \`${node.kind}\``,
          `- provider: \`${node.provider}\``,
          `- tools: ${tools}`,
        ].join('\n'),
      });
    }
    return []; // contribution-only analyzer, no Issues
  },
};
