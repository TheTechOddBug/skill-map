---
"@skill-map/cli": minor
---

Security hardening. `sm serve` now refuses any non-loopback `--host` (the BFF is loopback-only and unauthenticated pre-1.0, Decision #119; off-loopback previously leaned on the DNS-rebinding gate alone). The `/api/nodes/:pathB64` 404 sanitizes the decoded path for the terminal (log-injection parity with sibling routes), the `/ws` broadcaster caps concurrent clients (refuses past the cap with close 1013), and published tarballs now carry npm provenance.

## User-facing

`sm serve` now refuses a non-loopback `--host` (for example `0.0.0.0`): the local server has no auth and is loopback-only, so bind it to `127.0.0.1` or `::1`. Multi-host serve reopens after v0.6.0.
