/**
 * Strings for the hidden `sm intentional-fail` Sentry self-test command
 * (`cli/commands/intentional-fail.ts`). English-only per the i18n convention.
 * No em dashes (lint-enforced in `*.texts.ts`).
 */

export const INTENTIONAL_FAIL_TEXTS = {
  triggering:
    'Triggering an intentional uncaught error to exercise Sentry error reporting...',
  errorMessage: 'skill-map intentional failure (Sentry self-test)',
} as const;
