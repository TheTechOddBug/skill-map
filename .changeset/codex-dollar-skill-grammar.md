---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Fix the OpenAI Codex connector model, which cloned Claude's grammar and was wrong per the official docs. Under the codex lens, skills are now invoked with `$name` (new `dollar-skill` extractor) not `/name`, `@` is a path-resolved file reference (new `at-file` extractor) not an agent mention, and codex plus the neutral `agent-skills` lens no longer flag skill names as reserved (a `$`-skill cannot shadow a `/` command). Claude and Antigravity are unchanged.

## User-facing

Codex projects: a skill now connects via `$name` (not `/name`), `@file.md` references a file, and a skill named like a built-in (e.g. `model`) is no longer wrongly flagged as a reserved-name collision. `/` is left to Codex's own built-in commands.
