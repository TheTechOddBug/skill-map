---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

The scan now folds the project root `.gitignore` into its ignore stack only when the new committed `scan.respectGitignore` key is enabled (default `false`): out of the box a git-ignored note is still indexed unless the bundled defaults, `config.ignore`, or `.skillmapignore` exclude it. The one-shot scan, `sm scan compare-with`, and the live watcher all honour the flag, and a team-shared toggle sits at the end of Settings > Project.

## User-facing

Skill-map no longer skips the files your `.gitignore` skips by default, so notes you keep out of git now show up on the map. A new team-shared toggle at the end of Settings > Project ("Use .gitignore") turns the old behavior back on for the whole project.
