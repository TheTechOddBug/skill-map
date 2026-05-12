/**
 * Effective-roots resolver for `sm scan`.
 *
 * Centralises the rules in `spec/cli-contract.md` § Scan / Effective
 * roots so every driver (CLI verb, BFF /api/scan, watcher) computes
 * the same set:
 *
 *   - `sm scan [roots...]`: positional roots win verbatim.
 *   - `sm scan` (no positional roots):
 *       cwd
 *       + scan.extraFolders (resolved against cwd / ~)
 *
 * The user is the sole authority over out-of-project paths: paths in
 * `scan.extraFolders` are listed explicitly by the operator and the
 * write is gated by `--yes` (privacy-sensitive). Providers cannot
 * extend the scan into the user's HOME on their own, each Provider's
 * walker hardcodes the project-relative directories it cares about.
 *
 * Lives under `core/runtime/` so CLI / BFF / watch share one
 * implementation.
 */

import { resolveScanPath } from './reference-paths-walker.js';

export interface IScanRootsInputs {
  /** Positional roots from `sm scan [roots...]`. Empty when omitted. */
  positionalRoots: readonly string[];
  /** Project working directory (cwd of the invocation). */
  cwd: string;
  /** User home directory (used to expand `~/...` entries in extraFolders). */
  homedir: string;
  /** `effective.scan.extraFolders` from the loaded config (raw, unresolved). */
  extraFolders: readonly string[];
}

export interface IScanRootsResolution {
  /** The roots `runScan` should walk. Always at least one entry. */
  roots: string[];
  /**
   * Subset of `roots` that came from `scan.extraFolders`. Surfaced so
   * the CLI can print an "including extra folders: …" advisory.
   */
  fromExtra: string[];
}

/**
 * Compute the effective roots for one scan invocation. See module
 * docstring for the rules.
 */
export function resolveScanRoots(inputs: IScanRootsInputs): IScanRootsResolution {
  if (inputs.positionalRoots.length > 0) {
    // Positional roots are passed verbatim, preserved on
    // `ScanResult.roots` so consumers see the same strings the user
    // typed (the orchestrator validates existence and resolves
    // internally as needed).
    return {
      roots: inputs.positionalRoots.slice(),
      fromExtra: [],
    };
  }

  // Use `'.'` as the cwd entry (matching the historical default the
  // CLI passed verbatim) so `ScanResult.roots` reads the same as a
  // pre-refactor scan. Extra paths are absolute.
  const cwdRoot = '.';
  const extra = inputs.extraFolders.map((r) => resolveScanPath(r, inputs.cwd, inputs.homedir));
  // Dedupe across extras (cwd is `'.'` so a literal collision is
  // impossible at this scope).
  const seen = new Set<string>();
  const out: string[] = [cwdRoot];
  for (const root of extra) {
    if (seen.has(root)) continue;
    seen.add(root);
    out.push(root);
  }
  return { roots: out, fromExtra: extra };
}
