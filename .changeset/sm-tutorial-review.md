---
"@skill-map/cli": patch
---

Tutorial-review pass on the bundled `sm-tutorial`: the example fixtures stop inventing frontmatter fields skill-map ignores (`args`/`shortcut` on commands, `inputs`/`outputs`/`metadata`/`version`/`tags` on skills and notes, which live in the `.sm` sidecar or nowhere); the `.sm` annotations lesson is de-duplicated across parts; the Maintain section is retitled "Maintain the harness"; and chapters now carry `section.chapter` numbers. `sm --help` also leads with a tutorial call-to-action.

## User-facing

`sm --help` now opens with a pointer to `sm tutorial`, the guided hands-on walkthrough. The tutorial reads cleaner too: the maintain part is renamed, chapters are numbered (5.1, 5.2…), and the annotations lesson no longer repeats across parts.
