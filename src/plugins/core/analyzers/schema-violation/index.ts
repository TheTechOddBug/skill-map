/**
 * `schema-violation` rule. Cross-graph consistency check that runs alongside
 * the other deterministic rules. Validates the in-flight scan output back
 * through AJV against the authoritative schemas:
 *
 *   - Every Node's record against `node.schema.json`. The per-kind
 *     `frontmatter/<kind>.schema.json` is reached transitively via the
 *     node schema's `$ref`s.
 *   - Every Link against `link.schema.json` (except the id/location
 *     numeric fields that only exist on the DB row).
 *
 * Failures become `Issue[]` like every other rule. The CLI / report
 * formatter wrapping is no longer this extension's concern; consumers
 * surface `schema-violation`-emitted issues the same way they surface
 * `reference-broken` / `trigger-collision` / etc.
 *
 * Manifest validation for registered extensions is already enforced at
 * load time by the PluginLoader, there's no need to redo it here. This
 * rule focuses on user content that the scan produced. Cross-rule issue
 * validation (revalidating other rules' `Issue[]` output) is intentionally
 * NOT done here; rules see only the graph (`nodes` + `links`), and the
 * kernel's own `validateIssue()` already gates issues at emit time.
 */

import type { IAnalyzer, IAnalyzerContext } from '../../../../kernel/extensions/index.js';
import type { Issue, Link, Node } from '../../../../kernel/types.js';
import { loadSchemaValidators, type ISchemaValidators } from '../../../../kernel/adapters/schema-validators.js';
import { tx } from '../../../../kernel/util/tx.js';
import { SCHEMA_VIOLATION_TEXTS } from './text.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'schema-violation';

export const schemaViolationAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  version: '1.0.0',
  description: 'Flags nodes or links that violate the project schemas.',
  mode: 'deterministic',

  // No `ui` declaration: the per-node failure-count chip used to live
  // on `card.footer.right`, but its information is now folded into the
  // aggregate severity counters emitted by `core/issue-counter`. The
  // findings still emit as `Issue` records, so `sm check` / inspector
  // unchanged.
  ui: {},

  // Pre-existing complexity: validates every node + every link
   // against multiple schemas with per-severity aggregation. The
   // branching mirrors the schema catalog and splitting scatters the
   // validation contract. Tracked as tech-debt; surfaced when an
   // unrelated change touched the lint cache.
  // eslint-disable-next-line complexity
  evaluate(ctx: IAnalyzerContext): Issue[] {
    const validators = loadSchemaValidators();
    const findings: Issue[] = [];
    // Per-node tally + worst severity so the contribution surfaces
    // ONE alert / chip per node (mirrors broken-ref's aggregation) and
    // paints in the right colour: `danger` (red) as soon as any
    // finding is `error`, `warn` (yellow) when every finding is warn.
    type TWorst = 'warn' | 'danger';
    const perNode = new Map<string, { count: number; worst: TWorst }>();

    for (const node of ctx.nodes) {
      const before = findings.length;
      collectNodeFindings(validators, node, findings);
      // Universal base check: every `.md` MUST surface a non-empty
      // `frontmatter.name` and `frontmatter.description`. The node
      // schema itself only types frontmatter as a permissive object
      // (`additionalProperties: true`); per-kind schemas elsewhere
      // enforce the requirement, but when YAML parsing or schema
      // dispatch fails the kernel surfaces a blank frontmatter
      // here. Catch that case explicitly so the operator sees the
      // alert badge even on nodes the per-kind validation never
      // touched.
      collectFrontmatterBaseFindings(node, findings);
      if (findings.length > before) {
        let worst: TWorst = 'warn';
        for (let i = before; i < findings.length; i++) {
          if (findings[i]!.severity === 'error') {
            worst = 'danger';
            break;
          }
        }
        const prev = perNode.get(node.path);
        perNode.set(node.path, {
          count: (prev?.count ?? 0) + (findings.length - before),
          worst: prev?.worst === 'danger' ? 'danger' : worst,
        });
      }
    }
    for (const link of ctx.links) {
      collectLinkFindings(validators, link, findings);
    }

    // Per-node aggregation that fed the now-removed chip emission
    // stays computed in case future surfaces (inspector, sm check
    // verbose) want the per-node summary; today the values are
    // discarded after the loop. Keeping the dead arithmetic is cheap
    // (N ≤ nodes) and avoids a partial revert when re-enabling.
    void perNode;

    return findings;
  },
};

function collectNodeFindings(v: ISchemaValidators, node: Node, out: Issue[]): void {
  const result = v.validate('node', toNodeForSchema(node));
  if (result.ok) return;
  out.push({
    analyzerId: ID,
    severity: 'error',
    nodeIds: [node.path],
    message: tx(SCHEMA_VIOLATION_TEXTS.nodeFailure, {
      path: node.path,
      errors: result.errors,
    }),
    data: { target: 'node', path: node.path },
  });
}

function collectFrontmatterBaseFindings(node: Node, out: Issue[]): void {
  // Catch-all `markdown` nodes (README.md, CHANGELOG.md, notes/…)
  // legitimately ship with no `name` / `description` in their
  // frontmatter, vendor providers (`claude`, `openai`, `agent-skills`)
  // are the ones whose per-kind schemas declare those two as
  // required. Skip the catch-all here so the analyzer does not
  // flag every project doc as broken.
  if (node.provider === 'markdown') return;
  // Skip nodes that have no frontmatter block at all (`bytes.frontmatter === 0`).
  // These are markdown files that intentionally ship without
  // frontmatter, README.md / CHANGELOG.md inside a vendor scope
  // (e.g. `.claude/skills/<x>/references/foo.md`) is the typical
  // shape. Only flag when bytes were spent on a frontmatter block
  // AND the result is missing the base fields, that's the signal
  // for "parsed/validated badly" rather than "intentionally absent".
  if (node.bytes.frontmatter === 0) return;
  const fm = node.frontmatter ?? {};
  const missing: string[] = [];
  if (isMissingStringField(fm, 'name')) missing.push('name');
  if (isMissingStringField(fm, 'description')) missing.push('description');
  if (missing.length === 0) return;
  out.push({
    analyzerId: ID,
    // `warn` (not `error`) so the default `sm scan` exit code stays
    // 0 even when nodes are missing frontmatter base fields. Strict
    // mode (`sm scan --strict`) still escalates to exit 1. Matches
    // the `frontmatter-invalid` severity policy of the orchestrator.
    severity: 'warn',
    nodeIds: [node.path],
    message: tx(SCHEMA_VIOLATION_TEXTS.frontmatterBaseFailure, {
      path: node.path,
      missing: missing.join(', '),
    }),
    data: { target: 'frontmatter', path: node.path, missing },
  });
}

/**
 * True when the given frontmatter field is absent, not a string, or
 * an empty string. Extracted to keep `collectFrontmatterBaseFindings`
 * within the project's per-function cyclomatic budget (`||` branches
 * count toward complexity in ESLint).
 */
function isMissingStringField(fm: Record<string, unknown>, field: string): boolean {
  const v = fm[field];
  return typeof v !== 'string' || v.length === 0;
}

function collectLinkFindings(v: ISchemaValidators, link: Link, out: Issue[]): void {
  const result = v.validate('link', toLinkForSchema(link));
  if (result.ok) return;
  out.push({
    analyzerId: ID,
    severity: 'error',
    nodeIds: [link.source],
    message: tx(SCHEMA_VIOLATION_TEXTS.linkFailure, {
      source: link.source,
      target: link.target,
      errors: result.errors,
    }),
    data: { target: 'link', source: link.source, to: link.target },
  });
}

// The runtime TypeScript types carry a convenience shape (e.g. bytes as
// a triple-split object); the spec schemas use slightly different field
// layouts. These shape transformers bridge the two without leaking the
// DB-internal fields (id, `data_json`, etc.).
function toNodeForSchema(node: Node): unknown {
  return {
    path: node.path,
    kind: node.kind,
    provider: node.provider,
    bodyHash: node.bodyHash,
    frontmatterHash: node.frontmatterHash,
    bytes: node.bytes,
    tokens: node.tokens ?? undefined,
    linksOutCount: node.linksOutCount,
    linksInCount: node.linksInCount,
    externalRefsCount: node.externalRefsCount,
    frontmatter: node.frontmatter ?? {},
    sidecar: node.sidecar ?? undefined,
  };
}

function toLinkForSchema(link: Link): unknown {
  return {
    source: link.source,
    target: link.target,
    kind: link.kind,
    confidence: link.confidence,
    sources: link.sources,
    trigger: link.trigger ?? undefined,
    location: link.location ?? undefined,
    raw: link.raw ?? undefined,
  };
}
