---
"@skill-map/cli": patch
---

Every affordance that would queue an AI job is now disabled while no processing agent is set up for the active lens: the inspector's summarize and auto-tag buttons (which gain a short tooltip saying what is missing) plus the AI Actions launchers, run-all links and per-finding fix buttons, whose own tooltips are untouched. A shared readiness probe backs all of them and fails open, so a transport hiccup never locks the UI.

## User-facing

Buttons that need an AI agent are now clearly disabled until you set one up, instead of looking clickable and failing.
