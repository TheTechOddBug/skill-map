---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Wired the `tokenizer` project-config key to actually select the scan encoder. It is now a closed enum (`cl100k_base` default, `o200k_base`); the resolved name is recorded in `scan_meta.tokenizer` / `ScanResult.tokenizer` and an out-of-set value is dropped with a warning and falls back to the default. The orchestrator lazily loads only the chosen `js-tiktoken` rank table, and an incremental scan recomputes per-node token counts when the persisted encoder differs from the resolved one.

## User-facing

**Pick your tokenizer.** `tokenizer` in settings.json now selects the encoder for token counts: `cl100k_base` (default, GPT-4) or `o200k_base` (GPT-4o). Any other value is ignored with a warning. Changing it recomputes counts on the next scan.
