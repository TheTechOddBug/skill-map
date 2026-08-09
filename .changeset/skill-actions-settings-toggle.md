---
"@skill-map/spec": patch
"@skill-map/cli": patch
---

Skill actions gain a project-local offering toggle, `skillActions.enabled` (default false, opt-in), surfaced in Settings > Project below the external-symlinks opt-in: while off, the prob-extensions `skills` bucket stays empty and `skill:` submits refuse not-found; the key is read fresh per request so flips apply without restarts. The root READMEs (EN/ES) document the catalog folder and install command.

## User-facing

New Settings > Project toggle: Skill actions (off by default). Turn it on to offer installed skills in the AI actions panel; the setting text explains where skills live (.skill-map/.agents/skills/<name>/SKILL.md) and that new installs load on server restart.
