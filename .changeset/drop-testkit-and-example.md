---
'@skill-map/cli': minor
'@skill-map/spec': minor
'@skill-map/web': patch
---

Remove `@skill-map/testkit` and `examples/hello-world` from the monorepo.
The packaged plugin-author helper layer is retired. Plugin authors test
extensions by building fake `ctx` literals against the public types
re-exported from `@skill-map/cli` (`IExtractor`, `IAnalyzer`,
`IFormatter`, the matching `*Context` shapes, `Node`, `Link`, `Issue`).
Reason: zero downstream consumers in the public ecosystem after Step
9.3; the maintenance cost of an independently-versioned npm package +
its own changesets, validate phases, and narrative outweighed the value
of a thin packaged helper layer.

**`spec/plugin-author-guide.md`:**

- §Testing rewritten as "Testing your plugin": shows the fake-`ctx`
  pattern inline (extractor + analyzer + formatter + probabilistic
  runner), with the public types coming from `@skill-map/cli`.
- §Stability footer updated to reference Step 10 for future
  Action / Hook testing patterns instead of testkit coverage.
- §Providers / Actions advisory wording no longer references the
  testkit roadmap.

**`spec/architecture.md`:**

- `src/` directory tree drops the `testkit/` row.
- Qualified-id example list swaps `hello-world/greet` for the
  generic `my-plugin/my-extractor`.

**Monorepo plumbing** (no end-user impact):

- `pnpm-workspace.yaml`, root `package.json`, `Dockerfile`, and
  `scripts/check-changeset.js` drop the `testkit/` and
  `examples/hello-world/` entries.
- `context/scripts.md`, `context/kernel.md`, `context/notebooklm.md`,
  `ROADMAP.md`, `CONTRIBUTING.md`, `AGENTS.md`, `.claude/agents/commit.md`,
  and `scripts/build-user-changelog.js` updated to reflect the
  two-public-package surface (`@skill-map/spec` + `@skill-map/cli`).
- `src/__tests__/integration/dockerfile-demo-assets.spec.ts` drops
  the obsolete `COPY` assertions for both removed workspaces.
- JSDoc in `src/kernel/registry.ts` replaces the `hello-world/greet`
  example with `my-plugin/my-extractor`.

**`web/modules/roadmap.js`:**

- Step 9 card (EN + ES, release tag + brief) drops the
  `@skill-map/testkit` mention.

**Post-merge action required**: run
`/usr/bin/npm deprecate "@skill-map/testkit@*" "Subsumed: plugin authors
test against @skill-map/cli types directly. See
https://github.com/crystian/skill-map/blob/main/spec/plugin-author-guide.md."`
against the real `npm` binary (NOT the `pnpm`-aliased `npm` in the
maintainer's shell, which fails with `ERR_PNPM_REGISTRY_ERROR: 404 Not
Found` on the deprecate endpoint). `/usr/bin/` bypasses the zsh alias;
`command npm` and `\npm` are equivalent escapes. Latest published
version is `0.5.2`; the wildcard range covers every prior tag so anyone
with the package pinned sees the deprecation notice.
