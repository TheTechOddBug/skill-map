---
"@skill-map/cli": patch
---

The bundled `sm-tutorial` skill now demos the `claude` provider only; the other providers (`openai`/Codex, `agent-skills`/Antigravity) are presented as "coming soon". Provider detection always resolves to `claude`, the settings lens step drops the live switch to `openai` and shows only the auto-detected `claude` lens, and the project-kickoff markers prompt tells the tester the other lenses are coming soon. The `--provider` fixture plumbing stays wired so they drop in later.

## User-facing

The interactive tutorial now focuses on Claude only. Other assistants (Codex, Antigravity, agent-skills) show as "coming soon" instead of being offered as setup options.
