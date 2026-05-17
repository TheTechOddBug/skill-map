/**
 * Effective-roots resolver for `sm scan`.
 *
 * Centralises the rules in `spec/cli-contract.md` § Scan / Effective
 * roots so every driver (CLI verb, BFF /api/scan, watcher) computes
 * the same set:
 *
 *   - `sm scan [roots...]`: positional roots win verbatim.
 *   - `sm scan` (no positional roots): cwd only (`'.'`).
 *
 * The only way to extend the scan beyond the project root is the
 * positional argument; there is no implicit HOME walk and Providers
 * cannot opt their own directory in.
 *
 * Lives under `core/runtime/` so CLI / BFF / watch share one
 * implementation.
 */

export interface IScanRootsInputs {
  /** Positional roots from `sm scan [roots...]`. Empty when omitted. */
  positionalRoots: readonly string[];
}

/**
 * Compute the effective roots for one scan invocation. See module
 * docstring for the rules.
 */
export function resolveScanRoots(inputs: IScanRootsInputs): string[] {
  if (inputs.positionalRoots.length > 0) {
    // Positional roots are passed verbatim, preserved on
    // `ScanResult.roots` so consumers see the same strings the user
    // typed (the orchestrator validates existence and resolves
    // internally as needed).
    return inputs.positionalRoots.slice();
  }
  // `'.'` matches the historical default the CLI passed verbatim, so
  // `ScanResult.roots` reads the same as a pre-refactor scan.
  return ['.'];
}
