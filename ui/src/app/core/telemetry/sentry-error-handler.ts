/**
 * Angular `ErrorHandler` that forwards uncaught errors to the UI Sentry
 * client (`spec/telemetry.md`, surface `skill-map-ui`).
 *
 * This wrapper exists instead of `Sentry.createErrorHandler()` so the
 * `@sentry/angular` SDK stays OUT of the eager bundle: it imports only
 * `captureUiException` from `sentry-init.ts`, which dynamic-imports the
 * SDK and is a no-op until telemetry actually activates (real DSN +
 * operator consent). While the feature is dormant (always, today) this
 * handler behaves exactly like Angular's default: it logs to the console
 * and nothing leaves the browser.
 *
 * The forward is unconditional and harmless: `captureUiException` short
 * -circuits to nothing until the SDK is loaded and initialised, and when
 * it is, scrubbing still runs in the SDK `beforeSend` hook so no raw
 * error escapes un-scrubbed.
 */

import { ErrorHandler, Injectable } from '@angular/core';

import { captureUiException } from './sentry-init';

@Injectable()
export class SentryUiErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    // Preserve Angular's default behaviour: surface the error in the
    // console for local debugging regardless of telemetry state.
    console.error(error);
    // No-op until telemetry is active (dormant by default).
    captureUiException(error);
  }
}
