---
description: Build, test, and ship the project to production in one pass.
---

# Deploy

Run the full release path. Follow the [deploy guide](../../docs/deploy.md)
for the rollback procedure.

// turbo-all

1. Install dependencies

   `npm ci`

2. Run the test suite

   Invoke /run-tests before building so a red suite stops the deploy.

3. Build the artifact

   `npm run build`

4. Tag the release

   Invoke /changelog-entry to append the release note, then push the tag.
