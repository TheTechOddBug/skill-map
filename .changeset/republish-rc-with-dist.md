---
"@skill-map/cli": patch
---

Republish the release candidate: the previous `0.89.0-rc.0` tarball shipped without its `dist/` directory (the release workflow skipped the build step on the publish pass under changesets pre mode), so `sm` failed to start. This bump ships a correctly built tarball.
