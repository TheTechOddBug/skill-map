# @skill-map/web

## 0.1.11

### Patch Changes

- 5f4b181: Remove `@skill-map/testkit` and `examples/hello-world` from the monorepo.
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

## 0.1.10

### Patch Changes

- 76304be: Align the plugin-ecosystem section on the landing with the canonical
  kind order shipped by the kernel and surfaced by `sm plugins show`:
  **provider, extractor, analyzer, action, formatter, hook**. Previously
  the hexagonal satellite ring put `hook` before `formatter` walking
  clockwise from the top (provider → extractor → analyzer → action →
  hook → formatter), which disagreed with `EXTENSION_KINDS` in
  `src/kernel/registry.ts` and with the new sorted output of `sm plugins
show <bundle>`. Swap involves three coordinated edits in
  `web/index.html`: (a) the lower-left satellite at (143.5, 485) now
  hosts the **Formatter** node and the upper-left satellite at
  (143.5, 235) hosts the **Hook** node, glyph coordinates moved with
  them; (b) the DOM order of `<g class="peco__sat">`,
  `<g class="peco__line">`, and `<article class="peco__brief">` follows
  the canonical sequence so the prev/next nav cycles in pipeline order;
  (c) `web/i18n.json` reorders `pe.formatter.*` ahead of `pe.hook.*` for
  file-level consistency. Pure repositioning, no copy or color changes,
  the existing `peco__line` animation paths and CSS selectors target by
  `data-pe-id` so nothing depends on the previous ordering.

## 0.1.9

### Patch Changes

- 2e1c0f4: Third pass of the release-pipeline shakedown. The second pass (`verify-pipeline-second-pass`) confirmed the Railway demo deploy is now green end-to-end, but the post-publish smoke step still failed: `npm i -g @skill-map/cli@0.24.4` returned `ETARGET` for the full 5-retry window even though the registry already had the version (`curl https://registry.npmjs.org/@skill-map/cli/0.24.4` returned 200 during the failure). Root cause is the npm CLI's local metadata cache, the first 404 gets cached and every retry replays it. This bump exists to verify the fix: the smoke step now passes `--prefer-online` (forces a fresh staleness check on every attempt), runs the install from a clean `mktemp -d` cwd (so the repo's pnpm-flavored `.npmrc` does not bleed into npm's config resolution), and retries up to 10 times with 30 second back-off. No code or contract change in any of the four packages.

## 0.1.8

### Patch Changes

- 5eb79ba: Second pass of the release-pipeline shakedown after the pnpm migration. The first pass (`verify-release-pipeline`) surfaced two issues that this bump exists to verify the fixes for: (a) the Railway demo deploy crashed in `web/scripts/build-demo-dataset.js` because `node --import tsx` could not resolve `tsx` from the demo fixture's cwd (pnpm's strict hoist keeps it in `src/node_modules/`), and (b) the post-publish smoke step hit `ETARGET` on `@skill-map/cli@latest` because the npm CDN had not yet propagated tarball metadata at every edge when the install ran. Both are now fixed: `build-demo-dataset.js` imports the tsx loader by absolute `file://` URL, and the smoke step now reads the explicit version from `changesets.outputs.publishedPackages` and retries up to 5 times with 30 second back-off. No code or contract change in any of the four packages.

## 0.1.7

### Patch Changes

- fb52d17: Migrate the monorepo's package manager from npm to pnpm 11.

  **Motivation**: the 2025 wave of npm supply-chain attacks (Shai-Hulud worm, Qix / chalk-debug compromise, s1ngularity / Nx, axios / Glassworm) all rode on the default-on `postinstall` script behavior plus npm's flat hoisted `node_modules`. pnpm 11 ships the inverse defaults: install scripts are blocked unless explicitly allowlisted, transitive dependencies are confined to per-package symlinks, a 24-hour `minimumReleaseAge` rejects freshly published versions, and `blockExoticSubdeps` rejects git / tarball sources sneaking in through patch bumps.

  **What changed**:

  - `pnpm-workspace.yaml` replaces the root `workspaces` array. `.npmrc` pins the supply-chain hardening flags (`save-exact`, `strict-dep-builds`, `minimum-release-age`, `block-exotic-subdeps`). `packageManager: pnpm@11.1.1` activates pnpm via corepack on every Node 24 install.
  - Every package script across the 7 workspaces moves from `npm run X --workspace=Y` to `pnpm --filter Y X`. The `bff:dev`, `demo:build`, `validate:*`, `release:*` chains follow the same pattern.
  - `Dockerfile` swaps `npm ci` for `pnpm install --frozen-lockfile`, activates pnpm via corepack inside the Alpine image, and copies `pnpm-lock.yaml` + `pnpm-workspace.yaml` + `.npmrc`.
  - All three GitHub Actions workflows (`ci.yml`, `release.yml`, `deploy-web.yml`) gain a `pnpm/action-setup@v4` step and feed `cache: 'pnpm'` to `actions/setup-node`. The smoke-install job still uses `npm i -g` to verify the published tarball through the path a real end user takes.
  - `examples/hello-world` and `testkit` workspace deps switch from the loose `"*"` range (which pnpm resolved against the registry) to `workspace:*` so the local source is always linked.
  - Two phantom dependencies that npm's flat hoist had been hiding surfaced and got fixed: `src/scripts/build-reference.js` now spawns from the `src/` workspace so it finds the locally-declared `tsx`; `e2e/live-bff/server.ts` passes an absolute `file://` URL for the tsx loader since the spawn cwd is a fixture tempdir.
  - `ui/angular.json` rewrites the `styles` paths from `../node_modules/X` (root-flat assumption) to `node_modules/X` (workspace-local under pnpm).
  - The pre-commit hook, dev-reset script, contributor docs (`AGENTS.md`, `CONTRIBUTING.md`, `context/scripts.md`, `context/lint.md`, `context/spec.md`, both READMEs, `ROADMAP.md`) all reflect the new commands.

  No user-observable change. End users still install with `npm i -g @skill-map/cli`; the CLI surface, BFF responses, and UI are byte-identical with the previous release.

- 56fef3b: Verify the release pipeline end-to-end after the pnpm 11 migration: `release.yml` boots through `pnpm install --frozen-lockfile`, `release:version` bumps versions and refreshes the lockfile in one shot, `release:publish` propagates the four versioned packages to npm, and `deploy-web.yml` rolls out the new public site on the post-migration `pnpm/action-setup` chain. No functional or contract change in any of the four packages, this exists purely so the next "chore: version packages" PR exercises every moving part of the new pipeline at least once.

## 0.1.6

### Patch Changes

- 55bd3fb: Redeploy the public site to ship two `ui/`-side fixes that already landed in the bundled demo but have not yet been republished:

  - Graph view edges in `web/demo/` now render again. The five sidecars under `fixtures/demo-scope/` were on the pre-0.18 `for:` root shape, AJV rejected each one, and the `annotations` extractor never emitted any path-style `supersedes` / `references` links. Only trigger-style links (`@frontend-specialist`, `/deploy`) survived, and `ui/graph-layout.ts` filters those out because `target` is not a `node.path`. The demo was therefore rendering with zero edges. Sidecars migrated to the `identity:` root + hashes refreshed via `sm bump --pending` regenerated the bundled `web/demo/data.json` with the seven expected edges.
  - PrimeNG `::ng-deep` M1 sweep against `primeng@21.1.6` (Phase 2 `pt.content` migration + Phase 4 host-merge selector repair). Internal to `ui/`, ships bundled in the same demo bundle that `web/` deploys.

  No `## User-facing` section: `@skill-map/web` does not feed the in-app changelog (that surface is reserved for `@skill-map/cli`, `@skill-map/spec`, `@skill-map/testkit`), and the visible-site impact is "the graph looks right again", which the redeploy itself communicates.

## 0.1.5

### Patch Changes

- fe2e90c: Strip em dashes from site copy and source comments across `web/`. Replacements are context-driven: colon for "header: detail" patterns, comma for inline lists or parentheticals, parentheses for nested clauses, semicolon between two related clauses. Touches `i18n.json`, `index.html`, `styles.css`, `app.js`, `modules/*.js`, `scripts/*.js`, plus the demo fixture source (`fixtures/demo-scope/ARCHITECTURE.md`, `.skillmapignore`) and the regenerated demo dataset (`web/demo/data.json`, `web/demo/data.meta.json`). The `cli v—` loading placeholder is now `cli v…`. No functional change; no observable diff outside copy and code-comment text.

## 0.1.4

### Patch Changes

- e9a4933: Rebrand the topbar / nav stamp from "Beta" to "Alpha" across `web/` (landing nav chip, light-theme CSS rule) and add a new bilingual entry to the deferred-roadmap copy in `web/app.js` describing the future "Live agent conversation view" — streaming the LLM job transcript turn-by-turn into the UI Job inspector with a CLI mirror via `sm job tail --conversation`.

  Companion UI changes (`ui/src/`, bundled inside `@skill-map/cli`, no separate bump): same Beta→Alpha rename in the SPA topbar + update-check chip copy + matching e2e spec; mass-migrate every remaining PrimeIcons reference (`pi pi-*`) to Font Awesome (`fa-solid`/`fa-regular`) so the icon family is consistent with the recently-added FA webfont; restructure Foblex Flow nodes so `fNodeInput` / `fNodeOutput` sit as directives on the `[fNode]` host itself (UML-example pattern) instead of separate child DIVs — this removes the connector "ball" Foblex paints by default with no `::ng-deep` or token overrides needed, and drops the three socket-color tokens + position math the old layout required; Settings → Plugins now hides host-locked rows entirely (the toggle cannot move and a "Locked" tag adds noise on always-on extensions; lock enforcement in kernel/BFF/CLI is unchanged) and fixes the kind filter to match bundle-granularity rows against the aggregated `kinds` field so the three vendor provider bundles (`claude`, `gemini`, `agent-skills`) stay visible under the "Provider" filter; rebind PrimeNG `button-text-secondary-*` tokens at `.shell__actions` so the theme + settings buttons pick up the muted topbar palette.

## 0.1.3

### Patch Changes

- 4a2d36a: Public site copy refresh to match the new tagline shipped in the CLI/README this cycle. `meta.title`, `og:image:alt`, `twitter:title`, `twitter:image:alt`, the `<title>` element, and the `foot.tagline` slot all switch from "graph explorer for AI agent skill ecosystems" / "explorador de grafos…" to "The missing map for generative-AI ecosystems" / "El mapa que le faltaba a tu ecosistema de IA generativa". Also renames the graph legend `note` row to `markdown` (key `graph.legend.note` → `graph.legend.markdown`, both in `web/index.html` and `web/i18n.json`) so the legend reflects the 0.18.0 `core/markdown` Provider rename, and updates the Provider section example list and the "For authors" case copy to talk about "markdown" instead of "note" when describing file kinds. ES copy continues to use neutral Spanish (no rioplatense voseo) per the public-site convention.

## 0.1.2

### Patch Changes

- c29a780: Add `title` tooltips to the three version tags in the landing footer (`cli`, `spec`, `web`) so hovering reveals what each version refers to: the latest `@skill-map/cli` published on npm, the `@skill-map/spec` version served at `/spec/v0/`, and the `@skill-map/web` version of the site itself.

## 0.1.1

### Patch Changes

- 508c96a: Two coordinated landings on the landing footer plus a whitespace cleanup:

  1. **`web/app.js`** — fix the runtime CLI version fetch. The `/latest` endpoint at `https://registry.npmjs.org/@skill-map/cli/latest` is unreliable for scoped packages — the request fired but the footer tag stayed at the `cli v—` placeholder. Switched to the package metadata endpoint (`https://registry.npmjs.org/@skill-map/cli`) and read `dist-tags.latest`. Added three diagnostic `console.warn` lines so a future failure surfaces the cause (registry status, missing dist-tags, fetch exception) instead of failing silently.
  2. **`web/index.html`** — reorder the three footer version tags from `spec → web → cli` to `cli → spec → web`. The CLI is the primary product surface, spec is the contract behind it, web is metadata about the site itself.

  The `@skill-map/cli` `patch` bump covers a whitespace-only cleanup in `src/kernel/index.ts` (one redundant blank line removed between the `Kernel` interface and the `createKernel()` factory). No runtime behavior change; bumped per the workspace-touch changeset policy.

## 0.1.0

### Minor Changes

- Initial versioned release. The public site (`skill-map.dev`) gets its own
  version separate from `@skill-map/spec` and `@skill-map/cli`, surfaced in
  the landing footer and used as the deploy tag in Railway. Private
  workspace — never publishes to npm.
