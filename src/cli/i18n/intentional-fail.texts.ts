/**
 * Strings for the hidden `sm intentional-fail` Sentry self-test command
 * (`cli/commands/intentional-fail.ts`). English-only per the i18n convention.
 * No em dashes (lint-enforced in `*.texts.ts`).
 *
 * Strings are color-free and carry their own line endings (the printer never
 * appends one); the command wraps glyphs through `IAnsi` at the call site so
 * a `NO_COLOR` run reads the same bytes, per `context/cli-output-style.md`.
 */

export const INTENTIONAL_FAIL_TEXTS = {
  triggering:
    'Triggering an intentional uncaught error to exercise Sentry crash reporting; expect the crash-report prompt next...\n',
  errorMessage: 'skill-map intentional failure (Sentry self-test)',

  /**
   * Refusal lines for the two HARD gates. The self-test is only meaningful
   * when a report could actually leave the machine; missing consent is not
   * refused because the per-incident prompt is itself the consent.
   */
  refusedKillSwitch:
    'Telemetry is forced off by SKILL_MAP_TELEMETRY=0, so nothing could reach Sentry. No error was triggered.\n',
  refusedDsnDormant:
    'No Sentry DSN is configured in this build, so the error surface is dormant. No error was triggered.\n',
} as const;
