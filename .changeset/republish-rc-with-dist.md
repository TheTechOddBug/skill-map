---
"@skill-map/cli": patch
---

Republish the release candidate: the previous `0.89.0-rc.0` tarball shipped without its `dist/` directory because the release workflow misread the publish pass as a version pass under changesets pre mode and skipped the build, so `sm` failed to start. The pass detector now subtracts changesets already recorded in `pre.json`, and the changelog generators parse the `-rc.N` suffix. This bump ships a correctly built tarball.
