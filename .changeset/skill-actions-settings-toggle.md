---
"@skill-map/spec": patch
"@skill-map/cli": patch
---

Skill actions gain a project-local offering toggle, `skillActions.enabled` (default true), surfaced in Settings > Project below the external-symlinks opt-in: when off, the prob-extensions `skills` bucket empties and `skill:` submits refuse not-found, read fresh per request so it applies without restarts. The root READMEs (EN/ES) document the catalog folder and install command.

## User-facing

New Settings > Project toggle: Skill actions (on by default). Turn it off to hide installed skills from the AI actions panel; the setting text explains where skills live (.skill-map/.agents/skills/<name>/SKILL.md) and that new installs load on server restart.
