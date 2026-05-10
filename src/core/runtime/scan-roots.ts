/**
 * Effective-roots resolver for `sm scan`.
 *
 * Centralises the rules in `spec/cli-contract.md` § Scan / Effective
 * roots so every driver (CLI verb, BFF /api/scan, watcher) computes
 * the same set:
 *
 *   - `sm scan [roots...]`: positional roots win verbatim.
 *   - `sm scan` (project scope, no positional roots):
 *       cwd
 *       + (scan.includeHome ? HOME provider explorationDirs : [])
 *       + scan.extraRoots (resolved against cwd / ~)
 *   - `sm scan -g` (global scope):
 *       HOME provider explorationDirs only.
 *       Mutually exclusive with positional roots — caller validates.
 *
 * Provider HOME exploration dirs are derived from
 * `IProvider.explorationDir` entries that resolve against `~` (e.g.
 * `~/.claude`, `~/.gemini`, `~/.agents`). Provider entries that do
 * NOT start with `~` are project-relative (e.g. `agent-skills`'
 * `.agents`); they are intentionally skipped here because
 * `includeHome` and `-g` are about HOME, not project-local conventions.
 *
 * Lives under `core/runtime/` so CLI / BFF / watch share one
 * implementation.
 */

import { resolve } from 'node:path';

import type { IProvider } from '../../kernel/extensions/index.js';
import { resolveScanPath } from './reference-paths-walker.js';

export interface IScanRootsInputs {
  /** Positional roots from `sm scan [roots...]`. Empty when omitted. */
  positionalRoots: readonly string[];
  /** Effective scope: `'global'` for `-g`, `'project'` otherwise. */
  scope: 'project' | 'global';
  /** Project working directory (cwd of the invocation). */
  cwd: string;
  /** User home directory (used to expand `~/...` entries). */
  homedir: string;
  /** Active providers (built-ins + plugins) — source of `explorationDir`. */
  providers: readonly IProvider[];
  /** `effective.scan.includeHome` from the loaded config. */
  includeHome: boolean;
  /** `effective.scan.extraRoots` from the loaded config (raw, unresolved). */
  extraRoots: readonly string[];
}

export interface IScanRootsResolution {
  /** The roots `runScan` should walk. Always at least one entry. */
  roots: string[];
  /**
   * Subset of `roots` that are HOME-rooted exploration dirs (added by
   * `includeHome` or `-g`). Surfaced so the CLI can print a
   * "including HOME: ~/.claude, ~/.gemini, …" advisory.
   */
  fromHome: string[];
  /**
   * Subset of `roots` that came from `scan.extraRoots`. Surfaced for
   * the same reason.
   */
  fromExtra: string[];
}

/**
 * Compute the effective roots for one scan invocation. See module
 * docstring for the rules.
 *
 * Throws when `scope === 'global'` AND `positionalRoots` is non-empty
 * — callers are expected to validate up front; this throw is the
 * defence-in-depth net.
 */
// Cyclomatic complexity is high by construction — every branch maps
// to one rule in the spec's § Effective roots table; splitting per
// branch scatters the table without making it clearer.
// eslint-disable-next-line complexity
export function resolveScanRoots(inputs: IScanRootsInputs): IScanRootsResolution {
  if (inputs.scope === 'global' && inputs.positionalRoots.length > 0) {
    throw new Error(
      'sm scan -g is mutually exclusive with positional roots — pass one or the other, not both.',
    );
  }

  if (inputs.positionalRoots.length > 0) {
    // Positional roots are passed verbatim — preserved on
    // `ScanResult.roots` so consumers see the same strings the user
    // typed (the orchestrator validates existence and resolves
    // internally as needed).
    return {
      roots: inputs.positionalRoots.slice(),
      fromHome: [],
      fromExtra: [],
    };
  }

  const fromHome = collectHomeProviderDirs(inputs.providers, inputs.homedir);

  if (inputs.scope === 'global') {
    if (fromHome.length === 0) {
      // No HOME exploration dirs registered — fall back to `~` itself
      // so the scan still has a valid root. Pathological case (no
      // providers active or every provider is project-local), but the
      // empty-roots crash would be a worse experience.
      return { roots: [resolve(inputs.homedir)], fromHome: [resolve(inputs.homedir)], fromExtra: [] };
    }
    return { roots: fromHome.slice(), fromHome, fromExtra: [] };
  }

  // Use `'.'` as the cwd entry (matching the historical default the
  // CLI passed verbatim) so `ScanResult.roots` reads the same as a
  // pre-refactor scan. HOME / extra paths are absolute.
  const cwdRoot = '.';
  const extra = inputs.extraRoots.map((r) => resolveScanPath(r, inputs.cwd, inputs.homedir));
  const homeAppend = inputs.includeHome ? fromHome : [];
  // Dedupe across HOME + extras (cwd is `'.'` so a literal collision
  // is impossible at this scope).
  const seen = new Set<string>();
  const out: string[] = [cwdRoot];
  for (const root of [...homeAppend, ...extra]) {
    if (seen.has(root)) continue;
    seen.add(root);
    out.push(root);
  }
  return { roots: out, fromHome: homeAppend, fromExtra: extra };
}

/**
 * Collect every `provider.explorationDir` that starts with `~` into
 * absolute paths against `homedir`. Project-relative entries are
 * skipped — they are not "HOME" dirs even though they share the same
 * field. Deduped while preserving registration order so the output is
 * stable across runs.
 */
function collectHomeProviderDirs(
  providers: readonly IProvider[],
  homedir: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const provider of providers) {
    const raw = provider.explorationDir;
    if (typeof raw !== 'string' || raw.length === 0) continue;
    if (!raw.startsWith('~')) continue;
    const abs = resolveScanPath(raw, homedir, homedir);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}
