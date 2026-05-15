---
'@skill-map/cli': patch
---

Fix `sm plugins show <bundle>/<ext>` rendering the full parent
bundle's detail instead of the requested extension. The CLI now
branches on whether the resolver returned a qualified id and emits
a focused single-extension block (header + Kind / Version /
Stability / Description / Preconditions / Entry) in human mode,
with `--json` returning just the extension object instead of the
whole bundle envelope. Bare bundle ids (`sm plugins show core`)
keep the original bundle-listing output. Two new renderers
(`renderBuiltInExtensionDetail`, `renderUserExtensionDetail`) plus
a shared `renderExtensionFields` block live in
`src/cli/commands/plugins/show.ts`; the user-plugin path reads
optional metadata off `ILoadedExtension.instance` via a new
`readInstanceMeta` helper. `IBuiltInBundleRow.extensions[]` in
`src/cli/commands/plugins/shared.ts` now carries optional
`description` / `stability` / `preconditions` / `entry`, populated
through a new `extensionRowFromBuiltIn` builder that respects
`exactOptionalPropertyTypes`. Six new tests in
`src/test/plugins-cli.test.ts` replace the previous "renders
parent bundle" assertion (which was locking in the bug) and cover
single-ext built-in + user paths, JSON shape, disabled-glyph
reflection, optional-field surfacing, and a bare-id regression.
Bundled together: `src/test/git-helpers.test.ts` now `t.skip()`s
the two "no `.git/` parent" cases with a directed message when
the host's tmpdir lineage contains a stray `.git/` ancestor (e.g.
`/tmp/.git/`); the branch was unreachable on polluted
environments and the skip keeps the suite green without masking
real coverage (the rest of the file still exercises
`isInsideGitRepo` end-to-end via the project root's real
`.git/`). No spec change: `cli-contract.md` already says "Full
manifest + compat detail" for `sm plugins show <id>`, and the new
behaviour is strictly closer to that wording than the old
dump-the-whole-parent-bundle behaviour.

## User-facing

`sm plugins show <bundle>/<ext>` now shows the requested
extension's own detail (Kind, Version, Stability, Description,
Preconditions, Entry) instead of dumping the parent bundle.
`--json` returns just that extension. Bare bundle ids
(`sm plugins show core`) are unchanged.
