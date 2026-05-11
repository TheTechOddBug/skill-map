---
"@skill-map/cli": minor
---

Lock `core/annotations` so it can no longer be disabled.

The annotations extractor turns the sidecar `annotations:` block's `supersedes` / `supersededBy` / `requires` / `related` / `conflictsWith` entries into the arrows (edges) drawn in the graph. It does NOT own the rest of that block — `version`, `stability`, `tags`, `description`, `title` live on the node bundle itself (parsed by the kernel directly from the `.sm` sidecar) and keep rendering regardless of which extractors are loaded.

Disabling the extractor produced an asymmetric, confusing state: the graph edges would vanish but the inspector / card kept showing the rest of the sidecar metadata. The split is intentional at the kernel layer (sidecar = node data; extractor = link projection), but the toggle exposed it as a foot-gun.

The lock plugs that gap. `core/annotations` joins `core/markdown` in `src/kernel/config/locked-plugins.ts`, so all three enforcement layers reject the toggle automatically:

- **CLI** — `sm plugins disable core/annotations` exits 5 with the directed "host-locked" message; `--all` quietly skips it.
- **BFF** — `PATCH /api/plugins/core/extensions/annotations` returns 403 `locked`.
- **Runtime resolver** — `plugin-resolver.ts` ignores any persisted `config_plugins` row or `settings.json` entry against the id and returns the installed default (`true`). Defense in depth so the lock holds even against hand-edited state.

To unlock (e.g. when a third-party ships a competing supersession extractor), edit `LOCKED_PLUGIN_IDS` directly — there is no per-environment override and no DB / settings.json escape hatch by design.

## User-facing

`core/annotations` is now host-locked. Settings → Plugins shows its toggle disabled with a "Locked" pill, alongside `core/markdown`. Removes the foot-gun where disabling it dropped graph edges but kept the sidecar metadata visible.
