---
description: Promote the current staging build to production.
---

# Go live

Run after a green staging deploy. The handle is the filename (`/go-live`),
since Antigravity workflows are always invoked by their file name.

1. Smoke-test staging

   Invoke /run-tests against the staging environment.

2. Flip the traffic

   `npm run promote:prod`
