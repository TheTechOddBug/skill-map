---
'@skill-map/cli': minor
---

Add a UI surface for editing the project's `.skillmapignore` file from
Settings → Project. The new section sits below "Folders for link
validation" and uses the same add / remove list pattern, so the
operator can manage gitignore-style scan filters without opening the
file by hand.

**Server (`src/server/`):**

- `util/skillmapignore-io.ts`: new pure helper. `readPatterns(cwd)`
  parses `<cwd>/.skillmapignore`, dropping comments (`# ...`) and
  blank lines, trimming entries. `writePatterns(cwd, patterns)`
  round-trips the file preserving any prior comments + blank lines
  in their original positions: patterns the operator removed
  disappear in place, new patterns append at the end, and the file
  always ends with a trailing newline. CRLF input is tolerated; the
  writer normalises to LF. `buildContent` is exported so the unit
  tests can exercise the round-trip logic without disk I/O.
- `routes/project-ignore.ts`: new route. `GET /api/project-ignore`
  returns `{ patterns: string[] }`. `PATCH /api/project-ignore`
  takes the same shape, validates server-side (AJV: array of
  non-empty single-line strings with no ASCII control characters;
  post-trim duplicate detection; canonicalising trim), writes via
  the helper, and best-effort restarts the watcher so the next
  batch picks up the new ignore filter. No privacy gate (ignore
  patterns only NARROW the scan surface) and no existence check
  (entries are patterns, not paths).
- `app.ts`: route registered immediately after
  `project-preferences` so the route table groups all
  project-scope endpoints.
- `i18n/server.texts.ts`: new `projectIgnore*` key family for the
  body validator, persist failure, watcher restart advisory, and
  per-pattern audit lines (`project-ignore: + foo/`).

**UI (`ui/src/`):**

- `models/api.ts`: `IProjectIgnoreApi` / `IProjectIgnorePatchApi`
  mirror the new wire envelope.
- `services/data-source/data-source.port.ts` +
  `rest-data-source.ts` + `static-data-source.ts`: new
  `getProjectIgnore` / `setProjectIgnore` methods. Static (demo)
  returns `{ patterns: [] }` on read and rejects writes with
  `demo-readonly`.
- `app/components/settings-modal/settings-project.{ts,html}`:
  second list-row added below the existing reference-paths
  section, mirroring its visual pattern (label, description, item
  list, add input + button). Lives in the same component so the
  Settings → Project panel stays cohesive. Client-side validation
  rejects empty / whitespace-only patterns, patterns with control
  characters, and duplicates before issuing the PATCH; server
  errors surface in a scoped `<p-message>`.
- `i18n/settings.texts.ts`: new `project.ignorePatterns*` strings
  (label, description, placeholder, validation messages, add /
  remove labels). Tone matches the existing `referencePaths*`
  block.

**Tests:**

- `server/util/__tests__/skillmapignore-io.spec.ts`: helper
  round-trip cases (missing file, comments + blanks preserved,
  pattern removal drops the line in place, new patterns append,
  CRLF tolerated, empty result clears the file).
- `server/routes/__tests__/project-ignore-route.spec.ts`: GET +
  PATCH happy paths, comment preservation across a write, every
  400 branch (no `patterns` key, non-array, newline-in-pattern,
  whitespace-only, duplicate-after-trim), empty-list clearing the
  file.

## User-facing

Settings → Project gains a new **Ignored patterns** section to edit `.skillmapignore` from the UI: add or remove each pattern, the scan refreshes instantly. Comments and blank lines in the file are preserved on save.
