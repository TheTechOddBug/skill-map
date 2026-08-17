---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

New `core/observed-node-dead` analyzer: one `info` issue per runnable node (skill, agent, command) that never executed in any recorded session, gated on 20 ACTIVE sessions of evidence. All three design-vs-reality gates are now per-extension integer settings (defaults 20/3/3) via `sm plugins config` or Settings. Because the journal files ARE the evidence, the replay trash now clears the browser tape only; the full wipe stays in Settings. The trio ships `experimental` (disabled until opted in).

## User-facing

skill-map can now tell you which skills, agents, or commands never run: after enough recorded sessions, untouched units get flagged under "Observed in sessions". The replay's trash button now only clears the local tape; deleting the saved session files stays in Settings.
