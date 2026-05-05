/**
 * Bridge between Node globals and kernel functions that need a runtime
 * context (`cwd`, `homedir`). The kernel deliberately does NOT read
 * `process.cwd()` / `os.homedir()` itself — those are CLI / adapter
 * concerns. Anywhere a kernel API needs them, the CLI calls
 * `defaultRuntimeContext()` and passes the values through.
 *
 * Why a helper instead of inlining `{ cwd: process.cwd(), homedir: homedir() }`
 * in every caller: 8+ command sites consume it; centralising keeps the
 * intent obvious ("use the live process context") and gives one place
 * to extend if a future override (e.g. resolved absolute cwd) is needed.
 *
 * Lives under `core/` so the BFF (`src/server/`) can consume it without
 * crossing into `src/cli/`. The historic `cli/util/runtime-context.ts`
 * import path keeps working through a re-export shim there.
 */

import { homedir } from 'node:os';

export interface IRuntimeContext {
  cwd: string;
  homedir: string;
}

export function defaultRuntimeContext(): IRuntimeContext {
  return { cwd: process.cwd(), homedir: homedir() };
}
