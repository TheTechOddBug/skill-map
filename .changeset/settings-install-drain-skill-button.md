---
"@skill-map/cli": minor
---

The BFF serves the agent-drain-skill endpoints (`GET/POST /api/agent/install`, `POST /api/agent/uninstall`, 412 consent gate, same engine as the CLI verbs), and Settings → Project gains the matching Install skill / Update skill / up-to-date button with confirm dialogs and uninstall. The materialised `sm-run-queue/` folder is ignored by scans out of the box (bundled default, `!`-re-includable).

## User-facing

**Install the drain skill from the UI.** Settings → Project now offers "Install skill" (and "Update skill" when your copy is outdated): one click teaches your agent to drain the job queue, no terminal needed.
