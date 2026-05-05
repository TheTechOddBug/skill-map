/**
 * Shared text catalogue for `core/watcher/runtime.ts`-emitted
 * advisories. The CLI and BFF adapters render their own `*.texts.ts`
 * framing AROUND these strings (`watcher: <message>`,
 * `watcher batch failed: <message>`), so the runtime keeps them
 * spartan to avoid double-prefixing.
 *
 * Convention: flat string templates with `{{name}}` placeholders.
 * The `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const RUNTIME_TEXTS = {
  /**
   * Reused by both CLI (initial-scan path) and BFF (per-batch handler)
   * when the prior snapshot fails strict schema validation. Format
   * variables: `{{errors}}` (AJV failure list).
   */
  priorSchemaValidationFailed:
    'prior scan-result loaded from DB failed schema validation: {{errors}}. ' +
    'Run `sm db backup` then re-scan without --strict to rebuild from disk.',
} as const;
