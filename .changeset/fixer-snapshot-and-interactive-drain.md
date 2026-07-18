---
'@skill-map/cli': patch
---

The three fixer prompts (`ai-redundancy-action`, `ai-contradiction-action`, `ai-incoherence-action`) now tell the draining agent the embedded copy is a submit-time snapshot: a sibling fixer may have edited the file since, so it reads the live file before editing and declines findings already resolved. The `sm-run-queue` drain skill gains matching fixer guidance: confirm the edit with the user when interactive, edit and report when unattended. `sm agent install` refreshes a materialised copy.

## User-facing

Fix jobs now tell agents to read the live file instead of trusting a possibly-outdated snapshot, and to check with you before editing when you are there. Run `sm agent install` to refresh the skill.
