---
"@skill-map/spec": patch
"@skill-map/cli": minor
---

The codex provider ships the second live-activity adapter: `sm activity install codex` wires `.codex/hooks.json` (same json-hooks convention as claude) and maps `$skill` prompt tokens (same dollar grammar as the `dollar-skill` extractor) plus named SubagentStart/Stop boundaries. The codex row of the spec's informative per-provider table is rewritten to the shipped facts, README gains a live-activity section with a support matrix, and a demo fixture lands at `fixtures/realtime-codex/`.

## User-facing

**Live activity now works with Codex.** Install its hook from Settings or with `sm activity install codex`, then watch your `$skills` and named agents light up on the map as they run (file reads stay dark for now, Codex does not yet expose them).
