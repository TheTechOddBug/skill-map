---
'@skill-map/cli': patch
---

Perf follow-up: the scan result fingerprint now hashes through a streaming canonical writer (no multi-MB intermediate string per warm scan), and the pure-JS boot dependencies (clipanion, smol-toml, js-yaml, semver, ignore) are bundled into the dist chunks, cutting eager module loads on startup from ~45 to 14 and `sm --version` to ~135 ms on the reference machine.
