// Conformance fixture: an analyzer that emits well-formed payloads to the
// three list-panel slots using the renamed payload fields (breakdown `bars`,
// key-values `pairs`, link-list `links`), plus two deliberately rejected
// emissions. Contributions are declared as consts and emitted BY REFERENCE;
// the kernel recovers the id from the `ui` map by object identity.
//
// The companion case `view-contribution-payloads.json` asserts the good
// emissions scan clean (exit 0) and that each rejection surfaces a loud
// `extension.error` on stderr:
//   - a payload that fails the key-values AJV schema (a pair missing `value`);
//   - a spread copy `{ ...dist }` that loses the `ui` object identity
//     (`undeclared-contribution-ref`).
const summary = { slot: 'inspector.body.panel.key-values', label: 'Summary' };
const dist = { slot: 'inspector.body.panel.breakdown', label: 'Distribution' };
const related = { slot: 'inspector.body.panel.link-list', label: 'Related' };

export default {
  version: '0.1.0',
  description: 'analyzer emitting bars/pairs/links payloads plus two rejected emissions',
  mode: 'deterministic',

  ui: { summary, dist, related },

  evaluate(ctx) {
    for (const node of ctx.nodes) {
      // Well-formed emissions to the renamed list-payload fields.
      ctx.emitContribution(node.path, summary, { pairs: [{ key: 'kind', value: node.kind }] });
      ctx.emitContribution(node.path, dist, { bars: [{ label: 'len', value: 1 }] });
      ctx.emitContribution(node.path, related, { links: [{ path: node.path }] });
      // Rejection 1: payload fails the key-values schema (pair missing `value`).
      ctx.emitContribution(node.path, summary, { pairs: [{ key: 'broken' }] });
      // Rejection 2: a spread copy loses object identity vs the `ui` map.
      ctx.emitContribution(node.path, { ...dist }, { bars: [{ label: 'x', value: 1 }] });
    }
    return [];
  },
};
