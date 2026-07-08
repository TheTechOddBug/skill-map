---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

Fixes `GET /api/plugins` reporting `status: 'enabled'` for an untrusted drop-in plugin that ships config-enabled (e.g. a `beta` provider). Its code never loads without a local trust grant, so the row now reads `status: 'disabled'` with the untrusted reason (per spec/architecture.md) instead of misleadingly showing as active. Plugin-level, so it covers every kind (provider, extractor, analyzer, action, formatter, hook).

## User-facing

An untrusted drop-in plugin no longer shows as enabled in the plugins list. Until you trust it (Settings, or sm plugins trust), it reads disabled with a hint to trust it, since its code does not run without your trust grant.
