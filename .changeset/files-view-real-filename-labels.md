---
"@skill-map/cli": patch
---

The Files view now labels every leaf by its real filename with extension, keeping the folder path in the dimmed prefix, instead of a folder-derived name that dropped the filename. A skill's `<name>/SKILL.md` shows its containing folder as the bold name with `/SKILL.md` as a dimmed tail, so the folder is never repeated and `SKILL.md` never competes as a second bold name, across tree, folder-row and flat modes and even when a skill is scanned under a foreign provider lens.

## User-facing

The Files list now shows each file's real name (like `intro.md`). For a skill, it shows the skill's folder name in bold and de-emphasizes the `SKILL.md` file inside, so labels are clearer and never read redundantly.
