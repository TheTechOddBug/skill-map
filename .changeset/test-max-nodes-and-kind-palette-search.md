---
"@skill-map/cli": patch
---

Internal test coverage for the `--max-nodes` flag surface introduced in the previous release and for the `<sm-kind-palette>` inline search added during the same UI pass:

- `src/cli/commands/__tests__/serve-flags.spec.ts`: four new cases drive `parseMaxNodes` through Clipanion (`--max-nodes 0`, `--max-nodes=-5`, `--max-nodes 1.5`, `--max-nodes abc`) and assert the §3.1b stderr block plus exit 2.
- `src/cli/commands/__tests__/scan-flags.spec.ts` (new): same matrix for `ScanCommand.parseMaxNodesFlag`, exercising the variant of the rejection template used by `sm scan`.
- `src/cli/commands/__tests__/watch-flags.spec.ts` (new): same matrix for `parseMaxNodesLimit` on `sm watch`.
- `src/cli/__tests__/bare-routing.spec.ts` (new): integration spec that spawns `bin/sm.js` against a tmpdir-planted project DB and verifies the bare-invocation router rewrites `sm --max-nodes 0` to `sm serve --max-nodes 0` (surfacing the `sm serve:` rejection), leaves `--help` / `--version` alone, does not rewrite verbs, and falls through to the no-project hint when the cwd has no `.skill-map/`.
- `ui/src/app/components/kind-palette/__tests__/kind-palette.spec.ts`: extended fixture exposes `searchText` as a mutable signal plus a `setSearchText` spy; twelve new cases cover `toggleSearch`, the `--expanded` / `--active` host classes, `aria-expanded`, `onSearchInput` forwarding, Escape keydown collapse + `stopPropagation`, blur-collapse when empty (including whitespace-only) and blur-keep when non-empty, the `searchActive` whitespace policy, and the autofocus effect that fires the microtask after `searchExpanded` flips true.

No production code changes.

Notable testing detail: Clipanion reads a bare `-N` after a flag as a separate short option, so the negative-integer branch of every `--max-nodes` parser is only reachable from the user via the `=` form. The new specs document this with `--max-nodes=-5` style invocations and a comment naming the constraint.
