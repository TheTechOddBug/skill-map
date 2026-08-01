---
'@skill-map/cli': minor
---

Raising the log level opened an almost empty room: one `debug` call in the whole codebase and no `trace` at all. The four paths an operator needs when something looks wrong now speak: plugin discovery and per-plugin skip reasons at `debug`, and at `trace` the per-node Provider/kind claim, the extractor cache hit-or-rerun count, and which drop reason `core/reference-broken` applied to a broken edge. Hot loops guard on a level check so silenced lines build no strings.
