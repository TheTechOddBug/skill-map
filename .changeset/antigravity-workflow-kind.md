---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Give the Antigravity provider its own `workflow` kind and promote it to `beta` (enabled by default). Under the antigravity lens, `.agent/workflows/<name>.md` (singular `.agent`) classifies as a `workflow` node (handle = filename) while skills keep the open-standard `.agents/skills/` classifier. The slash extractor now runs under antigravity, so `/name` resolves to both skills and workflows, reserved verbs are flagged on both, and `.agent/workflows/` auto-detects the lens.

## User-facing

**Antigravity is on by default now.** A project with a `.agent/workflows/` folder auto-detects the Antigravity lens; those files show up as workflows (not plain Markdown), and a `/name` reference links to the matching workflow or skill.
