/**
 * Strings emitted by `core/runtime/progress-emitter.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 *
 * The progress emitter relays orchestrator `extension.error` events to
 * stderr so plugin authors see why a link / issue is silently dropped.
 */

export const PROGRESS_EMITTER_TEXTS = {
  /**
   * Inline stderr advisory shown when the orchestrator drops a link /
   * issue / contribution because of an emit-time contract violation.
   * Glyph is rendered yellow when the caller passes `colorEnabled:
   * true`; the ⚠ character itself prints unconditionally so the line
   * stays meaningful in non-TTY pipes.
   */
  extensionError: '{{glyph}}  {{message}}\n',

  extensionErrorNoDetail: 'extension reported an error (no detail).',
} as const;
