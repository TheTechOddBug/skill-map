---
'@skill-map/spec': minor
---

Every extension context (Extractor, Analyzer, Action, Hook) now carries `ctx.log`, a stderr-bound diagnostic channel with one method per level. The guide documents why an extension must never reach for `console.log` (stdout carries the `--json` payload), what the kernel guarantees at the boundary (level gating, ANSI/control-byte stripping, per-line attribution to the qualified extension id), and that secrets are still the author's responsibility.
