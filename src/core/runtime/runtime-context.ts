/**
 * Bridge between Node globals and kernel functions that need a runtime
 * context (`cwd`). The kernel deliberately does NOT read
 * `process.cwd()` itself, that is a CLI / adapter concern. Anywhere a
 * kernel API needs the project working directory, the CLI calls
 * `defaultRuntimeContext()` and passes the value through.
 *
 * `homedir` is intentionally NOT part of this context. Scope is always
 * project-local (`<cwd>/.skill-map/`); the closed list of legitimate
 * `os.homedir()` callers lives in `AGENTS.md` §Project invariants
 * (today: `cli/util/user-settings-store.ts` plus the user-authored
 * `~/` expansion in `core/config/helper.ts` /
 * `core/runtime/reference-paths-walker.ts`). See
 * `spec/cli-contract.md` §Scope is always project-local for the full
 * rule + documented exception.
 *
 * Why a helper instead of inlining `{ cwd: process.cwd() }` in every
 * caller: 8+ command sites consume it; centralising keeps the intent
 * obvious ("use the live process context") and gives one place to
 * extend if a future override (e.g. resolved absolute cwd) is needed.
 *
 * Lives under `core/` so the BFF (`src/server/`) can consume it
 * without crossing into `src/cli/`.
 */

export interface IRuntimeContext {
  cwd: string;
}

export function defaultRuntimeContext(): IRuntimeContext {
  // The single legitimate `process.cwd()` read in core/, this helper
  // exists precisely to lift the live process context into a typed
  // value the rest of core/ consumes via `IRuntimeContext`. Every
  // other core/ module gets `cwd` injected through the bag this
  // returns; only the BFF / CLI adapters call this fabricator.
  // eslint-disable-next-line no-restricted-syntax
  return { cwd: process.cwd() };
}
