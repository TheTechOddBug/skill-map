import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { PrimeNG, providePrimeNG } from 'primeng/config';

import { routes } from './app.routes';
import { dataSourceFactory } from '../services/data-source/data-source.factory';
import { DATA_SOURCE } from '../services/data-source/data-source.port';
import { SKILL_MAP_MODE, readSkillMapModeFromMeta } from '../services/data-source/runtime-mode';
import { CollectionLoaderService } from '../services/collection-loader';
import { FilterUrlSyncService } from '../services/filter-url-sync';
import { DebugSlotsService } from './services/debug-slots';
import { ProjectInfoService } from './services/project-info';
import { SmTitleStrategy } from './services/title-strategy';
import { UpdateCheckService } from './services/update-check';
import { initUiSentry } from './core/telemetry/sentry-init';
import { SentryUiErrorHandler } from './core/telemetry/sentry-error-handler';

/**
 * Fire-and-forget kickoff for cold-start data probes. Each loader is
 * responsible for its own error handling; failures are silent so the
 * shell still renders. Centralised here so the `provideAppInitializer`
 * factory stays a one-liner and the boot contract ("these services
 * load on app start") lives in one place.
 */
interface IColdStartLoadable {
  load(): Promise<unknown> | unknown;
}

function kickoffColdStart(...services: readonly IColdStartLoadable[]): void {
  for (const s of services) {
    void Promise.resolve(s.load());
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Angular ErrorHandler that funnels uncaught errors to the UI Sentry
    // client (`spec/telemetry.md`, surface `skill-map-ui`). It is wired
    // UNCONDITIONALLY because it is inert until telemetry activates: the
    // wrapper logs to the console (Angular's default behaviour) and only
    // forwards to Sentry once `initUiSentry` has loaded the SDK, which is
    // a no-op while the feature is dormant (the UI DSN placeholder is
    // empty AND consent defaults OFF, so nothing is captured or sent
    // today). It is a thin wrapper (not `Sentry.createErrorHandler()`) on
    // purpose: that keeps the `@sentry/angular` SDK out of the eager
    // bundle (dynamic-imported only on the active path in
    // `sentry-init.ts`). Capture starts working the moment a real DSN
    // lands and the operator opts in, with no provider changes.
    { provide: ErrorHandler, useClass: SentryUiErrorHandler },
    provideRouter(routes, withComponentInputBinding()),
    { provide: TitleStrategy, useClass: SmTitleStrategy },
    provideHttpClient(withFetch()),
    // PrimeNG is provided WITHOUT the Aura preset so the theme tokens
    // (~54 KB) are not pulled into the eager initial chunk. The
    // initializer below dynamic-imports Aura and feeds it through
    // PrimeNG.setThemeConfig() before first render: Angular awaits the
    // returned promise during bootstrap, so there is no flash of
    // unstyled content. See ROADMAP §Step 14.7 bundle hard cut.
    providePrimeNG({}),
    provideAppInitializer(async () => {
      // `inject()` MUST be called synchronously inside the injector
      // context provideAppInitializer establishes for the factory.
      // Capturing the PrimeNG handle BEFORE the dynamic import is
      // mandatory: after the first `await`, Angular has flushed the
      // microtask and we are no longer in an injection context, so a
      // post-await `inject()` throws NG0203 and the app never boots.
      const primeng = inject(PrimeNG);
      const [{ default: Aura }, { definePreset }] = await Promise.all([
        import('@primeuix/themes/aura'),
        import('@primeuix/themes'),
      ]);
      // Aura ships with an emerald primary palette. The skill-map shell
      // uses violet across topbar, public site, and ROADMAP visuals, so
      // we re-key Aura's `primary.*` stops to the `--sm-violet-*` ramp
      // in `ui/src/styles.css`. Anything PrimeNG-driven (highlights,
      // focus rings, demo banner, p-button severity=primary) inherits
      // violet without per-component overrides.
      const SkillMapPreset = definePreset(Aura, {
        semantic: {
          primary: {
            50: '#F5F3FF',
            100: '#EDE9FE',
            200: '#DDD6FE',
            300: '#C4B5FD',
            400: '#A78BFA',
            500: '#8B5CF6',
            600: '#7C3AED',
            700: '#6D28D9',
            800: '#4C1D95',
            900: '#2E1065',
            950: '#1E0A4D',
          },
        },
      });
      primeng.setThemeConfig({
        theme: {
          preset: SkillMapPreset,
          options: {
            darkModeSelector: '.app-dark',
          },
        },
      });
    }),
    // Runtime-mode token: read once from <meta name="skill-map-mode">
    // (defaults to 'live'). The data-source factory branches on it.
    { provide: SKILL_MAP_MODE, useFactory: readSkillMapModeFromMeta },
    { provide: DATA_SOURCE, useFactory: dataSourceFactory },
    // Telemetry arm-up (`spec/telemetry.md`, surface `skill-map-ui`).
    // Runs as an app initializer so it resolves BEFORE the shell renders,
    // arming error capture ahead of the cold-start data probes below. It
    // fetches the per-machine consent flag (`/api/preferences` →
    // `telemetry.errorsEnabled`) and the running impl version
    // (`/api/health` → `implVersion`, the Sentry release tag), then calls
    // `initUiSentry`. The init is a hard no-op while the UI DSN
    // placeholder is empty (dormant by default) AND while consent is OFF,
    // so today this never touches the Sentry network. The whole fetch is
    // wrapped so ANY failure leaves telemetry OFF and the app boots
    // normally: a broken /api call must never block the shell.
    provideAppInitializer(async () => {
      const dataSource = inject(DATA_SOURCE);
      try {
        const [preferences, health] = await Promise.all([
          dataSource.getPreferences(),
          dataSource.health(),
        ]);
        await initUiSentry({
          consentEnabled: preferences.telemetry.errorsEnabled,
          release: health.implVersion ?? null,
        });
      } catch {
        // Consent / version probe is best-effort. A failure means
        // telemetry stays OFF; the app must still boot.
      }
    }),
    // Cold-start data probes, fire in parallel as the SPA boots. The
    // `inject()` calls happen synchronously inside the injection
    // context the factory establishes; `kickoffColdStart` does the
    // fire-and-forget loop with consistent error semantics.
    provideAppInitializer(() => {
      kickoffColdStart(
        inject(CollectionLoaderService),
        inject(UpdateCheckService),
        inject(ProjectInfoService),
      );
    }),
    // Boot-time service wiring: each listed service exposes a "self-wire
    // on construct" contract (router subscriptions, signal effects, root
    // class toggles); see the BOOT CONTRACT note on each service. The
    // bare `inject()` is intentional: we only need the constructor to
    // run before the first route activation. Adding a service here means
    // keeping the same contract (no lazy `init()`); removing one means
    // accepting that its side effects fire on first consumer injection
    // instead of at boot.
    provideAppInitializer(() => {
      inject(FilterUrlSyncService);
      inject(DebugSlotsService);
    }),
  ],
};
