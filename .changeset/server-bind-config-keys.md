---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Add `server.port` / `server.host` project-config keys, resolved through the normal config layering (defaults, project, project-local) with the `--port` / `--host` flags as the per-invocation override, mirroring the `scan.watch.backend` precedent; `sm serve` records the resolved values in `serve.json` and the loopback-only rule applies regardless of which layer supplied the host.

## User-facing

**Pin your port in config.** Set `server.port` (and optionally `server.host`) in `.skill-map/settings.json` and `sm serve` always boots there, no flags needed; `--port` still wins for a one-off run.
