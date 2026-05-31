/**
 * Strings for the hidden `/intentional-fail` UI Sentry self-test route
 * (`app/views/intentional-fail/intentional-fail.ts`). Browser-side mirror of
 * the CLI's `sm intentional-fail` command (`src/cli/i18n/intentional-fail.texts.ts`).
 * English-only per the i18n convention. No em dashes (lint-enforced in `*.texts.ts`).
 */

export const INTENTIONAL_FAIL_TEXTS = {
  triggering:
    'Triggering an intentional uncaught error to exercise UI Sentry error reporting...',
  errorMessage: 'skill-map UI intentional failure (Sentry self-test)',
} as const;
