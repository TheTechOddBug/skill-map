---
"@skill-map/cli": patch
---

Use a slash-free Sentry release identifier (`skill-map-cli@<version>` instead of `@skill-map/cli@<version>`). Sentry rejects forward slashes in release names, so the CI sourcemap upload failed the moment it ran; the UI SDK was also tagging events with a bare version that never matched the upload. The CLI SDK release tag, the UI SDK release tag, and the CI upload now use the same slash-free value so events resolve against their sourcemaps.
