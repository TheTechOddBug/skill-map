# Map views

Named, shareable projections of the workspace map. A map view captures an
operator's curated topology (which subtrees are visible, where the pinned
nodes sit, later which visual groups exist) as one committed JSON file, so
the curation travels to every collaborator through the shared repository
instead of dying in one browser's localStorage.

Schema: [`schemas/map-view.schema.json`](./schemas/map-view.schema.json).
HTTP surface: the `/api/map-views` rows in
[`cli-contract.md` §BFF endpoints](./cli-contract.md). Storage decision:
[`architecture.md` §Storage rule](./architecture.md), fourth home.

## What a view is (and is not)

Skill-map has four mechanisms that decide what the operator sees, and they
must not be confused:

| Mechanism | Scope | Persistence | Effect |
|---|---|---|---|
| `.skillmapignore` (§Scope ignore + `/api/project-ignore`) | Global, all collaborators once committed | Project-root file | Destructive: the path is never scanned, DB rows drop on the next scan |
| **Map view** (this doc) | Per view, shared via git | `.skill-map/views/<slug>.json` | Presentational: hides and arranges without touching the scan or the DB |
| Live map state (overrides, pins, viewport) | Per browser | localStorage | The working canvas; a view is saved FROM it and applied INTO it |
| Isolate / tag selection | Per session | In-memory only | Ephemeral lenses, deliberately not persisted |

A view carries HUMAN curation only. No machine process may author or
rewrite a view file; implementations MAY at most propose changes (the
future `view-ref-broken` analyzer described below) that the operator
applies through ordinary consent-gated surfaces.

## File location and identity

One file per view: `<scopeRoot>/.skill-map/views/<slug>.json`.

- The **filename is the identity**. The slug MUST match the `Slug` rule of
  the schema (`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`): 1-64 lowercase
  alphanumerics and hyphens, no leading or trailing hyphen. The rule
  structurally forbids `/`, `\` and `.`, so a conforming slug cannot
  traverse outside the views directory; implementations MUST reject a
  non-conforming slug at every write surface.
- The slug is derived from the display `name` once, at creation; renaming
  the display name never re-derives the slug (the filename is a stable
  handle for git history and deep links).
- `views/` is deliberately ABSENT from the scope ignore file
  (§Scope ignore file in `cli-contract.md`): like `settings.json` and
  `plugins/`, view files are trackable by default and committed by intent.
- The directory is created lazily on the first write; an absent directory
  reads as zero views.

## Canonical serialization

A writer MUST emit exactly this form, so identical curation yields
byte-identical files and diffs stay reviewable:

- UTF-8, LF line endings, 2-space indent, single trailing newline.
- Top-level key order: `schemaVersion`, `kind`, `name`, `description`,
  `overrides`, `pins`, `groups`.
- `pins` keys byte-sorted ascending.
- `overrides` array order preserved VERBATIM: it is the include seniority
  of §Map scope overrides (`cli-contract.md`), not a sortable list.
- `description` and `groups` omitted when empty; no `null` values.
- No timestamps. A view file is a pure function of curated state; history
  and authorship belong to git.

## Apply semantics

Applying a view replaces the live curation:

- `overrides` replace the live override map verbatim (same evaluation rule
  as §Map scope overrides; the branch projection stays stateless, the
  client compiles the view onto the existing wire form).
- `pins` replace the live manual pin set: prior manual pins are demoted to
  auto-layout, view pins become manual. Unpinned nodes are re-laid-out by
  the consumer's auto-layout.
- The viewport (camera) never travels; filters (attribute-based hiding)
  never travel; which view is active is per-developer local state and
  never travels.

**Dead references are legal.** A view whose override keys, pin keys, or
group members no longer resolve to scanned nodes MUST still apply: the
dead references are ignored (an override key that matches nothing simply
matches nothing) and their count is surfaced to the operator. The server
never rewrites a view file to prune them; pruning is a human act. A future
built-in `view-ref-broken` analyzer MAY lint committed view files and a
companion fixer MAY propose the pruned file through the ordinary findings
pipeline; both are reserved surface, not part of this contract yet.

## Groups (reserved)

The `groups` array ships in the schema from day one so that grouping UI
(wave 2) needs no file migration. Wave-1 implementations MUST round-trip
the array verbatim on save. A group is spatial presentation inside one
view (a titled, optionally colored container of member nodes); semantic
classification stays with tags.

## Concurrency

Writes are last-write-wins. Two operators editing the same view
concurrently resolve through git like any other committed file; the merge
and review layer is the repository, not the implementation. Implementations
SHOULD write atomically (temp file plus rename) so a crashed write never
leaves a half-serialized view.

## Stability

- The document shape (`schemaVersion` 1, the five top-level keys plus
  optional `description` and `groups`) is stable as of spec v1.10. Adding
  a new OPTIONAL top-level key is a minor bump; making one required,
  renaming, or removing one is a major bump.
- The Slug rule, the canonical serialization, and the dead-reference
  tolerance are stable; tightening any of them is a major bump.
- The `groups` entry shape (`id`, `label`, required `members`, optional
  `color`, `position`, `size`) is reserved but stable; wave-2 grouping
  must build on it additively.
- The `/api/map-views` endpoint family follows the endpoint table in
  `cli-contract.md`; adding endpoints or optional body fields is a minor
  bump.
