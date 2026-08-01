/**
 * Angular `ErrorHandler` feeding the per-incident crash-report consent
 * flow (`spec/telemetry.md` §Per-incident crash-report consent).
 *
 * This wrapper exists instead of `Sentry.createErrorHandler()` so the
 * `@sentry/angular` SDK stays OUT of the eager bundle, and, under the
 * per-incident model, so nothing is ever captured before the operator
 * answered: the handler never calls `captureUiException` itself. It logs
 * to the console (Angular's default behaviour) and hands the error to
 * `CrashReportConsentService`, which dedupes, opens the consent dialog,
 * and captures only on an accept. While the surface is dormant (empty
 * DSN, demo mode) the hand-off is a no-op and this handler behaves
 * exactly like Angular's default.
 */

import { ErrorHandler, Injectable, inject } from '@angular/core';

import { CrashReportConsentService } from './crash-report-consent';

@Injectable()
export class SentryUiErrorHandler implements ErrorHandler {
  private readonly crashConsent = inject(CrashReportConsentService);

  handleError(error: unknown): void {
    // Preserve Angular's default behaviour: surface the error in the
    // console for local debugging regardless of telemetry state.
    console.error(error);
    // Per-incident consent: dedupe + dialog + capture-on-accept.
    this.crashConsent.offer(error);
  }
}
