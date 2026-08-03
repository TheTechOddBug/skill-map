---
"@skill-map/cli": patch
"@skill-map/spec": minor
---

Materialised skill folders no longer land in commits. `sm agent install` and `sm tutorial` drop a `.gitignore` (a bare `*`, which hides the file itself too) inside the folder they create, same doctrine as `.skill-map/.gitignore`: the rule lives in the directory it describes, the project-root `.gitignore` is never touched. Creation only, never over an existing file, and out of the staleness comparison so deleting it stays an opt-out. The default scan ignore also gained `sm-tutorial/`.

## User-facing

The skill folders `sm agent install` and `sm tutorial` create are generated copies, so they now ship a `.gitignore` that keeps them out of your commits, and the tutorial folder no longer shows up in your map. Delete that file if you would rather commit it.
