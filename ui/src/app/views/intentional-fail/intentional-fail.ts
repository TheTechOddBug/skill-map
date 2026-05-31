/**
 * `<sm-intentional-fail>`, hidden maintainer self-test route for the UI
 * Sentry error surface (`spec/telemetry.md`, surface `skill-map-ui`).
 *
 * Browser-side mirror of the CLI's `sm intentional-fail`
 * (`src/cli/commands/intentional-fail.ts`). It exists ONLY so a maintainer
 * can verify end to end that opt-in browser error reporting reaches Sentry
 * AND that the uploaded hidden sourcemaps symbolicate the stack: the throw
 * below lives in this lazy chunk's bundled JS, so a resolved frame proves
 * the `release-sourcemaps` build + `@sentry/cli sourcemaps upload` for
 * `skill-map-cli@<implVersion>` lines up with the shipped bundle.
 *
 * HIDDEN BY CONSTRUCTION: the route (`app.routes.ts`) is never added to the
 * nav, so it is reachable only by typing `/intentional-fail`. There is no
 * affordance in the shell.
 *
 * It defers the throw to the next macrotask instead of throwing inside
 * `ngOnInit` synchronously: a deferred throw becomes a GENUINE uncaught
 * browser error rather than something Angular's render pipeline might
 * absorb. The capture path then depends on the change-detection mode, and
 * BOTH reach Sentry:
 *   - zone.js (default): zone.js routes the `setTimeout` error to Angular's
 *     `ErrorHandler` (`SentryUiErrorHandler` -> `captureUiException`).
 *   - zoneless: the error surfaces on `window.onerror`, caught by the SDK's
 *     default global-handlers integration (kept active in `sentry-init.ts`).
 *
 * When UI telemetry is dormant (empty DSN, or consent off) it simply throws
 * locally and sends nothing, exactly like the CLI self-test.
 */

import { ChangeDetectionStrategy, Component } from '@angular/core';
import type { OnInit } from '@angular/core';

import { INTENTIONAL_FAIL_TEXTS } from '../../../i18n/intentional-fail.texts';

@Component({
  selector: 'sm-intentional-fail',
  template: `<p class="sm-intentional-fail" data-testid="intentional-fail">{{ texts.triggering }}</p>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntentionalFail implements OnInit {
  protected readonly texts = INTENTIONAL_FAIL_TEXTS;

  ngOnInit(): void {
    // eslint-disable-next-line no-console
    console.warn(INTENTIONAL_FAIL_TEXTS.triggering);
    // Deferred so it escapes the render cycle and surfaces as a real
    // uncaught error (see the class doc for the two capture paths).
    setTimeout(() => {
      throw new Error(INTENTIONAL_FAIL_TEXTS.errorMessage);
    }, 0);
  }
}
