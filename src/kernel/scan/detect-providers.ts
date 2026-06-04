/**
 * Pure filesystem provider auto-detection.
 *
 * Walks each Provider's `detect.markers` and returns the unique provider
 * ids whose marker exists under `cwd`. A Provider may declare several
 * markers (Codex matches both `.codex/` and root `AGENTS.md`); the
 * result deduplicates by provider id while preserving Provider iteration
 * order, so the first matching Provider determines the default
 * suggestion. Providers with no `detect` block are never auto-suggested.
 *
 * Two consumers, both reaching it from the sanctioned direction:
 *   - the kernel orchestrator's auto-detect fallback (when a caller
 *     leaves `activeProvider` undefined), and
 *   - core's `resolveActiveProvider`, which layers the persisted
 *     `activeProvider` config value on top of this filesystem signal.
 *
 * Pure: only `existsSync` + `join`, no config read and no `core/` /
 * `cli/` import, so it lives in the kernel (the innermost layer) and
 * `core/` reaches DOWN for it rather than the kernel reaching up.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

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
  detect?: { markers?: readonly string[] };
}

/**
 * Return the unique provider ids whose `detect.markers` resolve to an
 * existing path under `cwd`, in Provider iteration order. No config
 * read, no prompt, no write.
 */
export function detectProvidersFromFilesystem(
  cwd: string,
  providers: ReadonlyArray<IProviderDetectInput>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const provider of providers) {
    if (seen.has(provider.id)) continue;
    const markers = provider.detect?.markers;
    if (!markers || markers.length === 0) continue;
    if (!markers.some((marker) => existsSync(join(cwd, marker)))) continue;
    seen.add(provider.id);
    out.push(provider.id);
  }
  return out;
}
