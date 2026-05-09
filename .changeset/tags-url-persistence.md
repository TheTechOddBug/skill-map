---
"@skill-map/cli": minor
---

Tags · URL persistence — deep-link the active tag filter via `?tag` and `?tag-source`.

The click-on-tag filter (Phase 4 of the dual-source tag system) now round-trips through the URL like every other filter on `FilterStoreService`. Sharing a graph view with a teammate, hard-reloading after a click, or opening a bookmarked link all preserve the active tag — including the `'author'` / `'user'` narrowing.

**Wire shape**

- `?tag=<name>` — single tag string. Absent ⇒ no filter. `<name>` is taken verbatim (case-preserving) and matches the dual-source apply pass.
- `?tag-source=author|user` — narrows the match to one source. Omitted (or unrecognised) falls through to `'any'` (union — same default as `sm list --tag <name>`). Ignored when `?tag` is absent.
- `?tag` is emitted to the URL for any active filter, including `'any'`. `?tag-source` is omitted for the union mode so the most-common deep-link form (`?tag=foo`) is also the shortest; only `'author'` / `'user'` filters carry both keys.

**Surface changes** (`ui/src/services/filter-url-sync.ts`)

- New `PARAM_TAG = 'tag'` and `PARAM_TAG_SOURCE = 'tag-source'` constants.
- `applyUrlToFilters()` parses both keys into `{ tag, source }` and pushes through `FilterStoreService.setTagFilter`.
- `computeQueryParams()` projects the active filter back to URL keys (omits `tag-source` for `'any'` mode).
- New helpers `parseTagFilter` and `tagFilterEqual` (private to the module) keep the parse / equality logic pure and testable.
- Header doc updated to enumerate every URL key.

**Tests** (`ui/src/services/filter-url-sync.spec.ts`)

- Seeds the filter from `?tag` (default union mode).
- Seeds the narrow source from `?tag-source`.
- Falls back to union when `?tag-source` is unrecognised.
- Ignores `?tag-source` when `?tag` is absent.
- Pushes a click-on-tag filter into the URL (both keys).
- Omits `tag-source` for the union mode (programmatic `setTagFilter`).
- Clears `?tag` when the filter resets.

**Side fix** — `ui/src/app/components/plugin-contributions/plugin-contributions.ts`: the `RESERVED_BLOCKS` set still listed `'for'`. Renamed to `'identity'` to align with the sidecar identity-block rename (commit `68709b9`); the empty-state test now passes again.

**Out of scope**

- Multi-tag composition (AND / OR) — single-tag covers the deep-link UX. Revisit when faceted multi-tag is real.
- Graph view "fade out non-matching nodes" animation — pending follow-up.

Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.
