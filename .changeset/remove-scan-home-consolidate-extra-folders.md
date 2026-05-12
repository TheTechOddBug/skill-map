---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Remove the implicit "scan HOME" surface and consolidate every out-of-project scan path under a single, explicit `scan.extraFolders` setting. Privacy-by-default: the CLI / BFF / UI never read the user's home automatically anymore; every path outside the project root must be listed by the operator.

**Removed**

- `scan.includeHome` (project config boolean). The toggle that appended every Provider's HOME path is gone.
- `explorationDir` on the Provider manifest. Built-in providers (`claude`, `gemini`, `agent-skills`, `core-markdown`) no longer declare it; the field is dropped from `spec/schemas/extensions/provider.schema.json`. Each Provider's walker hardcodes the project-relative paths it cares about (e.g. `.claude/`, `.gemini/`, `.agents/`).
- `sm scan -g` / `sm scan --global`. The scan verb no longer accepts the global scope flag (there is no global scan surface once HOME auto-inclusion is gone). Other verbs (`config`, `db`, `plugins`, `init`, …) keep their `-g` flag — those point at `~/.skill-map/` (skill-map's own data dir), not at scanned content.
- `sm plugins doctor` no longer emits the `explorationDir missing` warning.

**Renamed**

- `scan.extraRoots` → `scan.extraFolders` (same shape `string[]`, same semantics — clearer name in the Settings UI and config). Privacy-sensitive: writes that add out-of-project paths still require `--yes` on the CLI and a confirm dialog in the UI.

**BFF**

- `GET /api/project-preferences` response now returns `{ scan: { extraFolders, referencePaths } }` (dropped `includeHome`, renamed `extraRoots`).
- `PATCH /api/project-preferences` accepts the same shape; `additionalProperties: false` still applies.

**UI**

- Settings → Project section drops the "Include HOME folders" toggle; only the "Extra folders to scan" list and "Folders for link validation" list remain.

**Greenfield migration**

No backwards-compat shim. Users with `scan.includeHome: true` or `scan.extraRoots: [...]` in `<cwd>/.skill-map/settings.local.json` (or `~/.skill-map/settings.json`) need to manually rename `extraRoots` → `extraFolders` and, if they want to keep HOME scanning, list the specific paths they care about (e.g. `~/.claude/agents`) in `scan.extraFolders` — instead of opting into "everything under HOME" at once.

## User-facing

The "include HOME" toggle is gone. To scan paths outside the project, list them in **Extra folders to scan** (renamed from *Extra roots*). If you had `scan.includeHome: true`, add the paths you actually need (e.g. `~/.claude/agents`) — not one click anymore.
