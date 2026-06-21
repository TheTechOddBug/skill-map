---
"@skill-map/cli": patch
---

`sm tutorial` now lists coming-soon providers in its destination prompt instead of offering them as real targets. Claude is the only selectable destination; OpenAI Codex, Antigravity, and Open Skills appear greyed as "(coming soon)" and re-ask the tester if picked. The prompt still renders on a TTY even with a single selectable target (so the others stay visible), non-TTY stdin takes Claude silently, and `--for <coming-soon-id>` exits with an unknown-provider error.

## User-facing

Running `sm tutorial` now sets up the tutorial for Claude. Other assistants (Codex, Antigravity, Open Skills) show as "coming soon" in the prompt and cannot be selected yet.
