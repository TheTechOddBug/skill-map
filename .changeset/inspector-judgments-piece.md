---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Step 16 piece 1, the inspector findings workbench: three BFF endpoints (`GET /api/nodes/:pathB64/findings` with honesty counts, `GET .../prob-extensions` classifying finder / fixer / standalone launchers, `POST .../jobs` via the same submit engine as the CLI, extracted to `core/jobs/submit-engine.ts`), three new REST envelope kinds, and the inspector "Judgments" card: fresh findings with provenance plus launcher buttons (fixers appear only when a matching finding exists).

## User-facing

The node inspector now shows the AI findings for the file and lets you run analyzers from buttons: detectors are always available, and fix actions appear only when there is a finding for them to resolve. Queued work still runs through your own agent.
