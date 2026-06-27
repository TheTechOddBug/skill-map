---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

Reworked the `sm tutorial` destination prompt to list providers by vendor name rather than their shared destination folder (several providers share `.agents/skills`), with the open standard shown aka-first. Reorganized the interactive tutorial book: the 'Connect the harness' part is merged into 'The project from zero' so building and wiring the harness is one continuous part, alongside a chapter-by-chapter copy pass across the Claude, Codex and open-standard tracks.

## User-facing

The `sm tutorial` picker now lists each agent by name (Claude, OpenAI Codex, Google's Antigravity) instead of its install folder. The guided tutorial is tighter: building and connecting your project's harness is now one continuous part, with clearer copy throughout.
