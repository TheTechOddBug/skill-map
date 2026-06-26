---
name: Release guide
description: The versioning policy and how a release is cut.
---

# Release guide

Releases are minor bumps unless a breaking change lands. The release
workflow drafts the changelog, bumps the version, publishes, and deploys,
with the publish and deploy steps marked `// parallel` so they run
concurrently.
