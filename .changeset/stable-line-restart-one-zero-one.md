---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

Republish the stable line as 1.0.1, the first installable stable pair: 1.0.0 is burned on both packages (`@skill-map/spec@1.0.0` was squatted by a premature 2026-04 publish that npm refuses to overwrite, and `@skill-map/cli@1.0.0` shipped pinning it, failing at boot with ENOENT; that version is deprecated on the registry and `latest` was rolled back to 0.99.1 during the incident). No code changes ride this bump.

## User-facing

1.0.0 was dead on arrival (it paired the new CLI with an ancient spec package and failed at boot); 1.0.1 is the real first stable release. If you installed 1.0.0, reinstall with `npm i -g @skill-map/cli`.
