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
 * `reference-broken` / `name-collision` / etc.
 *
 * Manifest validation for registered extensions is already enforced at
 * load time by the PluginLoader, there's no need to redo it here. This
 * rule focuses on user content that the scan produced. Cross-rule issue
 * validation (revalidating other rules' `Issue[]` output) is intentionally
 * NOT done here; rules see only the graph (`nodes` + `links`), and the
 * kernel's own `validateIssue()` already gates issues at emit time.
 */

import type { IAnalyzer, IAnalyzerContext, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import type { Issue, Link, Node } from '../../../../kernel/types.js';
import { loadSchemaValidators, type ISchemaValidators } from '../../../../kernel/adapters/schema-validators.js';
import { tx } from '../../../../kernel/util/tx.js';
import { formatFinding } from '../../../../kernel/util/finding-format.js';
import { SCHEMA_VIOLATION_TEXTS } from './schema-violation.texts.js';
import { CORE_PLUGIN_ID } from '../../../ids.js';

const ID = 'schema-violation';

export const schemaViolationAnalyzer: IBuiltInManifest<IAnalyzer> = {
  id: ID,
  pluginId: CORE_PLUGIN_ID,
  kind: 'analyzer',
  description: 'Flags nodes or links that violate the project schemas.',
  // Host-locked (spec architecture.md §Locked extensions): this check
  // backs the invariant "what reaches the DB conforms to the spec";
  // disabling it would persist non-conformant content silently.
  locked: true,
  mode: 'deterministic',

  // No `ui` declaration: the per-node failure-count chip used to live
  // on `card.footer.right`, but its information is now folded into the
  // aggregate severity counters emitted by `core/issue-counter`. The
  // findings still emit as `Issue` records, so `sm check` / inspector
  // unchanged.
  ui: {},

  evaluate(ctx: IAnalyzerContext): Issue[] {
    const validators = loadSchemaValidators();
    const findings: Issue[] = [];
    // Frontmatter `name` / `description` requiredness is NOT re-derived
    // here: each Provider's per-kind schema decides it (Claude agent,
    // OpenAI Codex agent and the Agent Skills skill declare `required`;
    // the `markdown` fallback and Claude skill/command leave it optional),
    // and the kernel enforces that per-kind contract at scan time
    // (`frontmatter-invalid`). A universal base check here would only
    // re-impose the requirement on the kinds that deliberately relaxed it,
    // so the per-kind schema stays the single source of truth.
    for (const node of ctx.nodes) {
      collectNodeFindings(validators, node, findings);
    }
    for (const link of ctx.links) {
      collectLinkFindings(validators, link, findings);
    }
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
    message: formatFinding({
      body: tx(SCHEMA_VIOLATION_TEXTS.nodeFailure, {
        errors: result.errors,
      }),
    }),
    data: { target: 'node', path: node.path },
    fix: { summary: tx(SCHEMA_VIOLATION_TEXTS.fixSummary) },
  });
}

function collectLinkFindings(v: ISchemaValidators, link: Link, out: Issue[]): void {
  const result = v.validate('link', toLinkForSchema(link));
  if (result.ok) return;
  out.push({
    analyzerId: ID,
    severity: 'error',
    nodeIds: [link.source],
    message: formatFinding({
      subject: link.target,
      body: tx(SCHEMA_VIOLATION_TEXTS.linkFailure, {
        errors: result.errors,
      }),
    }),
    data: { target: 'link', source: link.source, to: link.target },
    fix: { summary: tx(SCHEMA_VIOLATION_TEXTS.fixSummary) },
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
