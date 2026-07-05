---
"@skill-map/spec": patch
---

architecture.md corrected two stale statements saying the `core/update-check` hook subscribes to `shutdown`; it subscribes to `boot` (the lifecycle-event table's `boot` row already said so), and the update banner renders above the verb's output.
