/**
 * Post-walk resolution gate for code-region trigger links. Normative
 * contract: `spec/architecture.md` §Extractor · code-region triggers.
 *
 * A bare `@handle` or `/command` inside a backtick span or fenced block
 * (emitted by `claude/backtick-mention` / `core/backtick-slash` with a
 * code-region `Signal.context`) is an invocation HYPOTHESIS, not
 * authored intent: the base rate of trigger-shaped tokens in code
 * regions is dominated by non-trigger payload (npm scopes like
 * `@changesets/cli`, decorators like `@Injectable`, shell paths like
 * `/tmp`, CSS at-rules like `@media`). Resolution is the disambiguator.
 * This transform removes every trigger-kind link (`mentions` /
 * `invokes`) that:
 *
 *   (a) resolved to no node (`resolvedTarget` absent after
 *       `liftResolvedLinkConfidence`), AND
 *   (b) has occurrence data whose EVERY entry carries a code-region
 *       `context` (`'code-block'` / `'inline-code'`).
 *
 * A pruned link never reaches `collectBrokenLinks` or the analyzer
 * phase, so it cannot flag `core/reference-broken`, is never persisted,
 * and never renders. Everything else keeps the standing behaviour:
 *
 *   - A trigger link with at least one prose occurrence (no `context`)
 *     survives unresolved and flags broken, because a prose trigger is
 *     authored intent whose dangling is an authoring bug.
 *   - Links without occurrence data (synthetic emissions, legacy emit
 *     paths) are never pruned; absence of provenance means no verdict.
 *   - Path-style kinds are untouched: code-region `points` edges
 *     deliberately DO flag broken (`core/backtick-path`, Decision #126),
 *     and `references` never sources from code regions.
 *
 * The gate keys on the occurrence `context` (a spec-pinned Signal
 * concept), NOT on extractor ids, so the kernel stays free of plugin
 * knowledge and any future code-region trigger emitter (an external
 * plugin, another provider's grammar) inherits the same gate.
 */

import type { Link } from '../types.js';

/** The trigger-style link kinds the gate applies to. */
const TRIGGER_KINDS = new Set<Link['kind']>(['mentions', 'invokes']);

/**
 * Filter the merged link graph per the rule above. Pure filter, no
 * mutation; runs after `liftResolvedLinkConfidence` (needs
 * `resolvedTarget`) and before `collectBrokenLinks` / link-count
 * denormalisation, so counts and the broken verdict never see the
 * pruned edges.
 */
export function pruneUnresolvedCodeTriggers(links: Link[]): Link[] {
  return links.filter((link) => !isUnresolvedCodeTrigger(link));
}

function isUnresolvedCodeTrigger(link: Link): boolean {
  if (!TRIGGER_KINDS.has(link.kind)) return false;
  if (link.resolvedTarget) return false;
  if (!link.occurrences || link.occurrences.length === 0) return false;
  return link.occurrences.every(
    (occ) => occ.context === 'code-block' || occ.context === 'inline-code',
  );
}
