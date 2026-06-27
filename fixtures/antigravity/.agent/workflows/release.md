---
description: "Cut a release: changelog, version bump, and deploy."
---

# Release

Compose the smaller workflows into a release. See the
[release guide](../../docs/release.md) for the versioning policy.

1. Write the changelog entry

   Invoke /changelog-entry to draft the note from the merged PRs.

// turbo
2. Bump the version

   `npm version minor`

// turbo
3. Publish the package

   `npm publish`

4. Deploy to production

   Invoke /deploy to ship the freshly published build.
