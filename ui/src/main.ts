import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

/**
 * Sentry sourcemap upload (telemetry) is wired in CI. The release workflow
 * (`.github/workflows/release.yml`) builds the UI with the
 * `release-sourcemaps` config (`angular.json`, identical minified output
 * plus HIDDEN `.map` files), strips the maps from the published npm tarball,
 * and uploads them to the `skill-map-ui` Sentry project via `@sentry/cli`,
 * tagged with the release `@skill-map/cli@<version>` (the same tag
 * `initUiSentry` sets). It self-skips unless the `SENTRY_AUTH_TOKEN` secret
 * and the `SENTRY_ORG` repo variable are both set, so until the operator
 * wires Sentry the release is unchanged and the SDK stays dormant. See
 * `spec/telemetry.md` §Surfaces and carrier.
 */
bootstrapApplication(App, appConfig).catch((err) => console.error(err));
