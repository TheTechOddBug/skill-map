---
"@skill-map/cli": patch
---

The release pipeline now uploads CLI source maps to the Sentry Node project (`skill-map-cli`) using debug IDs injected before publish, and the published tarball no longer ships `.map` files when telemetry is configured at build time. A hidden `/intentional-fail` UI route was added as a browser-side Sentry self-test, mirroring the existing `sm intentional-fail` command.
