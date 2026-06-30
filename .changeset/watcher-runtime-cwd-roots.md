---
"@skill-map/cli": patch
---

Anchor the watcher runtime's scan roots to `runtimeContext.cwd` instead of `process.cwd()` (the walker's fallback for a bare `.`). A no-op for real `sm serve` / `sm watch` runs, where the two coincide; it keeps the scan, the watcher subscription, and the config layer all anchored to the same directory when a caller supplies a `cwd` that differs from the process cwd.
