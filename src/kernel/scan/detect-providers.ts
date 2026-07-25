/**
 * Pure filesystem provider auto-detection.
 *
 * Walks each Provider's `detect.markers` and returns the unique provider
 * ids whose marker exists under `cwd`. A Provider may declare several
 * markers (Codex matches both `.codex/` and root `AGENTS.md`); the
 * result deduplicates by provider id while preserving Provider iteration
 * order, so the first matching Provider determines the default
 * suggestion. Providers with no `detect` block are never auto-suggested,
 * and providers that ship disabled by default (`stability: experimental`
 * / `deprecated`) are skipped too: auto-detect only suggests ready
 * providers, the operator enables + selects the rest explicitly.
 *
 * Two consumers, both reaching it from the sanctioned direction:
 *   - the kernel orchestrator's auto-detect fallback (when a caller
 *     leaves `activeProvider` undefined), and
 *   - core's `resolveActiveProvider`, which layers the persisted
 *     `activeProvider` config value on top of this filesystem signal.
 *
 * Pure: `existsSync` + `join` for the marker scan plus the in-kernel
 * `installedDefaultEnabled` stability check, no config read and no
 * `core/` / `cli/` import, so it lives in the kernel (the innermost
 * layer) and `core/` reaches DOWN for it rather than the kernel reaching
 * up.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { installedDefaultEnabled } from '../config/plugin-resolver.js';
import type { TExtensionStability } from '../extensions/index.js';

/**
 * Structural subset of a Provider this detector needs. The kernel
 * `IProvider` is assignable to it, so the orchestrator passes its
 * registered provider list directly, and `core/config/active-provider`
 * re-exports the type for the scan runner / bootstrap consumers. The
 * marker set is provider-owned: each Provider declares its own
 * `detect.markers` in its manifest.
 */
export interface IProviderDetectInput {
  id: string;
  detect?: { markers?: readonly string[]; fallback?: boolean; subsumes?: readonly string[] };
  /**
   * Lifecycle label. Providers that ship disabled by default
   * (`experimental` / `deprecated`, per `installedDefaultEnabled`) are not
   * auto-detected: their markers never produce a candidate or an ambiguous
   * prompt. The operator enables them and sets the lens explicitly; auto-
   * detect only ever suggests ready (stable / beta) providers.
   */
  stability?: TExtensionStability;
}

/**
 * Return the unique provider ids whose `detect.markers` resolve to an
 * existing path under `cwd`, in Provider iteration order. No config
 * read, no prompt, no write.
 *
 * **Fallback precedence**: a Provider flagged `detect.fallback` (the
 * open-standard `agent-skills` lens, whose `.agents/` marker is also the
 * shared skill home vendor lenses populate) is kept ONLY when no vendor
 * (non-fallback) Provider matched. So a `.codex/` + `.agents/` project
 * returns `['codex']`, not the ambiguous `['codex', 'agent-skills']` pair,
 * delivering what the scaffold `marker` field promises.
 *
 * **Compat subsumption**: a Provider may declare `detect.subsumes`, the ids
 * it absorbs when both matched, because it READS that runtime's territory
 * itself. `opencode` (`subsumes: ['claude']`) is the reference case: it
 * reads `.claude/skills/` + `CLAUDE.md` by design, while Claude Code never
 * reads `.opencode/`, so `.claude/` + `.opencode/` returns `['opencode']`
 * rather than a prompt over a tie that does not exist. One-way only, a
 * mutual pair keeps both. Vendor markers with no subsumption relation
 * still return a multi-id (ambiguous) list.
 */
export function detectProvidersFromFilesystem(
  cwd: string,
  providers: ReadonlyArray<IProviderDetectInput>,
): string[] {
  const seen = new Set<string>();
  const matched: IProviderDetectInput[] = [];
  for (const provider of providers) {
    if (seen.has(provider.id)) continue;
    if (!isDetectableUnderCwd(cwd, provider)) continue;
    seen.add(provider.id);
    matched.push(provider);
  }
  // Drop fallback lenses once any vendor (non-fallback) lens matched: the
  // shared `.agents/` home must not turn a single-vendor project into an
  // ambiguous prompt. When no vendor matched, the fallback stands as the
  // sole candidate (a pure open-standard project resolves to it).
  const hasVendor = matched.some((p) => p.detect?.fallback !== true);
  const kept = hasVendor ? matched.filter((p) => p.detect?.fallback !== true) : matched;
  return dropSubsumed(kept).map((p) => p.id);
}

/**
 * Remove every candidate another SURVIVING candidate subsumes. Evaluated
 * against the incoming set (not progressively), so the outcome does not
 * depend on iteration order, and skipped for a mutual pair (A subsumes B
 * while B subsumes A) because dropping either would be an arbitrary
 * tie-break: the ambiguity is real and the operator resolves it.
 */
function dropSubsumed(
  candidates: readonly IProviderDetectInput[],
): readonly IProviderDetectInput[] {
  const subsumers = candidates.filter((p) => (p.detect?.subsumes?.length ?? 0) > 0);
  if (subsumers.length === 0) return candidates;
  const absorbs = (a: IProviderDetectInput, b: IProviderDetectInput): boolean =>
    a.detect?.subsumes?.includes(b.id) === true;
  return candidates.filter(
    (candidate) =>
      !subsumers.some(
        (other) =>
          other.id !== candidate.id && absorbs(other, candidate) && !absorbs(candidate, other),
      ),
  );
}

/**
 * Whether a Provider's markers resolve under `cwd`. Coming-soon
 * Providers are registered but not yet selectable, so their markers
 * never produce an auto-detect candidate. Extracted to keep the loop's
 * branching low.
 */
function isDetectableUnderCwd(cwd: string, provider: IProviderDetectInput): boolean {
  // Providers that ship disabled by default (experimental / deprecated)
  // are never auto-suggested: the operator must enable + select them.
  if (!installedDefaultEnabled(provider.stability)) return false;
  const markers = provider.detect?.markers;
  if (!markers || markers.length === 0) return false;
  return markers.some((marker) => existsSync(join(cwd, marker)));
}
