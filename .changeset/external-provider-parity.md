---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

External drop-in Providers now reach parity with built-ins. A `kinds/<name>/kind.json` may declare `identifiers` / `identifierMismatch`, and the provider manifest accepts `resolution` and `reservedNames`. The loader strips the `activity` capability's runtime-only fields from the validated view, so a drop-in can ship a live-activity adapter; the scan claims a drop-in lens's territory ahead of the markdown fallback; and `sm activity` resolves trusted drop-in Providers, not only built-ins.
