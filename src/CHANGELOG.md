# skill-map

## 0.28.0

### Minor Changes

- 88b2491: Add a Matrix theme as an opt-in extra theme alongside the existing
  dark / light / auto tri-state. `ThemeService` grows an orthogonal
  `extraTheme: 'matrix' | null` signal that overrides the dark/light
  mode when set, persists at `localStorage:skill-map.ui.extra-theme`,
  and is selectable from Settings → General → Theme. Clicking the
  topbar dark/light toggle clears the extra theme AND advances the
  mode one step in the same gesture, so users always have a one-click
  exit path.

  Theme palette lives in a single isolated stylesheet at
  `ui/src/themes/matrix.css`, loaded by `angular.json`'s `styles`
  array immediately after `styles.css`. Self-contained: removing the
  file from the array fully disables the theme without touching any
  other CSS. Selectors use `:root.app-matrix` (var palette, beats
  PrimeNG's runtime `:root,:host` injection) and `html.app-matrix .X`
  (per-element retints, beats Angular's emulated-encapsulation
  rewrite) so the override wins regardless of source order.

  Visual surfaces retinted under matrix: page / canvas backgrounds
  (pure black with subtly lifted card surfaces), edge ramp
  (grey-to-mild-green gradient across the four kinds, preserving
  semantic distinguishability), node card glow (terminal-green halo
  that intensifies on hover), topbar (full retint including alpha /
  version / update chips), graph wrap + Foblex grid line color, the
  floating zoom toolbar, and a logo variant
  (`skill-map-mark-matrix.svg`) that swaps in via `markSrc()` while
  matrix is active. The red severity ramp is also retinted to matrix
  green; this trades the universal "red = danger" signal for full
  matrix immersion (intentional, called out in the theme file).

  ## User-facing

  A new **Matrix** theme is now available in Settings → General →
  Theme. Once enabled it overrides the topbar dark/light toggle;
  click that toggle to exit Matrix and return to your previous
  dark/light mode in one step.

### Patch Changes

- 76304be: Group and sort the extension list rendered by `sm plugins show <bundle>`
  by the canonical pipeline order (provider, extractor, analyzer, action,
  formatter, hook), then alphabetically by short id within each kind.
  Previously the list followed the declaration order of `built-ins.ts`,
  which mixed analyzers after formatters and gave readers no quick way to
  scan a bundle by kind. Mirrors the kind order published on the marketing
  site so the CLI and the web tell the same story. Affects human output of
  the bare-bundle form (`sm plugins show core`, `sm plugins show <user-plugin>`);
  `--json` keeps emitting the source manifest order so existing JSON
  consumers see no shape change, and the single-extension detail form
  (`sm plugins show core/superseded`) is untouched.

  ## User-facing

  `sm plugins show core` (and the same verb against any user plugin) now
  groups extensions by kind in pipeline order, **provider, extractor,
  analyzer, action, formatter, hook**, with each group sorted by id. The
  JSON output is unchanged.

- e8be298: Swap the leading glyph in the `Update available` banner header from
  `⬆` (HEAVY UPWARDS BLACK ARROW, U+2B06) to `⬇` (HEAVY DOWNWARDS BLACK
  ARROW, U+2B07). The down arrow reads as "a newer version is coming
  DOWN to your machine" (incoming download), which is the same semantics
  the banner is already conveying with the `<current> → <latest>` line
  just below; the previous up arrow's "upgrade outward" reading was
  inconsistent with that downward flow. Single-character edit in
  `src/cli/util/update-check-banner.ts:189`; both characters are East
  Asian fullwidth and occupy the same number of terminal cells, so
  `BANNER_WIDTH` math and the border `─` fill remain correct without
  adjustment.

  ## User-facing

  The `Update available` banner now leads with a **down arrow** (`⬇`)
  instead of the previous up arrow, reading as "an update is coming in"
  rather than "upgrade outward".

## 0.27.0

### Minor Changes

- f1efd1b: Remove the `-g/--global` flag and every implicit `$HOME` read from
  skill-map. The CLI now operates exclusively on the project scope
  (`<cwd>/.skill-map/`); there is no global / user scope, no
  `SKILL_MAP_SCOPE` env var, no silent merge of user-level config or
  plugins.

  The user extends the scan beyond the project root via the existing
  `scan.extraFolders` setting in project-local config (privacy-gated
  through `sm config set --yes` or the Settings UI confirm dialog).
  Plugins outside the project install per-project at
  `<cwd>/.skill-map/plugins/` or load via the `--plugin-dir <path>`
  escape hatch on the `sm plugins …` verb family.

  **Narrow documented exception**: a single `~/.skill-map/settings.json`
  file (validated by `user-settings.schema.json`) holds genuinely
  per-machine preferences. Today it carries the update-check toggle +
  its throttle bookkeeping; future per-machine settings (locale, theme)
  extend it under their own sub-keys. There is no `.local` partner.
  The file is NOT part of the project config layer system; it is read
  directly by the module that owns each feature. `src/cli/util/user-settings-store.ts`
  is the only module that calls `os.homedir()` for this file. The two
  remaining `os.homedir()` callsites (`core/config/helper.ts`,
  `core/runtime/reference-paths-walker.ts`) handle user-typed `~/foo`
  expansion inside `scan.extraFolders` / `scan.referencePaths`, the
  read is user-authored per invocation, not skill-map's own default.

  Removed surface (`@skill-map/cli`):

  - `-g/--global` flag inherited by every `SmCommand` verb (`bump`,
    `check`, `config`, `export`, `graph`, `history`, `init`, `jobs`,
    `list`, `orphans`, `refresh`, `scan`, `serve`, `show`, `sidecar`,
    `watch`, every `plugins` subcommand). Calling any verb with
    `-g/--global` now exits 2 with Clipanion's "unknown option" error.
  - `SKILL_MAP_SCOPE=global` env var translation.
  - `sm serve --scope project|global` flag.
  - `sm config --source global` literal in `--source` outputs (the
    source set is now `default | project | project-local | env | flag`).
  - `IRuntimeContext.homedir` field.
  - `IDbLocationOptions.global` field; `resolveDbPath` reduces to
    `db ?? defaultProjectDbPath(ctx)`.
  - `defaultUserPluginsDir` helper.
  - `loadConfig` `scope: 'project' | 'global'` parameter and the
    `user` / `user-local` file-pair iteration; the layer list is now
    `defaults` → `project` → `project-local` → `override`.
  - `USER_ONLY_KEYS` constant and the per-key locality enforcement
    pinned to it. `updateCheck.enabled` is no longer part of the
    config layer system; its toggle lives alongside the throttle
    cache.
  - `GET /api/health` response field `scope: 'project'|'global'`.
  - `GET /api/plugins` item field `source: 'built-in'|'project'|'global'`
    reduces to `'built-in'|'project'`.
  - `scan_meta.scope` SQLite column and the matching `IScanResult.scope`
    kernel field.

  Removed surface (`@skill-map/spec`):

  - `spec/cli-contract.md` § Global flags row for `-g/--global` and
    the `SKILL_MAP_SCOPE` row in the env-var table.
  - `spec/cli-contract.md` § serve flag table `--scope project|global`
    row.
  - `spec/architecture.md` § Config layering layers `user` and
    `user-local`; `USER_ONLY_KEYS` set.
  - `spec/db-schema.md` two-scope diagram; `scan_meta.scope` column;
    `scope: 'global'` from `--source` enum text.
  - `spec/schemas/scan-result.schema.json` `scope` property (was in
    `required`).
  - `spec/schemas/project-config.schema.json` `updateCheck`
    description rewritten as the documented exception.
  - `spec/schemas/plugins-registry.schema.json` status description's
    `project / global / --plugin-dir` reference.

  Added surface:

  - `spec/cli-contract.md` § "Scope is always project-local"
    normative paragraph at the top of the file, stating the
    no-`$HOME`-reads principle and the update-check exception.
  - `AGENTS.md` § Analyzers gains the matching operating rule for
    agents working in the repo, "Skill-map MUST NEVER read `$HOME`
    by default…".
  - Regression test at `src/test/global-flag-removed.test.ts`
    asserting Clipanion's "unknown option" error on `sm scan -g`.

  Migration (no compat shim): pre-1.0, greenfield. Users who relied
  on `~/.skill-map/skill-map.db`, `~/.skill-map/settings*.json`, or
  `~/.skill-map/plugins/` move the files into their project
  (`<cwd>/.skill-map/`) or pass `--plugin-dir <path>` per invocation.
  Older DBs are not migrated, a fresh `sm init` regenerates without
  the `scope` column.

  ## User-facing

  `-g/--global` is gone. `sm` reads only the current project
  (`<cwd>/.skill-map/`). To scan outside the project, add paths via
  `scan.extraFolders` in Settings. User-scope plugins move to
  `<cwd>/.skill-map/plugins/` or load with `--plugin-dir <path>`.

### Patch Changes

- fd909bd: Fix `sm plugins show <bundle>/<ext>` rendering the full parent
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

- Updated dependencies [f1efd1b]
  - @skill-map/spec@0.27.0

## 0.26.1

### Patch Changes

- 4d2a540: Rework the `sm tutorial` demo fixture (`sm-tutorial` skill) so the
  Live UI block teaches the three link kinds (`mentions`, `invokes`,
  `references`) from the syntax the tester writes. Step 3 now creates
  four files instead of three, the extra node is a second
  `markdown` (`notes/demo-guideline.md`) that gives the hub a real
  `references` target. Step 5 collapses three separate file edits
  into a single edit on `notes/todo.md`, which becomes the only
  source of connectors in the demo: four bullets, one per target,
  covering `@demo-agent` (`mentions`), `/demo-command` (`invokes`),
  `/demo-skill` (`invokes`), and `[demo-guideline](./demo-guideline.md)`
  (`references`). The downstream count references, the
  `.skillmapignore` tree shown in Step 6, the deep-dive edit target
  in Step 8, the `sm list` expected output in Step 9, the Provider
  detection global substitution rule, and the start-over wipe list
  all updated to match.

  ## User-facing

  `sm tutorial` now teaches the three link kinds (`mentions`,
  `invokes`, `references`) from the syntax you write in
  `notes/todo.md`: `@handle`, `/slash`, and `[text](path)`. A new
  `demo-guideline.md` node ships in the demo fixture as a real
  target for `references` links.

## 0.26.0

### Minor Changes

- 48800d4: Drop `requires`, `related`, and `conflictsWith` from the curated annotation catalog.

  The three fields collapsed into the same edge kind (`references`), which made it impossible to tell from the graph whether an arrow meant "depends on", "is in conflict with", or "soft-related". The catalog now ships 10 fields instead of 13: versioning + supersession (`version`, `stability`, `supersedes`, `supersededBy`), provenance (`authors`, `license`, `source`, `sourceVersion`), taxonomy (`tags`), and docs (`docsUrl`).

  The extractor `core/annotations` now declares `emitsLinkKinds: ['supersedes']` (no longer emits `references` from the sidecar). Path-style `references` edges still surface from `core/markdown-link` over `[text](path)` syntax in the body.

  The schema keeps `additionalProperties: true`, so sidecars that still carry `requires` / `related` / `conflictsWith` continue to parse without errors, but those keys produce no edges and the built-in `unknown-field` analyzer surfaces them as warnings.

  ## User-facing

  The `.sm` annotation catalog shrinks from 13 to 10 fields. `requires`, `related`, and `conflictsWith` were dropped, their edges all rendered as plain `references` and added no extra meaning. Existing sidecars keep working; the three keys are now flagged by `unknown-field`.

### Patch Changes

- 7e3acb9: Extract the `.sm` sidecar consent gate strings shared by `sm bump`,
  `sm sidecar refresh`, and `sm sidecar annotate` into a single
  `src/cli/i18n/consent.texts.ts` module (`CONSENT_TEXTS`). The directed
  error prefixes are now driven by a `{{verb}}` placeholder filled by
  each caller (`'sm bump'` or `'sm sidecar'`), so the user-visible output
  is unchanged and the catalogs (`bump.texts.ts`, `sidecar.texts.ts`)
  stop carrying duplicated copies of the same paragraph. Internal DRY
  cleanup, no behaviour or surface change.
- 21875e5: Fix double-counted incoming/outgoing link totals when a relation is
  declared from BOTH sides of a `.sm` annotation pair (e.g. `supersedes: [B]`
  on `A.sm` AND `supersededBy: A` on `B.sm`). The `core/annotations`
  extractor walks each node in isolation, so each side independently emits
  the same `(A → B, supersedes)` edge; without a global dedup the orchestrator
  returns two copies, `recomputeLinkCounts` and the `core/link-counts`
  chip then surface inflated `linksInCount` / `linksOutCount` values, and
  the watcher's per-rescan `delta.ts#diffLinks` `Set`s occasionally
  collapse the duplicate by accident on save, which is what made the bug
  appear as "wrong number on cold start, correct after editing anything".

  Introduces a `dedupeLinks(links)` pass in `src/kernel/orchestrator/extractors.ts`
  that runs in `src/kernel/orchestrator/index.ts` immediately after
  `walkAndExtract` and before `recomputeLinkCounts` / `runAnalyzers`. The
  identity key is `(source, target, kind, normalizedTrigger ?? '')`,
  matching the existing `kernel/scan/delta.ts#linkIdentity` so the diff
  path stays consistent. `sources[]` arrays of merged duplicates union
  (preserving first-seen order, no repeats) so an edge legitimately
  produced by multiple extractors keeps every attribution visible.
  Deterministic, first-occurrence wins given walk order. Covered by 10
  new unit tests in `src/kernel/orchestrator/__tests__/dedupe-links.test.ts`.

  Also: two small cyclomatic-complexity refactors to keep the workspace
  lint cap (`max 8`) green. `validate-all/index.ts` extracts an
  `isMissingStringField` helper from `collectFrontmatterBaseFindings`
  (9 → 6). `kernel/util/trigger-resolve.ts` and the paired
  `ui/src/services/trigger-resolve.ts` split `buildNameIndex` into
  `indexByCanonicalName` + `fillIndexWithPathBasename` + `canonicalName`
  helpers (12 → 1). Semantics unchanged in both refactors; covered by
  the existing trigger-resolve suite (UI 19/19 green).

  ## User-facing

  **Bidirectional `.sm` relations no longer double-count.** A
  relation declared from both sides (e.g. `supersedes` +
  `supersededBy`) now tallies as `1` in the `linksIn` /
  `linksOut` chips and the graph. Before, the count was inflated
  on cold start and dropped on the next save.

- 49243b9: Three related fixes around graph link semantics and node health surfacing.

  **Trigger-style edges now resolve to their target node consistently.** The
  `slash` and `at-directive` extractors emit bare-name targets (`/full-agent`,
  `@release-broker`). The graph layout and `core/link-counts` analyzer both
  indexed lookup by `frontmatter.name`, so when the destination node had a
  broken or empty `frontmatter.name` (typical cause: a YAML parse error on
  the destination's own frontmatter), the edge was dropped from the rendered
  graph AND the destination's `linksIn` chip stayed at zero. Both sides now
  share a `pathBasenameForLink` fallback: `buildNameIndex` indexes nodes by
  canonical `frontmatter.name` first, then by path basename as a fallback,
  first-wins so the canonical name keeps priority when it exists. Ported
  from `ui/src/services/trigger-resolve.ts` into a new
  `src/kernel/util/trigger-resolve.ts` so kernel analyzers and the UI agree
  on resolution rules. Deliberately NOT applied to `core/broken-ref`: its
  contract remains "warn when the target is not resoluble by canonical
  `frontmatter.name`", relaxing it would mask files whose frontmatter is
  actually broken.

  **`core/validate-all` now declares `viewContributions` for a frontmatter
  health alert.** Adds a `graph.node.alert` badge plus a
  `card.footer.right` chip (`danger` severity, same chassis as
  `core/broken-ref`) that surfaces on vendor-provider nodes (`claude`,
  `gemini`, `agent-skills`) whose `frontmatter` block was emitted with
  non-zero bytes but is missing `name` or `description`. The catch-all
  `markdown` provider is excluded so plain `README.md` / `CHANGELOG.md`
  files never get flagged, and nodes with `bytes.frontmatter === 0` (no
  frontmatter block at all) are also skipped, the alert means "you
  authored a frontmatter block and it parsed badly", not "you forgot to
  write one". Finding severity stays `warn` so `sm scan` exit code is
  unaffected; the rendered chip/alert use `danger` so the UI badge reads
  red. Per-node aggregation mirrors `broken-ref` so a node with two
  failing checks surfaces a single alert with `count: 2`.

  **Node-card title falls back to path basename when frontmatter.name is
  empty.** Previously the card showed the raw path (`full-agent-gemini.md`
  or the full relative path); now it shows the derived stable basename
  (`full-agent-gemini`), reusing the same helper as the trigger resolver
  so card text and edge resolution stay in sync.

  Also: UI polish on the link-kind palette (host now stretches to the
  kind-palette width, grid `1fr 1fr`, two-line tooltips with verbatim
  syntax examples), `--sm-edge-supersedes` recoloured from purple to
  grey across light/dark, supersedes connector solid (was dashed; the
  grey already carries the lifecycle signal). Docs cleanup post the
  annotations-catalog trim: a stale `conflictsWith` example in
  `ROADMAP.md` / `spec/README.md` is now `supersededBy`, and
  `spec/plugin-author-guide.md` says "10 conventional fields", matching
  the current catalog size. 30 new tests across kernel (link-counts
  trigger resolution, validate-all frontmatter base check) and UI
  (trigger-resolve helpers).

  ## User-facing

  **Broken frontmatter now lights up on the graph.** Vendor agent/skill
  nodes missing `name` or `description` show a red alert badge and a
  matching footer chip, same chassis as broken references. Trigger-style
  links (`/cmd`, `@handle`) now also tally into the target's `linksIn`.

- Updated dependencies [48800d4]
  - @skill-map/spec@0.26.0

## 0.25.0

### Minor Changes

- a53532b: Replace BYTES with TOKENS in the human-mode output of `sm list` and `sm show`. Tokens are the metric users actually care about for LLM budgeting; bytes were a leftover from the early file-size mental model.

  **CLI changes (`@skill-map/cli`)**:

  - `sm list` table swaps the `BYTES` column for `TOKENS`. The value comes from `node.tokens?.total` (cl100k_base counts already populated by the kernel during `sm scan`). Nodes scanned with `--no-tokens` render the cell as `-`.
  - `sm list --sort-by bytes_total` is **removed**, renamed to `--sort-by tokens_total`. Passing the old key now fails fast with the standard "invalid sort field" error listing the allowed values. The defensive whitelist in `kernel/adapters/sqlite/storage-adapter.ts` (`SORT_BY_COLUMNS` / `SORT_BY_DEFAULT_DIRECTION`) follows the same rename.
  - `sm show` no longer renders the `Bytes:` field. The `Tokens:` field is now always present (`-` when the scan ran with `--no-tokens`) instead of being conditional on token availability. Field-block doc comments updated.
  - Help text and the `examples` array on `sm list` reworded ("Top 5 by total tokens").

  **Untouched surfaces** (DB shape, JSON output, internal tie-breakers):

  - `scan_nodes.bytes_*` columns stay in the schema, no migration.
  - `node-build.ts` still computes both `bytes` and `tokens` on every scan.
  - `sm list --json` and `sm show --json` keep emitting Node objects conforming to `node.schema.json`, which still carries both `bytes` and `tokens`. Only the human-mode rendering changed.
  - `sm export` keeps using `bytes` as the deterministic internal tie-breaker (invisible to the user).

  **Spec change (`@skill-map/spec`)**:

  - `spec/cli-contract.md` (`sm show` row): "weight (bytes/tokens triple-split)" → "weight (tokens triple-split)". A conforming implementation no longer has to render the `Bytes:` field on `sm show`. Pre-1.0 breaking, treated as minor per `spec/versioning.md` § Pre-1.0.

  Tests updated: `src/test/scan-readers.test.ts` swaps `sortBy: 'bytes_total'` for `'tokens_total'` and asserts `\bTokens\b` (instead of `\bBytes\b`) in the `sm show` human output.

  ## User-facing

  **`sm list` and `sm show` now report tokens, not bytes.** The `BYTES` column on `sm list` is now `TOKENS` (cl100k_base, frontmatter + body), and `sm show` lists `Tokens:` instead of `Bytes:`. Sort with `--sort-by tokens_total`. `--json` is unchanged.

- 2129b40: Add an optional positional `variant` argument to `sm tutorial`. Default (no argument) keeps the previous behaviour and materializes `<cwd>/sm-tutorial.md` (the basic walkthrough). Passing `master` materializes `<cwd>/sm-master.md` (the advanced walkthrough: plugin tour, plugin authoring, settings + view-slots) through the same channel. The value is validated against the closed set `{ tutorial, master }`; anything else exits with code 2 and an `invalidVariant` error pointing at the valid values. The build pipeline (`tsup.config.ts → onSuccess`) now copies both SKILL.md sources into `dist/cli/tutorial/`, and the runtime resolver caches each variant independently. CLI i18n strings under `tutorial.texts.ts` were parameterized with a `{{filename}}` placeholder so the success block points the tester at whichever file was materialised. Spec § `sm tutorial` was rewritten to document the new positional and exit-code rule.

  ## User-facing

  **`sm tutorial master`** materializes the advanced tester walkthrough (`sm-master.md`) in your cwd. Trigger it from Claude Code with `ejecutá @sm-master.md`. Bare `sm tutorial` keeps its previous behaviour and writes `sm-tutorial.md`.

### Patch Changes

- Updated dependencies [a53532b]
- Updated dependencies [2129b40]
  - @skill-map/spec@0.25.0

## 0.24.5

### Patch Changes

- 2e1c0f4: Third pass of the release-pipeline shakedown. The second pass (`verify-pipeline-second-pass`) confirmed the Railway demo deploy is now green end-to-end, but the post-publish smoke step still failed: `npm i -g @skill-map/cli@0.24.4` returned `ETARGET` for the full 5-retry window even though the registry already had the version (`curl https://registry.npmjs.org/@skill-map/cli/0.24.4` returned 200 during the failure). Root cause is the npm CLI's local metadata cache, the first 404 gets cached and every retry replays it. This bump exists to verify the fix: the smoke step now passes `--prefer-online` (forces a fresh staleness check on every attempt), runs the install from a clean `mktemp -d` cwd (so the repo's pnpm-flavored `.npmrc` does not bleed into npm's config resolution), and retries up to 10 times with 30 second back-off. No code or contract change in any of the four packages.
- Updated dependencies [2e1c0f4]
  - @skill-map/spec@0.24.3

## 0.24.4

### Patch Changes

- 5eb79ba: Second pass of the release-pipeline shakedown after the pnpm migration. The first pass (`verify-release-pipeline`) surfaced two issues that this bump exists to verify the fixes for: (a) the Railway demo deploy crashed in `web/scripts/build-demo-dataset.js` because `node --import tsx` could not resolve `tsx` from the demo fixture's cwd (pnpm's strict hoist keeps it in `src/node_modules/`), and (b) the post-publish smoke step hit `ETARGET` on `@skill-map/cli@latest` because the npm CDN had not yet propagated tarball metadata at every edge when the install ran. Both are now fixed: `build-demo-dataset.js` imports the tsx loader by absolute `file://` URL, and the smoke step now reads the explicit version from `changesets.outputs.publishedPackages` and retries up to 5 times with 30 second back-off. No code or contract change in any of the four packages.
- Updated dependencies [5eb79ba]
  - @skill-map/spec@0.24.2

## 0.24.3

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
- Updated dependencies [fb52d17]
- Updated dependencies [56fef3b]
  - @skill-map/spec@0.24.1

## 0.24.2

### Patch Changes

- dc92b12: Add a per-browser graph edge style preference to Settings → General. The new selector picks between the four Foblex connection shapes (orthogonal / straight / bezier / adaptive curve) and persists in `localStorage`, so it does not sync across machines.

  Implementation: new `GraphPreferencesService` (signal + localStorage round-trip) consumed by the graph view's `<f-connection [fType]>` binding and a `<p-selectbutton>` in the Settings modal. Default flipped from the historical `segment` to `adaptive-curve`, the curve follows the top/bottom connector pinning and reads cleaner in a top-down dagre layout.

  ## User-facing

  **Graph edge style picker** — Settings → General now has an "Edge style" control. Pick **Orthogonal**, **Straight**, **Bezier**, or **Adaptive curve** (new default) and the graph re-renders immediately. The choice is remembered in this browser only.

- 88cb607: Polish the graph view's default edge look to match Foblex's `schema-designer` example:

  - **Endpoint markers**: every connection now paints a small dot at the source and an arrow at the target (via `<f-connection-marker-circle>` + `<f-connection-marker-arrow>`). Both markers inherit the kind's `--ff-marker-color` so they always match the line.
  - **Thinner strokes**: per-kind widths cut by ~40%, `invokes` 2.5 → 1.5, `references` 2 → 1.25, `mentions` 1.5 → 1, `supersedes` 2 → 1.25. The selection-highlight stays one step thicker than the base (3 → 2).
  - **Muted hues**: edge colors desaturated in `styles.css` so the network reads as quiet reference layer instead of competing with node cards (kind hue still recognisable).

  ## User-facing

  **Edge look refresh** — graph edges now show a small **dot at the start** and arrow at the end, with thinner strokes and softer colors. Kind colors (invokes / references / mentions / supersedes) are still distinct but no longer compete with the node cards for attention.

- 4e57f22: Enable user-driven edge selection in the graph view. Removed `[fSelectionDisabled]="true"` from `<f-connection>` so Foblex's built-in click-to-select kicks in. When an edge is selected, the line grows from its per-kind base (1-1.5px) to 2.5px and the kind's muted base colour is promoted to its full-saturation `*-active` counterpart (e.g. `invokes` goes from desaturated `#b8843a` to vivid `#f59e0b`), marker dot and arrowhead follow the path so the picked edge pops without changing hue family.

  ## User-facing

  **Click an edge to highlight it** — clicking a connection in the graph now selects it: the line grows a touch thicker and saturates to its full colour (same hue as the base, just louder). Click elsewhere on the canvas to clear the selection.

- 38a24a0: Swap the card-footer `linksIn` / `linksOut` icons from `pi-arrow-up` / `pi-arrow-down` to `pi-download` / `pi-upload`. The tray-with-vertical-arrow glyphs read as "things landing on / leaving this node" while keeping the pure arrow shape exclusive to the graph's own edges.

  ## User-facing

  **Footer link icons refresh** — the incoming / outgoing link counters on each node card now use the classic **download / upload** glyphs instead of plain up / down arrows. The arrow shape stays exclusive to the graph's edges, which keeps the visual vocabulary clearer.

## 0.24.1

### Patch Changes

- dc92b12: Add a per-browser graph edge style preference to Settings → General. The new selector picks between the four Foblex connection shapes (orthogonal / straight / bezier / adaptive curve) and persists in `localStorage`, so it does not sync across machines.

  Implementation: new `GraphPreferencesService` (signal + localStorage round-trip) consumed by the graph view's `<f-connection [fType]>` binding and a `<p-selectbutton>` in the Settings modal. Default stays `segment` (orthogonal), matching the historical behaviour.

  ## User-facing

  **Graph edge style picker** — Settings → General now has an "Edge style" control. Pick **Orthogonal** (default), **Straight**, **Bezier**, or **Adaptive curve** and the graph re-renders immediately. The choice is remembered in this browser only.

## 0.24.0

### Minor Changes

- dd25272: Apply 13 of 15 findings from the `cli-architect` review of `src/` (audit run 2026-05-13). Behaviour and architecture only; lint and security audits were out of scope.

  HIGH (user-observable behaviour):

  - **H1** `runWatchLoop` now honors `--no-color`. `IRunWatchOptions` gained `noColor: boolean`; `WatchCommand.run()` and `ScanCommand.runWatchAlias()` thread `this.noColor` through. Watcher advisories used to colour-emit even with `--no-color` set.
  - **H2** `sm refresh`, `sm watch`, `sm jobs prune` now resolve the project DB through `resolveDbPath({ global, db, ...ctx })` instead of `defaultProjectDbPath(ctx)`. The verbs previously dropped inherited `--db` and `-g` / `--global` on the floor. Test seed in `src/test/job-prune.test.ts` aligned with the new resolver path.
  - **H3** Removed a hexagonal-inversion: `StoragePort` no longer imports from the SQLite adapter. `IPersistedContribution` moved to `src/kernel/types/storage.ts`; the SQLite adapter re-exports for back-compat and `src/server/routes/nodes.ts` was updated.

  MEDIUM (design hygiene):

  - **M1** `sm export --format` documented as a closed catalog with the `mermaid` deferral cross-referencing `cli/commands/graph.ts` (the open-catalog counterpart).
  - **M2** Added a code-comment block on `HelpCommand` / `RootHelpCommand` explaining why they extend `Command` directly instead of `SmCommand` (no inherited common flags, by design).
  - **M3** `sm conformance run` per-case progress (OK / FAIL lines, scope headers, summaries) moved from stdout to `printer.info` (stderr, suppressible by `--quiet`). The grand total result stays on stdout per the verb contract. Test expectations updated in `src/test/conformance-cli.test.ts`.
  - **M4** Pulled ~65 sites of `ansiFor({ isTTY: ..., noColorFlag: this.noColor })` boilerplate into a single `protected ansiFor(stream: 'stdout' | 'stderr'): IAnsi` on `SmCommand`. 32 command files migrated; 5 freestanding helpers in `watch.ts` / `config.ts` intentionally left as they cannot access `this`. Output byte-identical.
  - **M5** Marked `Duplicate = 3` and `NonceMismatch = 4` exit codes with `// TODO Step 10:` so the next reader knows they are reserved, not orphaned.
  - **M6** Extracted `buildVerbCatalog()` shared between `HelpCommand.execute()` and `RootHelpCommand`, removing duplicated catalog-normalisation.

  LOW:

  - **L1** Closed the one Node-global leak in `src/server/`: the BFF used to pass `process.stderr` to `runScanForCommand`. New `noopWritable()` helper at `src/server/util/noop-writable.ts`; kernel progress events fan out through the WS broadcaster, the stream parameter is now a sink.
  - **L3** `sm scan --watch` combo error now names the exact offending flag. Replaced the single lumped message with four per-flag two-line templates (`watchVs<Flag>` + `*Hint` per `cli-output-style.md` §3.1b); new `#firstWatchConflict()` selects the offender.
  - **L4** `sm export` markdown renderer pulled sanitisation to the boundary: `buildSanitizedRows()` returns `ISanitizedNode[]` / `ISanitizedLink[]` / `ISanitizedIssue[]`, so the renderer interpolates without per-field `sanitizeForTerminal()`. Output byte-identical.
  - **L5** `sm version` no longer silently swallows DB-read errors. The catch block now logs at `debug` so `-vv version` surfaces the failure; human + JSON output still reports `dbSchema: '-'` per the existing contract.

  Skipped (review noted as no-op): M7 (`SqliteStorageAdapter.init()` mkdir was a defensive note, not a finding) and L2 (job-verb stub flag types are intentional forward-compat shape until Step 10).

  Also finishes a small pre-existing WIP in `ui/` that was blocking `ng build`: `<sm-node-card>` now takes a single `selection: ISelectionView` input (selected / highlighted / dimmed bundled) instead of three booleans, and the graph view's `selectionState` exposes a precomputed `selectionView()` Map. Cuts N × 3 function calls per CD pass on dense graphs.

  ## User-facing

  **CLI flags fixed.** `sm refresh`, `sm watch`, `sm jobs prune` now honor `--db` / `-g`. `sm watch` and `sm scan --watch` honor `--no-color`. `sm scan --watch` names the conflicting flag on combo errors. `sm conformance run` progress moved to stderr; `--quiet` silences it.

### Patch Changes

- 2b09ce8: Apply findings from the `app-hacker` security audit of `ui/` (audit run 2026-05-13). Defence-in-depth and hardening only; no user-observable behaviour changes.

  HIGH:

  - **H1 (UI half)** `ui/src/services/kind-registry.ts` now filters incoming kind names through the same `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$` pattern the kernel enforces (`spec/schemas/node.schema.json`, see the paired spec changeset). A stale BFF or a future malformed envelope can no longer drive a CSS injection through the `<style id="sm-kind-vars">` tag. `applyCssVars` also wraps each entry's hex-tint derivation in a try/catch so an isolated malformed color never poisons the entire stylesheet (audit L3, covered transitively).

  MEDIUM:

  - **M1** Bumped `markdown-it` 14.1.0 → 14.1.1 in `ui/` to pick up the upstream ReDoS fix (GHSA-38c4-r59v-3vqw). The renderer runs against user-authored markdown bodies, so a patho­logically crafted file could previously hang the browser thread.
  - **M2** Removed unused `js-yaml` and `@types/js-yaml` from `ui/`. They had no imports anywhere under `ui/src/`; deleting them shrinks the bundle attack surface and removes a future-CVE channel.

  LOW:

  - **L1** `ui/src/app/components/annotations-panel/annotations-panel.ts` now narrows `source` and `docsUrl` annotation values to `http(s)://` URLs via a new `httpUrlOrNull` helper before binding them to `[href]`. Angular's DomSanitizer already blocked `javascript:` in URL context; the new allowlist also keeps out `data:`, `blob:`, `file:`, and custom schemes that a curator or stale sidecar might smuggle in. The template was upgraded to `rel="noopener noreferrer"` so the destination cannot see the local skill-map referer.
  - **L2** `src/server/app.ts` now sets baseline security headers on every response via a new middleware: `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; form-action 'self'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. `frame-ancestors` blocks the SPA from being framed by other local pages (defence against local clickjacking from other processes, malicious `file://` pages, or browser extensions). `script-src` / `style-src` are intentionally not set yet (PrimeNG ships inline styles and the SPA bundle uses inline init scripts; locking those down requires nonce wiring through the build pipeline).

  Validation: `npm run validate` green.

- 8e06f8a: Apply 3 findings from the `cli-hacker` security audit of `src/` (audit run 2026-05-13). Defence-in-depth and hardening only; no user-observable behaviour changes.

  MEDIUM:

  - **M1** `yaml.load(raw)` calls in `src/kernel/sidecar/parse.ts` and `src/kernel/sidecar/store.ts` now pass `{ schema: yaml.JSON_SCHEMA }` to align with the frontmatter parser (`src/built-in-plugins/parsers/frontmatter-yaml/index.ts:66`) and harden against a future `js-yaml` default-schema loosening. Sidecar parsing already rejects non-plain-object roots, but pinning the schema removes the implicit reliance on upstream defaults.

  LOW:

  - **L3** `src/server/routes/sidecar.ts` `loadNode()` 404 message now wraps the body-supplied `nodePath` in `sanitizeForTerminal()` before interpolation. Previously, an attacker-controlled `nodePath` could embed ANSI escapes or control characters in the response envelope and, transitively, in the BFF's stderr-mirrored error log. Mirrors the existing pattern at `src/server/routes/contributions.ts:152-154`.
  - **L4** `src/cli/commands/init.ts` bootstrap writes (`settings.json`, `settings.local.json`, `.skillmapignore`) migrated from plain `writeFile` to `writeFileAtomicExclusive` (`src/core/config/atomic-write.ts`). The previous flow had a TOCTOU window between the `pathExists` check and the write; a local attacker who pre-planted a symlink at the final path could redirect the write. The helper stages through a temp file opened with `O_EXCL | O_NOFOLLOW` plus a CSPRNG suffix, then renames atomically.

  Validation: typecheck + lint + build + 1503/1503 tests pass; `cli-reference.md` already in sync (no CLI surface change).

- Updated dependencies [2b09ce8]
  - @skill-map/spec@0.24.0

## 0.23.1

### Patch Changes

- 45e275c: M1 PrimeNG `::ng-deep` audit (verified against `primeng@21.1.6`). Two phases of work plus documentation, all internal to `ui/` (the workspace ships bundled inside `@skill-map/cli`).

  **Phase 2, Class A pt-content migration (4 blocks).** Replaced `:host ::ng-deep .X .p-togglebutton-content { ... }` overrides in `kind-palette`, `perf-hud` and `event-log` with `[pt]="{ content: { class: 'X__content' } }"` bindings on the `<p-togglebutton>` instances and rewrote the rules against the new project-owned class. The rule still uses `::ng-deep` because PrimeNG generates the slot DOM outside Angular's view encapsulation, but it no longer depends on the internal `.p-togglebutton-content` class name. The kind-palette togglebutton carries `[pTooltip]` on the same host, which collides with `<p-togglebutton>`'s `pt` input (Tooltip directive declares a `pt` of a different shape, `TooltipPassThroughOptions` vs `ToggleButtonPassThroughOptions`), so the binding is cast inline with `$any({...})` and the reason is documented in `context/ui.md`.

  **Phase 4, host-merge selector repair (5 blocks fixed, 2 deleted).** PrimeNG 21 merges `[styleClass]` onto the host element via `host.class = cn(cx('root'), styleClass)` for `<p-chip>`, `<p-card>`, `<p-togglebutton>` and friends, so the variant class lands on the same DOM node as `.p-chip` / `.p-card`. Five rules used the descendant pattern `.chip--X .p-chip` (or `.inspector__card--hero .p-card`) and matched nothing because the chip / card IS the merged host, not a child of it. Switched to direct selectors:

  - `.chip--link`, `.chip--link:hover`, `.chip--warn` in `inspector-view.css`.
  - `.chip--broken` in `annotations-panel.css`.
  - `.chip--danger` in `vendor-frontmatter.css`.
  - `.inspector__card--hero` in `inspector-view.css`.

  Removed `.chip--dead .p-chip` and `.chip--dead-confirmed .p-chip` from `inspector-view.css`, the variant classes had no template references.

  **Phase 3, documentation.** Added a "PrimeNG `::ng-deep` exceptions" section to `context/ui.md` that enumerates every remaining PrimeNG-targeted `::ng-deep` block: 12 Class B (stable host-merge contract, kept on purpose) and 4 Class D (deep internals like `.p-card-body` and `.p-dialog-content` with no `pt` / `dt` alternative in 21.1.6). The section also documents the descendant-selector failure mode so future PrimeNG upgrades catch the same pattern.

  Validation: `npm run validate:compile -w ui` green, `npm run test:ci -w ui` 394/394 green.

  ## User-facing

  Inspector chips and the hero card now render their variant styling (link, warn, broken, danger, hero accent border). They had silently been rendering as bare defaults since PrimeNG 21 changed how `[styleClass]` is applied to chip and card hosts.

## 0.23.0

### Minor Changes

- c1ed77a: Add `IAnalyzer.recommendedActions` so an Analyzer can declare which per-node Actions resolve its findings.

  `spec/schemas/extensions/analyzer.schema.json` gains an optional `recommendedActions: string[]` (qualified action ids, `^[a-z0-9-]+/[a-z0-9-]+$`, unique). Distinct from the existing `IActionPrecondition` (Action-side filter: "I apply to nodes matching X"); `recommendedActions` is Analyzer-side ("when I fire, these per-node Actions are the canonical resolution"). The UI consumes both: the node inspector renders "Applicable Actions" from `IActionPrecondition` matching and "Recommended for issues" from `recommendedActions` of the Analyzer that fired each Issue.

  Actions are per-node by design (matches the shape of `IActionPrecondition`). Project-level cleanup operations (e.g. `sm job prune --orphan-files`) stay as CLI verbs and are NOT surfaced through this field — therefore `core/contribution-orphan` and `core/job-orphan-file` analyzers do NOT declare `recommendedActions`. Built-in pairing shipping with this change: `core/annotation-stale.recommendedActions = ['core/bump']` — a stale sidecar is resolved by bumping the node (refreshes the `for` hashes and stamps the audit block).

  Side-cleanup: the two earlier project-level action stubs `core/relink-contributions` and `core/prune-orphan-files` are removed; they were miscategorized as Actions. The per-node Action stub `core/mark-superseded` stays (declarer for `supersededBy`). The kernel `IAnalyzer` TS interface gains the matching optional `recommendedActions?: readonly string[]` field. Built-in extensions count returns to 26.

  Validation: the analyzer pass walks every declared `recommendedActions` entry and emits an `extension.error` event with `kind: 'recommended-action-missing'` for any qualified id that is not registered as an Action. The analyzer stays registered and continues emitting issues; only the recommendation hint is dropped. The driving adapter (CLI, BFF) surfaces the event through the standard `extension.error` channel so plugin authors see a dangling reference instead of a silently empty "Recommended for issues" list. Spec wording lands in `architecture.md` (new "Analyzer · `recommendedActions` hint" subsection) and `plugin-author-guide.md` (analyzer section).

  ## User-facing

  Node inspector will split actions into "Applicable" (always available) and "Recommended" (per finding). First pairing: stale sidecar recommends running `bump`. UI hookup lands in the next iteration; the spec field ships first.

### Patch Changes

- a34858a: Audit fix L6 on the BFF: `/api/issues` now paginates (`offset`, `limit`, default 100, max 1000, mirroring `/api/nodes`) and pushes its three filters (`severity`, `analyzerId`, `node`) into the storage layer instead of loading every persisted issue into memory and filtering in JS.

  Internal changes for plugin authors / contributors:

  - New port method `port.issues.list({ severities?, analyzerIds?, nodePath?, offset, limit }): Promise<{ items: Issue[]; total: number }>` on `StoragePort` (kernel). Filters translate to parameterised SQL: `severity IN (?, ?, ...)`, `analyzerId = ? OR analyzerId LIKE '%/' || ?` per token (preserves the qualified + suffix-match semantics of `matchesAnalyzerFilter`), and a correlated `EXISTS (json_each(node_ids_json) WHERE value = ?)` for `nodePath`. Order is `id` ASC so pagination stays deterministic.
  - The `/api/issues` response envelope now carries `counts.page = { offset, limit }` like `/api/nodes`; `counts.total` is the full filter match count (NOT the page slice). The route still echoes the active filters back via `filters: { severity, analyzerId, node }`.
  - `port.issues.listAll()` is unchanged and still exposed for callers that genuinely need every row (currently none on the read path; kept for back-compat).

- 608e6ae: BFF compliance audit follow-ups (`bff-ruler` on `src/server/`).

  **Error envelope unification.** Three call sites that hand-rolled their own 4xx/5xx JSON shape now throw `HTTPException` (or a typed subclass) and drain through the single global `app.onError` formatter so every BFF error response carries the canonical `{ ok: false, error: { code, message, details } }` envelope:

  - `routes/scan.ts` (`db-missing` on `POST /api/scan`): now `throw new DbMissingError(...)`; `details: null`.
  - `routes/plugins.ts` (`db-missing` on bulk + project list): same `DbMissingError` path.
  - `routes/contributions.ts` (`missing-path` 400, `unknown-contribution` 404): `HTTPException` throws with externalized messages.
  - `loopback-gate.ts` (`host-not-allowed` / `origin-not-allowed` 403): now `throw new LoopbackGateError({ code, message })`. `formatError` shapes it to the canonical envelope with `details: null`. The pre-baked terse message keeps the gate opaque to probes.
  - `routes/plugins.ts` bulk PATCH: `details: { id: <offender> }` now lives on `BulkValidationError` and is stamped centrally in `formatError` instead of inlined at each call site.

  `TErrorCode` gains `'host-not-allowed'` and `'origin-not-allowed'`. `cli-contract.md` §Server documents the new envelope shape and adds matching rows to the HTTP status mapping + error-code source list.

  **Input validation tightened.** `GET /api/contributions/:pluginId/:extensionId/:contributionId` now validates the three URL segments against the qualified-id alphabet `/^[A-Za-z0-9._-]+$/` and the `?path=` query string via a new `parseRequiredString` helper in `util/parse-query.ts`. `GET /api/graph` rejects `?format=` values longer than 32 chars or outside `/^[a-z0-9-]+$/` before the formatter registry lookup.

  **Internal type renames** (workspace-internal, not part of the public API surface):

  - `IKindRegistry` → `TKindRegistry`, `IContributionsRegistry` → `TContributionsRegistry` (they are `Record<>` aliases, not interfaces).
  - `IContributionsRegistryEntry` declared twice with drift on `priority?`. One canonical declaration in `envelope.ts` with the field; `contributions-registry.ts` re-exports it.
  - `ServerHandle` → `IServerHandle` (consistency with the rest of the `I*` interface convention).

  **Misc.** `src/tsconfig.json` now lists `server/**/*` and `core/**/*` in `include` explicitly (they were previously type-checked only via transitive resolution from `cli/`). The seven em dashes in user-facing strings in `i18n/server.texts.ts` were replaced with commas / parentheses. The two `scan-guard-trip` literals in `routes/scan.ts` are now externalized to `SERVER_TEXTS`.

- 639a95b: Finish the em-dash sweep across `src/` and lock it down with an ESLint rule.

  Two pieces of work, both internal (no user-visible behaviour change):

  - **Lint rule** in `src/eslint.config.js` blocks new em-dashes (`—`) inside string literals and template-literal pieces in `**/*.texts.ts` catalog files (the user-facing surface). Two `no-restricted-syntax` selectors fire on `Literal[value=/—/]` and `TemplateElement[value.raw=/—/]`. The rule scopes only to catalogs; non-catalog files (comments, JSDoc) are not enforced because the AST selectors do not see comment tokens.
  - **Comment sweep** across `src/**/*.{ts,js}` (excluding `dist/`) replaces ~1500 em-dashes inside JSDoc and inline comments with context-appropriate punctuation (`,`, `;`, `:`, parens). Closes the historical gap left by the previous AGENTS.md "do not mass-rewrite old em dashes" guardrail. Three intentional em-dashes remain in `src/eslint.config.js`, the rule's own error messages reference the `—` character literally.

  `AGENTS.md` updated so the no-em-dash rule now applies tree-wide (was "new code only"); the lint rule prevents regression on the catalog surface.

- 639644d: Strip em dashes (`—`) from CLI / kernel / built-in user-facing strings. Stylistic sweep matching the project rule against em dashes in written text; each replacement is a comma, colon, semicolon, or parenthetical pair chosen to read naturally in context.

  Touches:

  - `src/cli/i18n/*.texts.ts` (bump, check, config, db, export, help, history, init, orphans, plugins, scan, serve, sidecar, watch) and matching command `description` / `details` strings in `src/cli/commands/**`.
  - `src/kernel/i18n/*.texts.ts` (orchestrator, plugin-loader, plugin-store) and a handful of inline `throw new Error(...)` messages in `src/kernel/sidecar/`, `src/kernel/orchestrator/renames.ts`, `src/kernel/adapters/`.
  - `src/built-in-plugins/i18n/ascii.texts.ts`, `unknown-field.texts.ts`, the `stability` analyzer's `EXPERIMENTAL_TOOLTIP` / `DEPRECATED_TOOLTIP`, and matching fixture expectations in the analyzer + ascii formatter test suites.
  - `src/core/runtime/i18n/plugin-runtime.texts.ts` (the warning row template).
  - `src/cli/util/conformance-scopes.ts` and `src/tsup.config.ts` (build-time stderr messages).
  - The em-dash sentinel for `db-schema` in `sm version` output flips to a plain hyphen (`-`); matching test regexes in `src/test/cli.test.ts`, `db-cli.test.ts`, `graph-cli.test.ts` updated.
  - `context/cli-reference.md` regenerated from `sm help --format md` to reflect the new strings.

  No behaviour change; user-visible output is byte-identical save for the punctuation substitution.

- 8c3bc0d: Follow-up sweep on the cli-ruler audit. Four pieces:

  - **`sm plugins create` honors `-g/--global`.** The verb previously hardcoded the project plugins dir (`<cwd>/.skill-map/plugins/<id>`) and silently ignored the inherited `-g` flag. Now routes through `defaultProjectPluginsDir` / `defaultUserPluginsDir` so `-g` lands the scaffold under `~/.skill-map/plugins/<id>` as the help text already implied. `--at <path>` keeps overriding both.

  - **`sm plugins create` strings moved to the i18n catalog.** Three inline literals (invalid-id error, refuse-overwrite error, post-scaffold success block) extracted to `PLUGINS_TEXTS.createInvalidId` / `createRefuseOverwrite` / `createSuccess` and emitted via `tx()`. The user-visible output is byte-identical, including the trailing em dash on the `slots list` hint line which is preserved verbatim to avoid a cosmetic diff in scripted output.

  - **`sm plugins slots list` strings moved to the i18n catalog.** Section headers and the trailing tip extracted to `PLUGINS_TEXTS.slotsListHeaderViewSlots` / `slotsListHeaderInputTypes` / `slotsListTipFooter` / `slotsListTipText`. Output is byte-identical.

  - **`reference-paths-walker` skip-set uses `SKILL_MAP_DIR`.** The `.skill-map` directory name was hardcoded in the walker's skip-list; replaced with the named export from `core/paths/db-path.ts` so the literal lives in one place and survives a future rename.

  ## User-facing

  `sm plugins create <id> -g` now scaffolds under `~/.skill-map/plugins/<id>` instead of the project dir. The flag was advertised in `--help` but previously ignored.

- c2152cc: Add `--json` output to four verbs that previously emitted only human-formatted text: `sm refresh` (and `sm refresh --stale`), `sm plugins doctor`, `sm conformance run`, plus `--format json` on `sm graph` (`sm graph` uses the formatter catalog rather than the global `--json` flag). Closes the spec drift where the global `--json` flag was advertised but ignored on these verbs, and unblocks CI / scripting consumers that parse the output.

  New JSON schemas under `spec/schemas/`:

  - `refresh-report.schema.json`, `{ ok: true, kind: 'refresh.report', refreshed, nodes[], elapsedMs }`. Error envelope codes: `not-found` (missing node), `db-missing` (absent project DB), `internal` (read / persist failure).
  - `plugins-doctor.schema.json`, `{ ok: true, kind: 'plugins.doctor', counts, issues[], warnings[], elapsedMs }`. `counts` collapses the raw discovery enum into the four error buckets (`loaded` / `incompatible` / `invalid` / `loadError`) so consumers do not have to track the kernel-side label catalog.
  - `conformance-result.schema.json`, `{ ok: true, kind: 'conformance.result', totals, scopes[], elapsedMs }`. Error envelope codes: `bad-query` (unknown scope), `internal` (missing binary). A run that surfaces failing cases still returns `ok: true`; failures live under `scopes[].cases[].status === 'fail'` and gate the exit code.

  `sm graph` gains a built-in `json` formatter (`built-in-plugins/formatters/json/`) that stringifies the persisted `ScanResult` (`scan-result.schema.json`), byte-equivalent to `sm scan --json` modulo whitespace. The formatter is registered alongside `ascii` in `built-in-plugins/built-ins.ts`, picked up automatically by the BFF's `GET /api/graph?format=json` (which previously documented JSON but had no formatter to back it). `IFormatterContext` gains an optional `scanResult` field so formatters whose output mirrors a full `ScanResult` envelope read it verbatim; existing formatters (today: `ascii`) ignore it.

  Built-in extension count: 26 → 27 (the new `core/json` formatter). Spec `coverage.md` matrix grows three rows (`refresh-report`, `plugins-doctor`, `conformance-result`).

  ## User-facing

  `sm refresh`, `sm plugins doctor`, and `sm conformance run` now respect `--json` for machine-readable output. `sm graph --format json` is a new format that emits the full ScanResult. CI / scripts can parse these instead of the human text.

- 665a21a: Security hardening, two BFF fixes from a follow-up audit. No user-visible behavior changes; defence-in-depth on the loopback HTTP surface.

  - **L3, redact internal error envelope message.** `src/server/app.ts` previously returned the raw `err.message` verbatim in the `{ ok: false, error: { code: 'internal', message, details: null } }` envelope for any unmapped throw. Kernel errors carry absolute paths and registry-probe hostnames in their messages, so a hostile probe could observe disk layout / DNS targets just by triggering an uncaught error. The fall-through branch now sets `error.message` to a generic constant (`SERVER_TEXTS.internalError`) and routes the real detail (message + stack when present) to `log.warn` so operators still see it on stderr / their log file. Envelope shape (`code`, `details`) is unchanged. Mapped throws (`HTTPException`, `ExportQueryError`, `EConsentRequiredError`, `DbMissingError`, `BulkValidationError`, `LoopbackGateError`) keep carrying their authored messages because those live in `server.texts.ts` and are safe to ship.
  - **L4, sanitize `c.req.path` in 404 templates.** The `/api/*` catch-all and the `app.notFound` SPA fallback in `src/server/app.ts` interpolated `c.req.path` straight into `SERVER_TEXTS.unknownApiEndpoint` / `SERVER_TEXTS.unknownPath`. Hono URL-decodes the path before exposing it, so attacker-controlled bytes (ANSI CSI sequences, CR/LF, BEL, NUL) flowed into the JSON envelope and, more importantly, into stderr / log lines the CLI mirrors to a terminal. Both call sites now pass the path through `sanitizeForTerminal` (the kernel helper used at ~180 sites already) before interpolation. CR/LF stay readable (the sanitiser explicitly keeps them); ANSI escapes and the rest of the C0 control subset get stripped.

  Note: audit L5 (drop `'localhost'` from the loopback gate allow-list) was attempted and reverted. It broke the Angular dev-server proxy workflow (`ng serve` on port 4200 forwards `Host: localhost:4200` to the BFF) for a narrow residual risk (poisoned `/etc/hosts`) that also requires the operator to bind the BFF off-loopback, a combination already rejected by `options.ts` when paired with `--dev-cors`. The standing assumption is "localhost resolves to loopback on every operator's machine".

  Tests added: `src/test/server-error-hardening.test.ts` covers L3 (envelope redaction + log.warn detail routing across `Error`, `TypeError`, and HTTPException-mapped throws) and L4 (ANSI CSI, BEL/NUL, cursor-move CSI). `formatError` is exported from `src/server/app.ts` so unit tests can drive every branch without booting the full server.

- 15bf673: Security hardening, three follow-up audit fixes. No user-visible behavior changes; defence-in-depth on internals.

  - **M2, deep prototype-pollution strip on frontmatter parse + enrichment merge.** `src/built-in-plugins/parsers/frontmatter-yaml/index.ts` previously filtered `__proto__` / `constructor` / `prototype` only at the root of the parsed YAML; a nested `meta: { __proto__: { polluted: true } }` survived as an own data property (`js-yaml` v4 with `JSON_SCHEMA` keeps `__proto__:` as a regular key at any depth) and flowed into downstream `Object.assign`-style merges where the `__proto__` setter fires. The parser now routes the parsed document through `stripPrototypePollution` (the kernel's existing deep-strip helper at `src/kernel/util/strip-prototype-pollution.ts`, already used at the sidecar parse boundary), so the forbidden keys are dropped at every depth. `assignSafe` in `src/kernel/orchestrator/node-build.ts` (the merge primitive feeding `mergeNodeWithEnrichments`) likewise gained a deep strip on its source, closing the same surface for enrichment rows.
  - **M3, deep strip on JSON round-trip of `valueJson` + `payloadJson`.** AJV validation at emit time does not necessarily forbid `__proto__` / `constructor` / `prototype` (slot payload schemas vary; enrichment values are plugin-shaped). Without a load-time strip, a future deep-merge of a loaded enrichment value or contribution payload could still fire the prototype setter even though the in-memory write path was clean. `loadNodeEnrichments` in `src/kernel/adapters/sqlite/scan-load.ts` and `rowToContribution` in `src/kernel/adapters/sqlite/contributions.ts` now wrap their `JSON.parse` outputs in `stripPrototypePollution` before returning.
  - **L1, malformed-YAML diagnostic surfaces as a warn issue.** A `yaml.load` throw inside the frontmatter parser previously degraded silently to `frontmatter: {}`, the author's typo or hostile YAML produced no warning. The parser now also returns a per-issue `IParseIssue` (new optional field on the kernel-internal `IParsedFile`), the walker forwards it on `IRawNode.parseIssues`, and `buildFreshNodeAndValidateFrontmatter` maps it to a `frontmatter-parse-error` warn-level kernel `Issue` (promoted to `error` under `--strict`, consistent with the existing `frontmatter-invalid` / `frontmatter-malformed` paths). The fallback `parsed = {}` behaviour is unchanged; the diagnostic is additive. The orchestrator cache index keeps prior `frontmatter-parse-error` rows alongside the other frontmatter-shape issues so an incremental scan of an unchanged file does not silently drop the warning. Parser-error messages are sanitised (control characters stripped, whitespace collapsed) before they leave the parser.

  Tests added: `src/built-in-plugins/parsers/frontmatter-yaml/frontmatter-yaml.test.ts` covers parser-side deep strip and parse-error surfacing; `src/test/pollution-defence.test.ts` covers the deep strip through `mergeNodeWithEnrichments`; `src/test/pollution-defence-storage.test.ts` covers M3 at both storage read boundaries; `src/test/scan-frontmatter-malformed.test.ts` covers end-to-end `frontmatter-parse-error` emission, `--strict` promotion, and cache reuse on incremental scans.

- 36b1865: Security hardening, three fixes from a follow-up audit. No user-visible behavior changes; defence-in-depth on internals.

  - **H1, walker TOCTOU.** `kernel/scan/walk-content.ts` now re-verifies discovered entries with `lstat()` instead of `stat()`. The previous `stat()` call followed symlinks, leaving a narrow race window where an entry that was a regular file at `readdir` time could be swapped for a symlink (e.g. to `~/.ssh/id_rsa`) before the re-check, with the target's contents then persisted in `scan_nodes.body_hash` and returned from `/api/nodes/:pathB64?include=body`. `lstat()` plus the existing `isFile()` predicate rejects symlinks, sockets, FIFOs, and devices that appeared in the race window.
  - **M1, predictable temp filenames in atomic writes.** `writeJsonAtomic` (settings) and `kernel/sidecar/store.ts:atomicWriteFile` (`.sm` sidecars) previously composed sibling temp paths as `<target>.tmp.<pid>` and `<target>.tmp.<pid>.<Date.now()>`, both fully predictable, then called `writeFileSync`, which follows symlinks. A local attacker could pre-plant a symlink at the predicted temp path and redirect the privileged write. Both call sites now share `writeFileAtomicExclusive(path, content)` in `core/config/atomic-write.ts`, which appends a CSPRNG-random suffix (`randomBytes(8).toString('hex')`) and opens the staging file with `O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW` at mode `0o600`. `O_EXCL` makes the open fail with `EEXIST` if anything exists at the temp path; `O_NOFOLLOW` makes it fail with `ELOOP` if the leaf is a symlink. Mode `0o600` survives the POSIX same-filesystem rename.
  - **M4, BFF body-limit middleware.** `src/server/app.ts` mounts `hono/body-limit` on `/api/*` with a 1 MiB cap (`BODY_LIMIT_BYTES`). `c.req.json()` / `parseBody()` would otherwise buffer the whole body in memory; loopback-only mitigated but did not eliminate the heap-exhaustion lane (DNS-rebinding defences live one layer up). Cap is well above every legitimate payload (`scan.extraFolders[]`, bulk PATCH `changes`, sidecar bump). 413 responses funnel through the existing `app.onError` and carry the canonical `{ ok: false, error: { code: 'payload-too-large', message, details: null } }` envelope. `TErrorCode` gains `'payload-too-large'`; `codeForStatus` maps HTTP 413 to it.

  Tests added: `src/kernel/scan/walk-content.test.ts` covers the H1 lstat re-check, `src/test/atomic-write-exclusive.test.ts` covers the M1 syscall flags + random suffix, `src/test/server-body-limit.test.ts` covers the M4 413 envelope.

- ff3121f: Security hardening, safer Windows browser launcher in `sm serve`. No user-visible behavior changes; defence-in-depth on internals.

  - **L2, `cmd /c start` argv re-parsing.** `cli/commands/serve.ts:tryOpenBrowser` previously spawned `cmd.exe` with `args = ['/c', 'start', '""', url]`. The string `'""'` was a manually-quoted empty title; `cmd.exe` re-parses its argv before invoking the URL handler, so if the URL ever carried an unquoted shell metacharacter (`&`, `|`, `^`, `<`, `>`, `%`, or a stray `"`), `cmd` would re-interpret the trailing characters as command separators or environment-variable expansions. Today the URL is always a loopback `http://<host>:<port>/` validated upstream by the BFF host check, so the risk was forward-looking, not a current attack.
    - Two changes ship: (1) the empty title slot is now a proper empty-string argv entry (`['/c', 'start', '', url]`) instead of the literal `'""'`, so the spawn argv is unambiguous and no stray quote pair reaches `cmd`. (2) The URL passes through `validateBrowserUrl(url)` in `cli/util/browser-launch.ts` before any spawn. The validator rejects every `cmd` shell metacharacter listed above plus C0 control bytes and DEL (CRLF injection, NUL truncation, raw ESC terminal smuggling). On rejection the verb logs the existing non-fatal `openFailed` hint to stderr and skips the spawn; the URL is already printed on the boot banner, so the user can open it manually.
    - The validator is a pure helper (string in, boolean out) and is exercised by a dedicated test file (`test/browser-launch-validate-url.test.ts`) without mocking `child_process`. Zero new dependencies; the repo's pin-every-dep policy and dep-weight preference made the `open` package unattractive when a 30-line gate covers the concern.

- 5f4de1c: Security audit sweep (cli-hacker follow-up). Three highs, three mediums, three lows, plus the shared prototype-pollution helper and a plugin-author doc note.

  - **H1** — BFF rejects non-loopback `Host` and `Origin` headers on every request (port-agnostic hostname allow-list). Closes the DNS-rebinding lane where a malicious page in the operator's browser could weaponise the local API by resolving an attacker-controlled hostname to 127.0.0.1.
  - **H2 / L2** — Sidecar `deepMerge` + `readSidecarFor` parse strip `__proto__` / `constructor` / `prototype` keys at every depth. Shared helper in `kernel/util/strip-prototype-pollution.ts` (also adopted by `kernel/config/loader.ts`).
  - **H3** — Bumped `hono` to 4.12.18 and `kysely` to 0.28.17. Added a root `overrides.fast-uri: 3.1.2` to lift the transitive past the path-traversal advisories. Lockfile regenerated.
  - **M1** — Settings + sidecar atomic writes now land mode 0o600 (matches `db restore`'s discipline).
  - **M2** — `sm job prune` rejects `unlink()` on paths that don't stay inside `<scope>/.skill-map/jobs/`.
  - **M3** — Orphan-files walker skips symlinks (parity with the scan + reference walkers).
  - **L1** — Sidecar temp filename embeds `pid` + timestamp (cross-process race window).
  - **L3** — `fetchLatestVersion` rejects registry responses whose `version` is not a semver-shaped string.
  - **L5** — Two BFF error envelopes on `/api/contributions/*` sanitize URL params before interpolation.
  - **L4** — Plugin author guide spells out that module top-level side effects survive an `import()` timeout, so plugins must do their work inside lifecycle methods.

  ## User-facing

  `sm serve` now rejects browser requests whose `Host` or `Origin` is not a loopback name. Closes a DNS-rebinding lane where a malicious page could trigger scans or settings writes. `--dev-cors` still works for Vite-style dev UIs on a different loopback port.

- b17bf41: Tutorial F3 — close consent-gate leak across user-level config layers. `allowEditSmFiles`, `scan.extraFolders`, and `scan.referencePaths` are spec'd as project-local-only, but the loader's strip used to fire only on the committed `project` layer; values in `user` / `user-local` / `override` survived and silently granted consent (or applied paths) in every project. Now stripped from every non-project-local layer, with a directed warning naming the offending layer + key.

  Behaviour change for operators: a `~/.skill-map/settings.json` or `~/.skill-map/settings.local.json` that carries any of these three keys will emit a warning on the next load and the value will not apply. Move the key into `<project>/.skill-map/settings.local.json` (per-checkout, gitignored) to retain the intent.

  ## User-facing

  `sm` now refuses to grant the `.sm` write consent (or apply `scan.extraFolders` / `scan.referencePaths`) from user-level config. The first prompt re-appears per project. Move stray values into `<project>/.skill-map/settings.local.json` (gitignored).

- Updated dependencies [c1ed77a]
- Updated dependencies [608e6ae]
- Updated dependencies [c2152cc]
- Updated dependencies [5f4de1c]
- Updated dependencies [639a95b]
  - @skill-map/spec@0.23.0

## 0.22.0

### Minor Changes

- 39a61e9: Remove the implicit "scan HOME" surface and consolidate every out-of-project scan path under a single, explicit `scan.extraFolders` setting. Privacy-by-default: the CLI / BFF / UI never read the user's home automatically anymore; every path outside the project root must be listed by the operator.

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

  The "include HOME" toggle is gone. To scan paths outside the project, list them in **Extra folders to scan** (renamed from _Extra roots_). If you had `scan.includeHome: true`, add the paths you actually need (e.g. `~/.claude/agents`) — not one click anymore.

### Patch Changes

- 1e48d2e: Follow-up sweep on the cli-architect spec-drift audit. Three pieces:

  - **5a — plugin loader status alignment.** The loader now returns `invalid-manifest` (not `load-error`) when the exported extension shape fails its kind-specific AJV schema. Aligns with `spec/architecture.md` §Plugin discovery: "AJV rejects unknown `slot` names with `invalid-manifest`". The module imported fine; only the declared shape is wrong, so `invalid-manifest` is the semantically correct status (`load-error` is for genuine module-load failures: import threw, timeout, unknown kind). Renames `PLUGIN_LOADER_TEXTS.loadErrorManifestInvalid` → `invalidManifestExtensionShape` to match. 4 tests updated.

  - **7 — `emitScopeContribution` docs alignment.** Added a "pending, not yet implemented" status note to `spec/view-slots.md` and `spec/plugin-author-guide.md`. The two author-facing docs previously showed the callback as if it existed; `spec/architecture.md` already says it's "reserved, lands when the first scope-level adopter arrives". A plugin author who copies the example now sees the caveat upfront instead of hitting `TypeError: ctx.emitScopeContribution is not a function` at runtime.

  - **P2 cosmetic prose sweep.** Slot-count references corrected ("15 slots" → "14" — the closed enum has 14 entries since the topbar scope-slot rename); `IViewContribution` field count corrected ("six fields" → "seven" — `priority?` was declared in the schema since the beginning but never documented in prose). Three spec docs swept; `spec/index.json` regenerated.

  `catalogCompat` (5b in the audit) — schema field declared but loader check not implemented — is deferred until catalog v2 evolution demands it. No catalog evolution is pending pre-1.0, so the gap is acceptable; flagged in audit follow-ups, not in this changeset.

- b6aa85e: Apply four P1 findings from the cli-architect audit on `src/` — three are pure internal refactors (no observable behaviour change), one tightens BFF input validation.

  **A1 — move `assertContained` to `core/paths/path-guard.ts`**

  The path-containment guard is a pure security primitive consumed by both `cli/commands/` (`refresh`, `sidecar`, `bump`) and `server/routes/sidecar.ts`. It used to live under `cli/util/` and force the BFF to reach across the CLI boundary; the move closes the last cross-driver import from `src/server/` into `src/cli/util/`. Pattern mirrors the earlier `db-path.ts` split.

  **A2 — share `collectViewContributions` between user-plugin and built-in harvest**

  `core/runtime/plugin-runtime.ts` (user plugins) and `server/index.ts` (built-ins) both used to re-implement the same `viewContributions` projection with subtle drift: the built-in path silently dropped the `priority` field, the user-plugin path preserved it. Extracted to `kernel/extensions/collect-view-contributions.ts` with an optional `excludeQualifiedIds` set so the built-in pass can skip entries already harvested via the user-plugin route. Removes one `eslint-disable complexity` and one duplicated typeof-guard chain.

  **A3 — AJV body validation factory for the BFF**

  New `server/util/parse-body.ts` exports `makeBodyValidator<T>(schema, messages)`. Each schema compiles ONCE at module import; the hot path is `req.json() → typeof guard → compiled.validate() → throw or return`. Messages route through a `(instancePath, keyword)` mapping table that resolves to existing `SERVER_TEXTS` constants (no message drift); numeric array indices in `instancePath` normalise to `*` so a single mapping entry matches any failing item.

  Five hand-rolled `parseBody` / `parsePatchBody` parsers across four routes migrated:

  - `server/routes/sidecar.ts` — `POST /api/sidecar/bump`
  - `server/routes/preferences.ts` — `PATCH /api/preferences`
  - `server/routes/project-preferences.ts` — `PATCH /api/project-preferences`
  - `server/routes/plugins.ts` — `PATCH /api/plugins/:id` + bulk `PATCH /api/plugins`

  Cuts five `eslint-disable complexity` overrides. Every schema declares `additionalProperties: false`, so unknown keys that previously slipped through silently now surface as `400 bad-query` — typed flags / settings clients gain a stricter contract surface. The propio UI never sends extras, so no end-user observable change.

  **A4 — split `assembleBootBundle` into `assemblePluginRuntime` + `assembleKernel`**

  The boot pipeline now separates "what plugins exist" (discovery + `kindRegistry`) from "what the kernel exposes to routes" (`kernel` + `contributionsRegistry`). `createServer` chains the two halves in two lines; each half is independently testable.

  **Tests**

  - `test/server-parse-body.test.ts` — 14 unit tests for the helper (notJson / notObject short-circuits, valid pass-through, mapping resolution per keyword, function resolvers with template interpolation, array index normalisation, schema compiled once).
  - `+13 E2E tests` across `preferences-route.test.ts`, `project-preferences-route.test.ts`, `server-sidecar-endpoint.test.ts`, `server-endpoints.test.ts` covering the new `additionalProperties: false` rejection paths, `minLength: 1` constraints on string identifiers, and item-level type checks inside arrays.

  1364/1364 tests pass.

- a91b1dd: Architect-audit follow-up: split `cli/commands/bump.ts` into a pure plan-computation half and a side-effect adapter half.

  - **`cli/commands/bump-plan.ts` (new)** — `computeBumpPlan(nodes, { cwd, force })` returns an `IBumpPlan = { items: TBumpPlanItem[] }` without touching disk. Each item carries `status: 'bumped' | 'refused' | 'skipped' | 'error'` plus the writes / report / message the verb needs to render. Wraps the existing `bumpAction.invoke()` (already pure) and the `assertContained` path-guard. Now trivially unit-testable: 10 cases cover path traversal, fresh/stale outcomes, batch order, and mixed plans.
  - **`cli/util/git.ts` (new)** — the three `spawnSync` git helpers (`isInsideGitRepo`, `ensureGitForStaged`, `stageSidecar`) used by `--staged`. Isolated so the only spawn site in the CLI lives in one place; +7 integration tests against real tempdir repos.
  - **`cli/commands/bump.ts`** — composition root. The verb consumes the plan, applies writes via `FilesystemSidecarStore`, runs `git add` per item, renders. Split into smaller methods (`#validateFlagCombo`, `#preflightStaged`, `#executePending`, `#executePendingItem`, `#renderTerminalSingle`, `#applyBumpedSingle`, `#renderEmptyPending`, `#maybeStageWarn`) plus standalone `terminalOutcomeFor` / `buildBumpedOutcome` / `applyBumpWrites` helpers.

  **Eslint complexity disables: 5 → 1** (the remaining one is `#renderPendingOutcome`, which fans out per-status rendering — legitimate flat branching that doesn't decompose further).

  No behaviour change. The 15 existing `bump-cli.test.ts` / `bump-action.test.ts` cases pass unchanged; +17 new unit tests cover the extracted pieces.

- 129483e: Split `cli/commands/db.ts` (943 LOC, 7 subverbs in one file) into one file per subverb under `cli/commands/db/`, plus a `shared.ts` for cross-subverb helpers. Same shape as the earlier `cli/commands/plugins/` split.

  **Layout.**

  ```
  cli/commands/db.ts          — barrel (42 LOC). Re-exports DB_COMMANDS +
                                every subverb class.
  cli/commands/db/
  ├── shared.ts        30 LOC — SAFE_SQL_IDENTIFIER_RE + assertSafeIdentifier
  │                              (consumed by reset and dump).
  ├── backup.ts        65 LOC — DbBackupCommand
  ├── restore.ts      125 LOC — DbRestoreCommand + chmodOwnerOnlyBestEffort
  │                              (single caller, kept local)
  ├── reset.ts        184 LOC — DbResetCommand
  ├── shell.ts         59 LOC — DbShellCommand
  ├── browser.ts       95 LOC — DbBrowserCommand
  ├── dump.ts         164 LOC — DbDumpCommand + dumpDatabaseToStream +
  │                              listSchemaObjects + writeTableData +
  │                              formatSqlNumber + formatSqlValue
  └── migrate.ts      322 LOC — DbMigrateCommand + runPluginMigrations +
                                formatKernelName
  ```

  **Compatibility.** The barrel re-exports `DB_COMMANDS` + every subverb class with the same name. The 4 existing importers (`cli/entry.ts`, `test/plugin-migrations.test.ts`, `test/dry-run-invariant.test.ts`, `test/elapsed-invariant.test.ts`) keep working unchanged.

  **Eslint disables.** 2 preexisting `eslint-disable complexity` survive (on `DbResetCommand.run` and `DbMigrateCommand.run`) — both legitimate per `context/lint.md` category 1 (CLI orchestrators with multi-flag handling). No new disables introduced.

  No behaviour change. 1381/1381 tests pass.

- c5959d2: Architect-audit follow-up: split `kernel/orchestrator.ts` (2972 LOC, 5 `eslint-disable complexity`) into one file per pipeline stage under `kernel/orchestrator/`. Two-phase change in a single commit:

  **Phase 1 — in-place complexity reduction.** Five hotspots refactored to satisfy the lint cap without disables:

  - `runScanInternal` — 4 phase helpers extracted (`buildScanSetup`, `dispatchExtractorCompleted`, `mergeAnalyzerEmissions`, `buildScanStats`, `buildScanReturn`). The function reads as a linear sequence of phase calls.
  - `indexPriorSnapshot` — split into `indexPriorNodes` + `indexPriorLinks` + `indexPriorFrontmatterIssues` (one loop each).
  - `computeCacheDecision` — split into `splitLegacy` (pre-A.9 fallback) + `splitFineGrained` (with `priorExtractorRuns` map). Wrapper picks the path.
  - `walkAndExtract` — 11 buffers grouped into `IWalkAccumulators`, 5 lookups into `IWalkContext`, per-node state into `IProcessNodeContext`. Loop body delegates to `processRawNode` → `applyFullCacheHit | applyExtractPath`. Side helpers: `attachSidecar`, `buildOrReuseNode`, `isPartialCacheHit`, `emitExtractProgress`, `recordFreshlyRunTuples`, `mergeExtractResult`, `recordExtractorRuns`.
  - `reuseCachedLink` — `classifyLinkSource` (cached/missing/obsolete) + `partitionLinkSources` (buckets).

  **Phase 2 — file split per pipeline stage.** Mechanical move of the now-cohesive helpers into a directory layout that mirrors the scan flow:

  ```
  kernel/orchestrator.ts       — barrel (48 LOC). Re-exports every public symbol;
                                 importers (cli/commands/refresh.ts, sqlite adapters,
                                 ports/storage, kernel/index, tests) untouched.
  kernel/orchestrator/
  ├── index.ts        623 LOC  — runScan, runScanWithRenames, runScanInternal,
  │                              phase helpers, validateRoots, SCANNED_BY.
  ├── walk.ts         663 LOC  — walkAndExtract + IWalkAccumulators/Context +
  │                              processRawNode + apply paths + per-node helpers.
  ├── cache.ts        461 LOC  — computeCacheDecision split, cloneNodeAndReshape,
  │                              reusePriorNode, reuseCachedLink, IPriorIndex,
  │                              indexers, originatingNodeOf.
  ├── extractors.ts   410 LOC  — runExtractorsForNode (export), buildExtractorContext,
  │                              validateLink, recomputeLink/ExternalRefsCount.
  ├── analyzers.ts    170 LOC  — runAnalyzers, validateIssue.
  ├── renames.ts      251 LOC  — detectRenamesAndOrphans (export) + 5 helpers.
  ├── frontmatter.ts  149 LOC  — validateFrontmatter, detectMalformed, classifyMalformed.
  └── node-build.ts   433 LOC  — buildNode, countTokens, hashes, sidecar resolution,
                                  mergeNodeWithEnrichments, IPersistedEnrichment.
  ```

  **Result.** 5 `eslint-disable complexity` → 0. No behaviour change; all 11 public exports preserved through the barrel; no importer was modified. `cli-reference.md` in sync; 1381/1381 tests pass.

  **Tangent — bench budget bump.** `scan-benchmark.test.ts:94` `BUDGET_MS: 7000 → 10000` to absorb WSL2 jitter (observed up to 8615ms under contended workspace-wide `npm run validate`; ran 1782ms in isolation). The benchmark stays an assertion, not a skip — `SKILL_MAP_SKIP_BENCHMARK=1` already exists for the coverage path.

- 5f19e71: Split two coupled kernel-side files into per-concern directories. Same shape as the earlier `kernel/orchestrator/` split.

  **`kernel/adapters/plugin-loader.ts`** (991 LOC → 35 LOC barrel + 5 files under `plugin-loader/`):

  ```
  plugin-loader.ts         35 LOC  — barrel
  plugin-loader/
  ├── index.ts            524 LOC  — PluginLoader class + createPluginLoader +
  │                                  installedSpecVersion + DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS
  ├── validation.ts       177 LOC  — validateAnnotationContributions +
  │                                  validateHookTriggers + KNOWN_KINDS catalog
  ├── storage-schemas.ts  154 LOC  — loadStorageSchemas + compilePluginSchema
  ├── id-utils.ts         135 LOC  — fail + isInsidePlugin + describe + isRecord +
  │                                  pathId + applyIdCollisions
  └── import-helpers.ts    93 LOC  — importWithTimeout + extractDefault +
                                     stripFunctionsAndPluginId + stripKindsRuntimeFields
  ```

  The `PluginLoader` class itself stays whole inside `plugin-loader/index.ts` (~400 LOC) — its private helpers stay private; the value of this split is moving the standalone validation / id / import / storage helpers into cohesive files where each is reachable on its own.

  **`core/runtime/plugin-runtime.ts`** (981 LOC → 57 LOC barrel + 6 files under `plugin-runtime/`):

  ```
  plugin-runtime.ts        57 LOC  — barrel
  plugin-runtime/
  ├── index.ts            299 LOC  — loadPluginRuntime + IPluginRuntimeBundle +
  │                                  ILoadPluginRuntimeOptions + emptyPluginRuntime +
  │                                  AnnotationContributionConflictError +
  │                                  enforceRootExclusivity
  ├── composer.ts         368 LOC  — composeScanExtensions + composeFormatters +
  │                                  registerEnabledExtensions +
  │                                  accumulateBuiltInScanExtensions +
  │                                  IConformanceKillSwitches
  ├── resolver.ts         148 LOC  — buildEnabledResolver + isBuiltInExtensionEnabled +
  │                                  isBundleEntryEnabled + isPluginExtensionEnabled +
  │                                  buildGranularityMap + defaultResolveEnabled
  ├── bucketing.ts        110 LOC  — bucketLoaded + collectAnnotationContributions +
  │                                  isExtensionInstance
  ├── warnings.ts          96 LOC  — emitWarnings + formatWarning + cap constants +
  │                                  resolveRuntimeContext + resolveSearchPaths
  └── catalogs.ts          76 LOC  — collectRegisteredContributionKeys +
                                     filterBuiltInManifests
  ```

  **Compatibility.** Both barrels re-export every public symbol so the 18 existing importers (9 per file) keep working without modification.

  **Eslint disables.** Counts preserved: 5 on the loader side, 5 on the runtime side, all legitimate per `context/lint.md` (validation gates, multi-fold accumulators, kind-specific dispatch). No new disables introduced.

  No behaviour change. 1381/1381 tests pass.

- 4d8d527: Architect-audit follow-up: split `cli/commands/plugins.ts` (1700 LOC, 7 `eslint-disable complexity`, 7 subcommands) into per-verb modules under `cli/commands/plugins/`.

  - **`cli/commands/plugins.ts`** is now a 66-LOC barrel that re-exports every command class plus `PLUGIN_COMMANDS`. Importers (`cli/entry.ts`, `test/elapsed-invariant.test.ts`) keep working unchanged.
  - **`cli/commands/plugins/shared.ts`** — cross-verb helpers (`resolveSearchPaths`, `buildResolver`, `loadAll`, `builtInRows`, `omitModule`, `wrapText`, `IScopeOptions`, `IBuiltInBundleRow`).
  - **`cli/commands/plugins/list.ts`** — `PluginsListCommand` + render helpers.
  - **`cli/commands/plugins/show.ts`** — `PluginsShowCommand`; `resolveShowLookupId` split into `parseQualifiedId` + `collectKnownExtensions` + three error builders; `renderPluginDetail` split into `renderPluginDetailHeader` + `renderPluginDetailFields` + `collectPluginExtensionItems`.
  - **`cli/commands/plugins/doctor.ts`** — `PluginsDoctorCommand` with `run()` split into 5 render methods (`#renderSummaryHeader`, `#renderSourceBreakdown`, `#renderStatusBreakdown`, `#renderWarnings`, `#renderIssues`) plus `#emitWarningEntry`; `forEachProviderInstance` and `collectApplicableKindWarnings` each split into a built-in pass + a user-plugin pass.
  - **`cli/commands/plugins/toggle.ts`** — `TogglePluginsBase` with `toggle()` split into 5 phases (`#validateArgs`, `#pickTargets`, `#applyLockGate`, `#persistTargets`, `#renderSuccess`); `resolveToggleTarget` split into `resolveQualifiedToggle` + `resolveBareToggle`.
  - **`cli/commands/plugins/create.ts`** — `PluginsCreateCommand` + scaffolder stubs.
  - **`cli/commands/plugins/slots.ts`** — `PluginsSlotsListCommand`.
  - **`cli/commands/plugins/slots-catalog.ts`** — `VIEW_SLOTS_CATALOG` / `INPUT_TYPES_CATALOG` constants (reusable by future verbs).
  - **`cli/commands/plugins/upgrade.ts`** — `PluginsUpgradeCommand`.

  **Eslint complexity disables: 7 → 0.** Every function that previously needed the override decomposes into smaller helpers; the lint cap is now satisfied structurally.

  No behaviour change. The 36 existing tests (`plugins-cli.test.ts`, `plugins-doctor.test.ts`, `plugins-show-cli.test.ts`, `elapsed-invariant.test.ts`) pass unchanged.

- 598135c: Architect-audit follow-up: full complexity-disable sweep across `src/kernel/adapters/sqlite/`. **18 `eslint-disable complexity` → 0** across 7 files. Pure structural refactor — every function preserves its prior signature and behaviour; tests pass unchanged.

  **`storage-adapter.ts` (2 → 0).** `applyPersistDefaults` helper replaces the inline `?? []` / `?? new Set()` cascades in `persistScansThroughNonTx` and `buildTxSubset.persist`. Uses object-spread defaults so each call constructs fresh `[]` / `new Set()` instances (no shared mutable state leaks across persist calls).

  **`scan-persistence.ts` (3 → 0).**

  - `persistScanResult`: extracted `validateScannedAt`, `applyRenames`, `appendStrandedOrphans` (and its `collectKnownOrphanPaths` helper). The transaction body now reads as 5 sequential phase calls.
  - `nodeToRow`: split into `projectAnnotationColumns`, `projectSidecarPresence`, `projectSidecarJson`, `projectTokenCounts`. Each helper returns a `Pick<Insertable<…>>` so the main mapping stays type-safe.
  - `linkToRow`: split into `projectLinkTrigger`, `projectLinkLocation`.

  **`contributions.ts` (1 → 0).** `replaceAllScanContributions` split into 4 sweep passes (`sweepOrphanContributions`, `sweepCatalogContributions`, `sweepPerTupleContributions`, `upsertContributionsBuffer`) plus internal helpers `buildContributionsBufferKeys`, `groupFreshlyRunTuplesByPluginExt`, `deleteStaleTupleRows`. Same per-tuple sweep ordering; NUL-separator invariant preserved.

  **`migrations.ts` (1 → 0).** `applyMigrations` extracted `resolveMigrationTarget`, `writePreMigrateBackup`, `applyOneMigration`. The remaining body is dispatch glue.

  **`plugin-migrations.ts` (1 → 0).** `applyPluginMigrations` extracted `preflightValidateAll` (Layer 1) and `applyOnePluginMigration` (Layer 2 + per-migration transaction). The two-pass safe-apply contract stays intact.

  **`plugin-migrations-validator.ts` (4 → 0).**

  - `validatePluginMigrationSql` split into `detectForbiddenKeywords` + `detectStatementViolations` (with `matchStatement` and `collectObjectViolations` helpers).
  - `objectName` split into `stripParenAndTrailingPunct`, `splitSchemaQualifier`, `stripIdentifierWrapper`.
  - State machines `detectCommentMarkerInLiteral` and `splitStatements` refactored to use `scanCheckedLiteral` / `findCommentMarker` / `copyQuotedRegion` / `skipUntilCloser` helpers. The char-by-char dispatcher in each main function shrinks to a 4-way `QUOTE_OPENERS` check.

  **`history.ts` (5 → 0).**

  - `executionToRow` split into `projectExecutionOptionalAudit` + `projectExecutionTokens`.
  - `listExecutions` extracted `applyExecutionFilters` (generic over Kysely's `SelectQueryBuilder`).
  - `accumulateExecutionRow` split into 4 accumulators: `accumulateTotals`, `accumulatePerAction`, `accumulatePerPeriod`, `accumulatePerNode`.
  - `findStrandedStateOrphans` split into 6 per-table sweeps: `collectStrandedJobs/Executions/Summaries/Enrichments/PluginKvs/Favorites`.
  - `migrateNodeFks` split into 6 per-table migrators: `migrateJobs/Executions/Summaries/Enrichments/PluginKvs/NodeFavorites` plus `emptyMigrateReport`. Each preserves the collision-detect → delete → insert-if-no-collision pattern verbatim.

  Net: +971/-667 LOC (overhead is per-helper jsdoc; each extracted function stays ~10-50 LOC and navigable). 1381/1381 tests pass.

- 093e2e9: Refactor `npm run validate` orchestration: every compilation-stage check across every workspace runs FIRST, then every test suite runs LAST. Fast-fail on typecheck / lint / build / spec-check / reference-check without paying the test-suite wait.

  **Root `package.json`.** `validate` is now `validate:compile && validate:test`:

  - `validate:compile` runs `validate:compile` in `spec, src, testkit, ui, web` (every workspace that has compile-stage checks).
  - `validate:test` runs `validate:test` in `src, testkit, ui, e2e, examples/hello-world` (every workspace that has tests).

  **Per-workspace.** Each workspace now exposes `validate:compile` and/or `validate:test`. `validate` stays as the composition (`validate:compile && validate:test`) for standalone use:

  - `spec`: compile = `spec:check && pin:check`.
  - `src` (`@skill-map/cli`): compile = `typecheck && lint && build && reference:check`; test = `test:ci`.
  - `testkit` (`@skill-map/testkit`): compile = `typecheck && build`; test = `test:ci`.
  - `ui`: compile = `build`; test = `test:ci`.
  - `web`: compile = `build`.
  - `e2e`: test = `test:ci` (with `prevalidate:test` hook for `install:browsers && demo:build`).
  - `examples/hello-world`: test = `test:ci`.

  **Cleanups.** Removed two redundancies that the new ordering exposed:

  - `src/test:ci` and `testkit/test:ci` no longer carry an inline `tsc --noEmit` (the compile phase already ran `typecheck`).
  - `src/pretest:ci` (which ran `tsup`) removed: the compile phase already ran `build`. Standalone `npm run test:ci` callers run `npm run build` first when needed.

  The visible change for plugin authors / contributors: `npm run validate` fails on the first compile error across ANY workspace before any test suite starts. Before: a workspace-internal compile error in `testkit` had to wait for `src`'s 40-second test suite first.

- Updated dependencies [1e48d2e]
- Updated dependencies [39a61e9]
  - @skill-map/spec@0.22.0

## 0.21.0

### Minor Changes

- 08c33b8: Fold `core/sidecar-drift` into `core/annotation-stale` and fix a per-tuple sweep bug that left stale view-contribution rows orphaned for nodes whose path contained slashes.

  **Sidecar drift surface unified under `core/annotation-stale`**

  The `core/sidecar-drift` extractor introduced in `0.21.0` is removed; its functionality moves into the existing `core/annotation-stale` analyzer so one extension owns the entire sidecar-staleness story. The dual surface is now:

  - **Issues panel** (`warn` severity, one per stale node) — unchanged behaviour.
  - **`graph.node.alert` corner badge** (`pi-sync`, severity `warn`, `count: 2` only on `stale-both`) — the surface that previously belonged to `core/sidecar-drift`.
  - **`card.footer.right` chip** (`pi-clock`, `value: 1` for one drifted face / `value: 2` for both, severity `warn`) — replaces the hardcoded `isStale` clock badge that used to live directly in `node-card.html`.

  One toggle (`sm plugins disable core/annotation-stale`) now turns off every drift surface at once. Tooltips drop the `{{path}}` placeholder because the badge already sits on the affected node — the path is redundant — and keep the `sm bump <path>` literal as the operator's one-call fix.

  **Files**

  - Removed: `src/built-in-plugins/extractors/sidecar-drift/{index.ts,sidecar-drift.test.ts}`, `src/built-in-plugins/i18n/sidecar-drift.texts.ts`. Registration reverted in `built-ins.ts`; the built-ins count assertions revert from 26 → 25 total and 7 → 6 extractors.
  - `src/built-in-plugins/analyzers/annotation-stale/index.ts` — declares `viewContributions: { drift, staleIcon }`, emits both alongside the existing `Issue`.
  - `src/built-in-plugins/i18n/annotation-stale.texts.ts` — adds `bodyTooltip` / `frontmatterTooltip` / `bothTooltip` (no `{{path}}` placeholder).
  - `src/built-in-plugins/analyzers/annotation-stale/annotation-stale.test.ts` — six unit tests covering the dual emission.
  - `ui/src/app/components/node-card/node-card.{html,ts}` — drops the hardcoded `isStale` block and its `isStale` / `sidecarStatus` / `sidecarTooltip` computeds; `effectiveIsStale` / `effectiveStaleTooltip` survive in `node-derived.ts` because the inspector still consumes them.

  **Per-tuple sweep bug fix (`/` → `\0` separator)**

  `replaceAllScanContributions` keyed `freshlyRunTuples` and `bufferKeys` with a `/` separator between `pluginId / extensionId / nodePath`. Paths with internal slashes (e.g. `.claude/agents/architect.md`) broke parsing — `lastIndexOf('/')` chopped at the wrong slash, the `(pluginId, extensionId, nodePath)` SELECT missed every existing row, and the per-tuple sweep silently no-op'd. The symptom in the wild: editing a `.sm` to force drift made the badges appear; reverting the edit (undo) did NOT clear them because the old rows survived the sweep.

  Separator is now `\0` (NUL). NUL is prohibited in POSIX paths and rejected by the kebab-case regex on plugin / extension ids, so collisions are impossible by construction. Producers (`orchestrator.ts`, two call sites — analyzers and extractors) and the consumer (`contributions.ts`) emit / parse the same separator. The wire format is internal: `freshlyRunTuples` is built in the orchestrator and consumed inside the same `replaceAllScanContributions` call.

  - `src/kernel/orchestrator.ts` — both `freshlyRunTuples.add(...)` sites switch to NUL.
  - `src/kernel/adapters/sqlite/contributions.ts` — `bufferKeys` build + tuple parse switch to NUL; the `lastIndexOf('/')` / `pe.indexOf('/')` parser is replaced by a `split('\0')` with a 3-parts guard.
  - `src/test/view-contributions.test.ts` — the existing sweep test is updated to the new format; a new regression `per-tuple sweep handles nodePaths with slashes` exercises `.claude/agents/architect.md` end-to-end.

  ## User-facing

  Stale sidecar drift now surfaces on the graph card via a `pi-sync` corner badge and a `pi-clock` footer chip — both fed by `core/annotation-stale`. Reverting a forced drift clears the badges immediately instead of leaving them pegged on the node.

- c43e499: Surface `core/broken-ref` and `core/unknown-field` issues on the graph card, reshape `core/annotation-stale` to a single icon-only chip, and clean up the renderer chrome across `node-icon` / `node-counter` / `node-alert`.

  **broken-ref + unknown-field gain a per-node chip + corner badge.** Both analyzers were Issue-panel-only; they now also emit to `graph.node.alert` (corner badge with optional count) and `card.footer.right` (counter chip with value + tooltip). Per-source aggregation: a node with three broken refs lights up ONE chip with `count: 3`, not three overlapping markers. The same model holds for unknown fields (aggregated across the rule's three surfaces: `annotations:` keys, root keys, plugin-namespaced values). Iconography: `pi-times-circle` for broken-ref, `pi-info-circle` for unknown-field. Both unlocked — `sm plugins disable core/<id>` clears both surfaces immediately via the eager-purge contract.

  **annotation-stale reshapes to icon-only footer chip.** Drops the `graph.node.alert` corner badge (which duplicated info with broken-ref / unknown-field already living there) and keeps only the `pi-clock` chip in `card.footer.right`. Emit with `value: 0` + the renderer's new `value > 0` guard yields an icon-only chip. The per-face detail (body / frontmatter / both) lives on the tooltip.

  **Renderer cleanup (`node-icon` / `node-counter` / `node-alert`).** All three lose the `background: var(--sm-severity-*-bg)` pill. Severity now drives `color` on the glyph (and on the value / count for counter / alert) directly — no tinted wrapper. The chip reads as one chromatic unit without competing with neighbour chrome.

  **Implementation**: per analyzer, the evaluate loop pushes issues as before and bumps a per-node count Map; a second loop emits the aggregated contributions. `Math.min(count, 99)` cap honours the slot schema. `replaceAllScanContributions`'s per-tuple sweep already barrels through the eager-purge path on disable / re-extract; the new emitters compose cleanly with the existing sweep semantics.

  **Tests**:

  - `src/built-in-plugins/analyzers/broken-ref/broken-ref.test.ts` — new file. Covers no-broken, single-broken (no count), multi-broken aggregation (count = N), the 99-cap branch, and the manifest declaration.
  - `src/built-in-plugins/analyzers/unknown-field/unknown-field.test.ts` — new file. Covers no-unknown, single-unknown, multi-surface aggregation, manifest declaration.
  - `src/built-in-plugins/analyzers/annotation-stale/annotation-stale.test.ts` — updated. Single contribution per stale node (`staleIcon` with `value: 0`); manifest assertion verifies one slot.
  - `src/test/view-contributions.test.ts` — the regression case "per-tuple sweep handles nodePaths with slashes" now reflects the current shape of annotation-stale (no longer emits to `graph.node.alert`).

  ## User-facing

  Nodes with broken references or unknown sidecar fields now show a colored chip in the card footer (and a matching badge on the graph view) with a count and tooltip. The stale-sidecar warning becomes a single `pi-clock` icon in the footer — tooltip explains which side drifted.

- f72dbfc: Card body + topbar polish, plus catalog rename of the topbar scope slot.

  **New extractor (`core/tools-count`)** — `src/built-in-plugins/extractors/tools-count/`. Reads `frontmatter.tools[]` on agent-kind nodes (Claude + Gemini share the field shape) and emits a `card.footer.left` counter chip with a wrench icon. Replaces the hardcoded wrench block previously rendered straight from `<sm-node-card>` (`toolsCount()` computed + `effectiveToolsCount` / `effectiveToolsBreakdown` helpers, all removed). `applicableKinds: ['agent']` gates the run at load time so skill / command / markdown nodes pay zero cost. Tooltip carries the joined tool names (capped at the 256-char slot limit).

  **Provider kind visuals normalised** — `src/built-in-plugins/providers/gemini/index.ts` and `agent-skills/index.ts`. Every Provider that contributes `agent` / `skill` / `command` now declares the same label + color + icon as Claude. The declaration STAYS per-Provider (the shape allows divergence the day a Provider wants its own identity for a kind), but today the values mirror Claude so the visual vocabulary is uniform regardless of where a node was sourced from. `<sm-kind-icon>` gains an optional `provider` input that resolves the icon per-Provider when the call site supplies one (today a no-op, ready to diverge tomorrow).

  **Slot catalog rename + relocate** — `topbar.actions.indicator` → `topbar.nav.start`. The slot moved from the topbar actions cluster (right side, between refresh / theme / settings) to the start of the topbar nav (left of the view-switcher links). The rename is a catalog-major-bump for any external plugin that emitted to the old name (pre-1.0 → ships as a `@skill-map/spec` minor per the versioning policy). Sweep covers `spec/schemas/view-slots.schema.json` (closed enum), `spec/view-slots.md`, `spec/architecture.md`, `spec/plugin-author-guide.md`, `src/kernel/types/view-catalog.ts`, `src/kernel/adapters/schema-validators.ts`, `src/built-in-plugins/analyzers/unknown-slot/index.ts`, `src/cli/commands/plugins.ts`, `ui/src/app/slots/slot-config.ts`, `ui/src/app/slots/slot-renderer-map.ts`, `ui/src/app/app.html`, `ui/src/app/renderers/scope-stat/scope-stat.ts`, `ui/src/app/debug-slots.css`, `context/view-slots.md`, `ROADMAP.md`. Spec integrity regenerated.

  **View-contribution wrapper transparent to layout** — `ui/src/app/debug-slots.css`. `.sm-debug-slot` and `<sm-view-contributions-host>` are `display: contents` in production mode, so a slot that has no contributions takes zero space (no flex gap, no empty box). Debug mode flips both back to `inline-flex` for the visual ring + label.

  **Provider chip in card subtitle** — `ui/src/services/provider-ui.ts` (new) + render in `<sm-node-card>`. Hardcoded chip carrying the provider's display label, color-coded per Provider so the platform a node came from reads at a glance. Unlike kind visuals (normalised), provider visuals are deliberately distinct. The `markdown` Provider is hidden (universal fallback — every generic `.md` lands there, painting the chip would be visual noise). Today the registry is a static UI-side map; promotes to a kernel-side `IProvider.ui` field the day a user-plugin Provider needs to declare its own chip.

  **Path row in expanded card** — `ui/src/app/components/node-card/node-card.html`. Mono row at the top of `.sm-gnode__panel`, above the description and the LLM cluster. Subtle background, ellipsis on the leading segments (RTL trick) so the file name stays visible on long paths.

  **Stat chip colors decoupled from `--sm-kind-*`** — `ui/src/styles.css` declares `--sm-stat-tokens-bg` / `--sm-stat-bytes-bg` / `--sm-stat-date-bg` (light + dark). Previously the chip backgrounds borrowed `--sm-kind-agent` / `--sm-kind-command` / `--sm-kind-skill`, which evaporate when their primary Provider plugin is disabled. Physical stats are plugin-independent — the new tokens keep the chips colored regardless of which plugins contribute kinds.

  **Favorite star (was heart)** — every favorite affordance flips from `pi-heart` / `pi-heart-fill` to `pi-star` / `pi-star-fill`: `<sm-node-card>`, `<sm-inspector-view>`, `<app-kind-palette>` (favorites toggle), `<app-filter-bar>` (favorites toggle). Spec describes match updated.

  **Author tag chips inherit the card's kind accent** — `node-card.css`. Outline color + text color come from `var(--accent)` (the kind's primary color, overridden per-Provider by `providerAccent`) instead of the theme's violet primary. Each card paints author tags in its own kind color.

  ## User-facing

  Expanded node cards now show the file path above the description and a provider chip (Claude, Gemini, Open Skills). Favorite toggle uses a star instead of a heart.

- 04f858d: Consolidate the card-footer link counters into a single `core/link-counts` pair and run a top-to-bottom icon-review pass across the topbar, the graph card, and the alert / chip surfaces of `broken-ref` + `unknown-field` + `stability`. Greenfield: no `catalogCompat` bump, no migration shim — the manifest catalog of built-in view contributions changes shape (three extractor chips drop, two analyzer chips appear, two analyzer payloads change) and no released external plugin keys off these IDs.

  **Built-in view contributions — kernel side**

  - `core/link-counts` (analyzer) — was a no-op placeholder; now the exclusive owner of `card.footer.left` link counters. Emits two contributions per node:

    - `linksIn` (`pi-arrow-up`) — every `Link.target === node.path`, grouped by `Link.kind`.
    - `linksOut` (`pi-arrow-down`) — every `Link.source === node.path`, same per-kind grouping.

    Both chips ship a multi-line tooltip with a direction header line so each chip is self-identifying when only one of the pair is visible:

    ```
    in
    invokes: 2
    mentions: 1
    references: 3
    ```

    Helpers `bump`, `emitChip`, and `formatBreakdown` factor the shared tally / render logic. Caps at `value: 99` to match the `_counter` slot ceiling; the raw count survives in the tooltip. `emitWhenEmpty: false` on both, so silent nodes stay quiet.

  - `core/slash`, `core/at-directive`, `core/markdown-link` (extractors) — entire `viewContributions` block + the matching `ctx.emitContribution('count', ...)` call removed. The three per-extractor chips that used to render side-by-side on `card.footer.left` (`/`, `@`, `📎` with the unified `pi-arrow-down` glyph) were noisy in aggregate; `core/link-counts` now expresses the same information as a single `↑ N` / `↓ N` pair with the per-kind breakdown one hover away.

  - `core/broken-ref` (analyzer) — icon + severity overhaul:

    - Alert (`graph.node.alert`): `pi-times-circle` → `fa-solid fa-circle-xmark` (filled, attention-grabbing); severity `warn` → `danger`; payload no longer carries `count` — the corner alert is icon-only and the chip below covers the number.
    - Chip (`card.footer.right`): `pi-times-circle` → `fa-regular fa-circle-xmark` (outlined, pairs with the count); severity `warn` → `danger`.

    The filled-vs-outlined split keeps the corner alert visually distinct from the footer chip even though both originate from the same analyzer.

  - `core/unknown-field` (analyzer) — icon + payload overhaul:

    - Alert (`graph.node.alert`): `pi-info-circle` → `fa-solid fa-triangle-exclamation` (matches the broken-ref "solid alert" pattern); payload no longer carries `count` (icon-only corner).
    - Chip (`card.footer.right`): `pi-info-circle` → `pi-question-circle`; chip now emits `value: 0` so NodeCounter renders icon-only, and the manifest flips `emitWhenEmpty: false` → `emitWhenEmpty: true` (the slot would otherwise treat `value: 0` as empty and drop the emission). The glyph weight now matches `annotation-stale`'s `pi-clock` chip sitting next to it on the same footer row.

  - `core/stability` (extractor) — `experimental` icon `pi-bolt` → `fa-solid fa-flask` (matches the "experimental" metaphor); `deprecated` stays `pi-ban`.

  - `src/test/server-endpoints.test.ts` — `bootWithDisabledBuiltIns` flips its disabled built-in from `core/at-directive` (which no longer carries a view contribution) to `core/tools-count`; the matching assertion checks `core/tools-count/count` in `contributionsRegistry`.

  **UI side — slot model + renderer + shell**

  - `ui/src/app/slots/slot-config.ts` — new `order: 'severity'` mode and new `showOverflowBadge?: boolean` flag on `ISlotConfig`. `graph.node.alert` is now `{ maxItems: 1, order: 'severity', showOverflowBadge: false }`: the worst severity claims the corner and the rest are suppressed silently (no `+N` badge — the corner is a single decoration by design). The severity rank is `danger > warn > info > success`, tie-breaks alphabetically.
  - `ui/src/app/components/view-contributions-host/view-contributions-host.ts` — new `severityRank` helper + `severity` branch in `sortBySlotOrder`; template guard `&& showOverflowBadge()` on the `+N` badge with a matching `showOverflowBadge` computed driven by the slot registry.
  - `ui/src/app/renderers/node-alert/node-alert.ts` — `.vc-alert` font-size `0.7rem` → `0.85rem`, `min-width / -height` `1rem` → `1.1rem` so the corner badge reads at a more legible size now that it is the sole decoration on the corner.

  **UI side — topbar + cards**

  - `ui/src/app/app.html` + `app.ts` + `app.css` — topbar icon sweep: update chip uses `pi pi-download`; nav-search uses `pi pi-search`; scan trigger uses `pi pi-sync` (with `pi-spin` while a scan runs); settings trigger uses `pi pi-sliders-h`. Theme switcher: `light` → `pi pi-sun`, `auto` → `pi pi-desktop`, `dark` stays `fa-regular fa-moon`. The update chip's padding is rebalanced to `3px 8px` (symmetric) with a 1px `translateY` nudge on the inner `<i>` to compensate for PrimeIcons' asymmetric metrics. New `.shell__nav-disabled` style for the List nav, which is converted from `<a routerLink>` to `<button disabled>` (the route stays reachable from the URL bar; only the nav surface is gated until the page is feature-complete).
  - `ui/src/styles.css` — `--sm-severity-warn` (light theme) `#92400e` → `#ca8a04` (yellow-600). Reads as gold rather than brown-red so warnings register as yellow against the new `danger` red used by broken-ref.
  - `ui/src/i18n/app.texts.ts` — `graphInfo` tooltip prepends `Run scan\n` so the scan trigger's tooltip names the action on top with the scope stats underneath; new `listLabel` / `listTooltip` for the disabled List nav.
  - `ui/src/app/views/graph-view/graph-view.html` — empty-state icons migrated to FontAwesome: loading `fa-spinner fa-spin`, error `fa-circle-exclamation`, filtered `fa-filter-circle-xmark`; toolbar reset-layout `pi-refresh` → `pi pi-history`.
  - `ui/src/app/components/node-card/node-card.html` — path icon `pi-folder-open` → `fa-regular fa-folder-open`; error stat `pi-times-circle` → `fa-solid fa-circle-xmark`; warn stat `pi-exclamation-triangle` → `fa-solid fa-triangle-exclamation`. Favorite button stays as `pi-star-fill` / `pi-star`.
  - `ui/src/app/components/node-card/node-card.css` — favorite repositioned via `top: -3px` so it sits closer to the chevron above; path styling adds `unicode-bidi: plaintext` alongside the existing `direction: rtl` so the start-side ellipsis still wins but the bidi algorithm no longer reorders neutral characters (the "trailing period" artifact after `.md` is gone).

  **Why one commit**

  The UI's `order: 'severity'` + `showOverflowBadge: false` on `graph.node.alert` and the analyzers' new corner-only icon-only payloads are one contract: shipping them split puts either the UI ahead of the kernel (the corner would show two icons with `+1` for a beat) or the kernel ahead of the UI (the suppressed alerts would surface as `+N` clutter). Same logic for the link-counts consolidation: dropping the three extractor chips before the analyzer reinstates the pair would leave nodes with zero left-footer counters for a window.

  **Verification**

  - `npm test` in `src/` → 1336 / 1337 pass. The one failure is the pre-existing flaky `scan-benchmark.test.ts` (timing-sensitive, unrelated).
  - `npx tsc --noEmit -p tsconfig.app.json` in `ui/` → exit 0.

  ## User-facing

  Footer link counters now read as a single in/out arrow pair (`↑` incoming, `↓` outgoing) with a per-kind tooltip; broken-reference corner alerts and counts read as red, unknown-field alerts get a clearer warning triangle. Topbar and card icons sharpened across the UI.

- 2c9aaad: Lock `core/annotations` so it can no longer be disabled.

  The annotations extractor turns the sidecar `annotations:` block's `supersedes` / `supersededBy` / `requires` / `related` / `conflictsWith` entries into the arrows (edges) drawn in the graph. It does NOT own the rest of that block — `version`, `stability`, `tags`, `description`, `title` live on the node bundle itself (parsed by the kernel directly from the `.sm` sidecar) and keep rendering regardless of which extractors are loaded.

  Disabling the extractor produced an asymmetric, confusing state: the graph edges would vanish but the inspector / card kept showing the rest of the sidecar metadata. The split is intentional at the kernel layer (sidecar = node data; extractor = link projection), but the toggle exposed it as a foot-gun.

  The lock plugs that gap. `core/annotations` joins `core/markdown` in `src/kernel/config/locked-plugins.ts`, so all three enforcement layers reject the toggle automatically:

  - **CLI** — `sm plugins disable core/annotations` exits 5 with the directed "host-locked" message; `--all` quietly skips it.
  - **BFF** — `PATCH /api/plugins/core/extensions/annotations` returns 403 `locked`.
  - **Runtime resolver** — `plugin-resolver.ts` ignores any persisted `config_plugins` row or `settings.json` entry against the id and returns the installed default (`true`). Defense in depth so the lock holds even against hand-edited state.

  To unlock (e.g. when a third-party ships a competing supersession extractor), edit `LOCKED_PLUGIN_IDS` directly — there is no per-environment override and no DB / settings.json escape hatch by design.

  ## User-facing

  `core/annotations` is now host-locked. Settings → Plugins shows its toggle disabled with a "Locked" pill, alongside `core/markdown`. Removes the foot-gun where disabling it dropped graph edges but kept the sidecar metadata visible.

- fe13254: Tighten the manifest `icon` grammar on `viewContributions[].icon` from "single emoji-or-PrimeIcons-bare-name" to a prefix-discriminated string with four explicit shapes. Greenfield migration: no compat shim, no `catalogCompat` bump, bare names now fail at manifest load.

  **Spec (`@skill-map/spec`) — `view-slots.schema.json#/$defs/IconString`**

  The `IconString` `$def` gains a `pattern` enforcing the new grammar and an updated `description`:

  ```
  ^(?:pi pi-[a-z0-9-]+|pi-[a-z0-9-]+|fa-(?:solid|regular|brands) fa-[a-z0-9-]+|fa-[a-z0-9-]+|[^a-zA-Z].*)$
  ```

  Four valid shapes:

  1. **Emoji** — any value starting with a non-ASCII-letter codepoint (`'🔍'`, `'@'`) renders as text.
  2. **PrimeIcons** — `'pi-foo'` or `'pi pi-foo'` (both accepted) → `<i class="pi pi-foo">`.
  3. **FontAwesome explicit family** — `'fa-solid fa-foo'` / `'fa-regular fa-foo'` / `'fa-brands fa-foo'` → pass-through.
  4. **FontAwesome shorthand** — `'fa-foo'` → defaults to `<i class="fa-solid fa-foo">`.

  Bare class names without a `pi-` / `fa-` prefix (`'star-fill'`, `'search'`, `'arrow-down'`) are **rejected at manifest load with `invalid-manifest`**. Prose contract in `spec/view-slots.md` §Icon string and `spec/plugin-author-guide.md` (icon row of the field reference table + new "Icon string forms" subsection) updated to match. `spec/index.json` regenerated.

  **Greenfield path — no shim, no version flag**

  Per `AGENTS.md` `Greenfield = no schema versioning`: no released external plugin uses the bare-name shape (the built-ins are the only consumers and ship in the same repo), so we tighten the contract in place. No `catalogCompat` bump on the catalog, no migration step registered in `sm plugins upgrade`. The bare-name rejection is documented inline in `IconString.description`.

  **Kernel (`@skill-map/cli`) — built-in migration**

  Every built-in extractor / analyzer that declared a bare-name icon is rewritten to `pi-foo` so it passes the new pattern at load:

  - `src/built-in-plugins/extractors/stability/index.ts` — `bolt`/`ban` → `pi-bolt`/`pi-ban`
  - `src/built-in-plugins/extractors/tools-count/index.ts` — `wrench` → `pi-wrench`
  - `src/built-in-plugins/extractors/slash/index.ts` — `arrow-down` → `pi-arrow-down`
  - `src/built-in-plugins/extractors/at-directive/index.ts` — `arrow-down` → `pi-arrow-down`
  - `src/built-in-plugins/extractors/markdown-link/index.ts` — `arrow-down` → `pi-arrow-down`
  - `src/built-in-plugins/extractors/external-url-counter/index.ts` — `link` → `pi-link`
  - `src/built-in-plugins/analyzers/broken-ref/index.ts` — `times-circle` ×3 → `pi-times-circle` (manifest `alert` + `chip` + runtime payload)
  - `src/built-in-plugins/analyzers/unknown-field/index.ts` — `info-circle` ×3 → `pi-info-circle` (same shape)
  - `src/built-in-plugins/analyzers/annotation-stale/index.ts` — `clock` → `pi-clock`

  Sibling test assertions updated in lock-step (`stability.test.ts`, `tools-count.test.ts`, `broken-ref.test.ts`, `unknown-field.test.ts`, `annotation-stale.test.ts`).

  **UI — resolver + rename**

  The shared icon component is renamed and the inline resolver pulled out into a pure function:

  - `ui/src/app/slots/icon-glyph.ts` → DELETED.
  - `ui/src/app/slots/icon.ts` — new file: exports `resolveIcon(raw: string | undefined): TResolvedIcon | null` (pure, no Angular deps) and the `Icon` component (`selector: 'sm-icon'`). The resolver routes on the same prefix grammar the AJV pattern enforces (emoji / `pi-foo` / `pi pi-foo` / `fa-{family} fa-foo` / `fa-foo`); unknown shapes return `null`, which renders nothing and emits a `console.warn` naming the offending value (covers runtime corruption from a legacy persisted row or a hand-edited sidecar that bypassed the load-time AJV gate). Template emits `<span>` for emoji and `<i class="<resolved cls>">` for `pi` / `fa`; the same 1px `transform: translateY` nudge from the previous `IconGlyph` survives unchanged.
  - `ui/src/app/slots/icon.spec.ts` — new spec, 21 vitest tests over the branch matrix: empty / nullish input, emoji (single + ZWJ + ASCII punctuation), PrimeIcons shorthand + full class, FontAwesome explicit family (solid / regular / brands), FontAwesome shorthand, and rejected inputs (bare names, family-only, missing space, uppercase prefix, trim semantics). Pure function tested directly — no TestBed, because the existing TestBed setup is broken upstream of this work.
  - `ui/src/app/renderers/{node-counter,node-icon,node-alert,scope-stat}/*.ts` — import + selector update: `IconGlyph` → `Icon`, `<sm-icon-glyph>` → `<sm-icon>`. No template logic changed.

  **Why one commit**

  The spec, built-ins, and UI changes form one contract change. Splitting puts the spec ahead of the built-ins (AJV would reject every built-in manifest at load) or the UI ahead of the spec (UI would resolve shapes the spec hasn't sanctioned yet). Single commit keeps the tree green at every hash.

  **Verification**

  - `npm test` in `src/` → 1333/1333 pass (every built-in test asserts the new `pi-foo` shape).
  - `npx vitest run src/app/slots/icon.spec.ts` in `ui/` → 21/21 pass.
  - `npx tsc --noEmit -p tsconfig.app.json` in `ui/` → exit 0 (renamed selector + import wired through every renderer).
  - `npm run validate --workspace=@skill-map/spec` → spec OK, integrity OK.

  ## User-facing

  **Plugin manifest icons are now prefix-discriminated.** Use `pi-foo` (PrimeIcons), `fa-solid fa-foo` / `fa-regular fa-foo` / `fa-brands fa-foo` (FontAwesome), `fa-foo` shorthand (defaults to solid), or any emoji. Bare names like `"search"` are rejected at load.

- 4f89a84: Plugin toggles in the Settings modal now apply at the next scan instead of needing an `sm serve` restart. The "Restart required" banner is gone for the common case; only plugins that were disabled at server boot keep a per-row warning because their handlers were never loaded into memory.

  **Two issues addressed:**

  1. **Latent bug — `POST /api/scan` ignored mid-session toggles.** `runScanForCommand` reused the BFF's boot-cached `pluginRuntime.resolveEnabled`. A user who disabled a plugin and pressed the topbar refresh saw the plugin's contributions reappear. The watcher had the same problem on every chokidar batch (it loads its own bundle once at boot).
  2. **No way to cancel.** Each toggle wrote to `config_plugins` immediately and purged `scan_contributions`. Five quick toggles meant five DB round-trips and five purges even if the net state was unchanged.

  **Approach** — four layered changes:

  - **Fresh resolver per scan.** `composeScanExtensions` / `composeFormatters` / `registerEnabledExtensions` now accept an optional `resolveEnabled` override. The BFF's `POST /api/scan` and the watcher's per-batch loop build a fresh resolver from `config_plugins` via the shared `core/runtime/fresh-resolver.ts` helper before composing extensions, so a toggle made mid-session is honoured on the next scan without restarting the server. Plugin user extensions are now filtered by the same resolver (previously only built-ins were filtered) so disabling a previously-enabled drop-in plugin actually silences it.
  - **Boot-time registries cover every built-in.** `kindRegistry` and `contributionsRegistry` (the catalogs embedded in every payload-bearing envelope) used to be seeded from the boot-time `composeScanExtensions(...)` result, which excluded any built-in that started disabled. Re-enabling such a built-in mid-session left its kinds / footer icons unrenderable because the UI's lookup tables never knew about them. Both registries now seed unconditionally from every built-in declaration (their module code is always in memory via `built-in-bundles.ts`); the enabled / disabled axis stays enforced at scan-time by the fresh resolver. Drop-in user plugins still respect boot-time filtering at the registry level — their modules weren't imported and aren't reachable mid-session (the `startsAsDisabled` exception below).
  - **Bulk endpoint `PATCH /api/plugins`.** Body `{ "changes": [{ id, enabled }, ...] }`. Validates the entire batch up-front (404 / 400 / 403 with `error.details.id` pointing at the offending entry); applies in one SQLite transaction with one grouped contributions purge. The per-id `PATCH /api/plugins/:id` and qualified-id sibling stay available for CLI / external automation.
  - **Buffered Settings modal.** Toggles mutate an in-memory `pendingState` only; rows show a dirty dot, a "N unsaved changes" banner appears above the list, and the footer exposes `[Discard] [Apply]` plus an italic warning when the dirty set re-enables a `startsAsDisabled` plugin. Closing the modal with pending edits opens a confirm dialog (`Discard` / `Keep editing` / `Apply`). Apply ships the bulk PATCH and triggers a scan via the new shared `ScanTriggerService`. A successful apply emits the panel's `applied` output, which the modal host translates into `visibleChange(false)` so the dialog closes once the work is done; a failed apply keeps the modal open with the error visible.

  **`startsAsDisabled` wire flag.** `GET /api/plugins` rows now carry `startsAsDisabled?: boolean` for drop-in plugins whose discovery-time `status === 'disabled'`. The SPA renders a per-row hint when the user re-enables such a row, since those plugins' handlers were never loaded into memory at boot and re-engaging needs an `sm serve` restart. Built-ins always omit the flag (their handlers are statically known).

  **Spec changes** (`@skill-map/spec` minor):

  - `spec/cli-contract.md` § `GET /api/plugins` — adds `startsAsDisabled?: boolean` to the item shape.
  - `spec/cli-contract.md` § `PATCH /api/plugins/:id` and the qualified-id sibling — "Restart required" is gone; replaced by an "Apply window" sentence documenting the per-scan-fresh-resolver behaviour and the `startsAsDisabled` exception.
  - `spec/cli-contract.md` § Endpoints — new `PATCH /api/plugins` row documenting the bulk endpoint (body, error mapping, transactional semantics).
  - `spec/cli-contract.md` § Error code sources — `not-found` / `bad-query` / `locked` rows updated to mention the bulk endpoint's `error.details.id` payload.
  - `spec/cli-contract.md` § `kindRegistry` envelope field — clarifies that built-in Providers are listed unconditionally regardless of boot-time enabled state, and adds a parallel `contributionsRegistry` envelope-field section with the same discipline.

  **Implementation** (`@skill-map/cli` minor):

  - `src/core/runtime/fresh-resolver.ts` — **NEW**. Shared `buildFreshResolver` + `composeResolver` helpers used by `routes/plugins.ts`, `routes/scan.ts`, and `core/watcher/runtime.ts`.
  - `src/core/runtime/plugin-runtime.ts` — `composeScanExtensions`, `composeFormatters`, `registerEnabledExtensions` accept `resolveEnabled?`; user-plugin extensions, manifests, annotation contributions, and view contributions are filtered by the resolver.
  - `src/core/runtime/scan-runner.ts` — `IScanRunOpts.resolveEnabledOverride?` threaded into the compose call.
  - `src/server/routes/scan.ts` — builds the fresh resolver per `POST` / `?fresh=1`.
  - `src/server/routes/plugins.ts` — new `PATCH /api/plugins` bulk handler with `validateBulkChange` + `persistBulkAndProject`; `IPluginListItem` gains `startsAsDisabled`; `applyChangeToAdapter` shared between single-id and bulk paths.
  - `src/server/index.ts` — `assembleBootBundle` seeds the `kindRegistry` from every built-in Provider (new `collectBuiltInProviders` helper) and `mergeBuiltInViewContributions` now walks `builtInBundles` directly instead of the composed scan extension set, so both registries cover the full built-in surface regardless of boot-time enabled state.
  - `src/core/watcher/runtime.ts` — fresh resolver built per chokidar batch.
  - `ui/src/app/services/scan-trigger.ts` — **NEW**. Owns the manual-scan trigger (in-flight signal, `dataSource.runScan()` + `loader.load()`). Consumed by `App` and `SettingsPlugins`.
  - `ui/src/services/data-source/{port,rest-data-source,static-data-source}.ts` — new `applyPluginChanges(changes)` method.
  - `ui/src/app/components/settings-modal/settings-plugins.ts/.html/.css` — buffered state (`originalState` / `pendingState`), dirty markers, `[Discard] [Apply]` footer, per-row + footer italic `startsAsDisabled` hints, removal of the persistent "Restart required" banner, `applied` output for parent-driven close. Two-zone layout (`.settings-plugins__scroll` + footer outside the scroll container) so the footer doesn't expose scroll-through gaps.
  - `ui/src/app/components/settings-modal/settings-modal.ts/.html` — intercepts dialog close; opens `<p-confirmDialog>` with three actions when pending edits exist; bridges the panel's `applied` event to `visibleChange(false)` so footer Apply also closes.

  **Tests**:

  - `src/test/server-endpoints.test.ts` — new bulk PATCH suite (happy path, partial-failure, lock, body shape errors, `db-missing`) + a regression test asserting that `POST /api/scan` no longer re-populates a freshly-disabled plugin's contributions.

  ## User-facing

  Plugin toggles in Settings now stage edits in the modal — click Apply (or confirm at close) to commit and refresh the graph; X discards. Changes apply on the next scan, no `sm serve` restart needed (except plugins disabled at boot, marked per-row).

- b840302: Rename the view slot `card.footer.left.counter` to `card.footer.left`.

  After the `card.footer.left.tag` sub-slot was dropped (see prior CHANGELOGs), the counter became the only shape on the left footer of the card. The `.counter` suffix was a leftover of the dual-shape sub-slot scheme — the slot is now symmetrical with `card.footer.right` and consistent with the bare-base names used for `card.title.right` and `card.subtitle.left`.

  **Wire format (breaking)**

  - The `SlotName` enum in `spec/schemas/view-slots.schema.json` lists `card.footer.left` instead of `card.footer.left.counter`. The `$defs.payloads` map and the `IViewContribution.allOf` icon-required guard are updated to match.
  - Plugin manifests that declare `viewContributions[*].slot: 'card.footer.left.counter'` need to update the literal to `'card.footer.left'`. Greenfield rename: no compatibility shim, no `catalogCompat` bump (no released external plugin uses this slot).

  **Kernel + built-ins (breaking)**

  - TypeScript: `TSlotName` in `src/kernel/types/view-catalog.ts` and the `KNOWN_SLOTS` set in `src/kernel/adapters/schema-validators.ts` now use `'card.footer.left'`. The `unknown-slot` analyzer's catalog mirror is updated.
  - Built-in extractors: `at-directive`, `markdown-link`, and `slash` now declare `slot: 'card.footer.left'` in their `viewContributions.count` entry.
  - Scaffolder: the `VIEW_SLOTS_CATALOG` array and the `plugins create` stub default in `src/cli/commands/plugins.ts` emit `card.footer.left`. Help / tip text updated.

  **UI**

  - `ui/src/app/slots/slot-config.ts` — `TSlotId` and `SLOT_REGISTRY` rekeyed.
  - `ui/src/app/slots/slot-renderer-map.ts` — renderer mapping rekeyed.
  - `ui/src/app/components/node-card/node-card.html` — debug-slot data attribute and host slot literal renamed.
  - `ui/src/app/debug-slots.css` — debug-outline selector renamed.

  **Migration**

  User plugins (when any exist outside this repo) update the literal in their `plugin.json#/viewContributions[*]/slot` field. The doctor verb (`sm plugins doctor`) flags the old name as `unknown-slot` after upgrading.

  ## User-facing

  The view slot `card.footer.left.counter` was renamed to `card.footer.left` — symmetrical with `card.footer.right`. Plugin authors using the old literal in `plugin.json` need to update it; the scaffolder emits the new name automatically.

- 62ab63d: Promote sidecar-awareness into the kernel's per-(node, extractor) cache key so `.sm` edits propagate to the UI on every code path (watch, scan, CLI, BFF cold start) without busting unrelated cached extractors.

  **The bug**

  `scan_extractor_runs` was keyed only by `(node_path, extractor_id, body_hash_at_run)`. Extractors that read `ctx.node.sidecar.*` (`core/stability`, `core/annotations`) would silently reuse their prior contribution after a sidecar-only edit because neither `bodyHash` nor `frontmatterHash` changed when the user edited `<basename>.sm`. The previous PR (`13f84847`) patched the symptom inside `src/core/watcher/runtime.ts` by detecting `.sm` paths in a watcher batch and disabling the kernel cache wholesale for that pass — broad, brittle, and unreachable from other entry points (`sm scan`, `sm refresh`, the BFF's `POST /api/scan`).

  **The fix**

  - `scan_extractor_runs` gains a `sidecar_annotations_hash_at_run TEXT NOT NULL` column. Folded directly into `001_initial.sql` per the greenfield policy (no released consumer depends on the prior shape).
  - The orchestrator resolves the sidecar overlay BEFORE the cache decision, hashes the canonical-form (`yaml.dump({ sortKeys: true, lineWidth: -1, noRefs: true, noCompatMode: true })`) annotations block, and threads the value through `computeCacheDecision` + `IExtractorRunRecord` + persistence. Absent / empty annotations canonicalise to `{}` so the hash stays stable across "no sidecar" → "empty annotations".
  - `computeCacheDecision` now requires both `bodyHash` AND `sidecarAnnotationsHash` to match for a cache hit — universal invalidation on `.sm` changes. An opt-in `readsSidecar` flag was considered and rejected because forgetting it produces a silent stale-data bug; the cost of re-running an extractor on a sidecar edit is negligible (pure CPU, sidecars change rarely), and the gain is zero cognitive load for plugin authors.
  - The watcher workaround is reverted: `runtime.ts` no longer inspects batch paths for `.sm` suffixes and never disables the cache. The kernel does the right thing on every path now.

  **Files**

  - `src/migrations/001_initial.sql` — `scan_extractor_runs` gains `sidecar_annotations_hash_at_run TEXT NOT NULL` (folded inline; no separate migration file).
  - `src/kernel/adapters/sqlite/schema.ts` — adds `sidecarAnnotationsHashAtRun: string` to `IScanExtractorRunsTable`.
  - `src/kernel/adapters/sqlite/scan-load.ts` — exports `IPriorExtractorRun` (`{ bodyHash, sidecarAnnotationsHash }`); reshapes the load map's inner value.
  - `src/kernel/adapters/sqlite/scan-persistence.ts` — `extractorRunToRow` writes the new column.
  - `src/kernel/orchestrator.ts` — new `resolveSidecarOverlay` (split from the previous `resolveAndApplySidecar` so the overlay is computed BEFORE the cache decision); new `canonicalSidecarAnnotations` helper; `computeCacheDecision` consults the sidecar hash for every applicable extractor; `IExtractorRunRecord` carries `sidecarAnnotationsHashAtRun`; the walk loop attaches the resolved overlay onto each node via `attachSidecar` (used by both the full-cache-hit and the partial / fresh paths).
  - `src/kernel/ports/storage.ts` — `loadExtractorRuns` return type updated to `Map<string, Map<string, IPriorExtractorRun>>`.
  - `src/core/runtime/scan-runner.ts` — type plumbing for the new prior-runs Map shape.
  - `src/core/watcher/runtime.ts` — drops the `invalidateCache` parameter on `runOnePass` / `handleBatch` and the `.sm`-suffix probe on the primary watcher's batch.
  - `src/test/sidecar-aware-cache.test.ts` — new file. Two integration tests: (A) a sidecar edit invalidates the per-extractor cache so registered probes re-run on the next pass; (B) end-to-end with the real `core/stability` extractor — flipping `annotations.stability` from `experimental` to `deprecated` produces the new contribution (the watcher-bug scenario, now fixed kernel-side).
  - `src/test/scan-extractor-runs.test.ts` — round-trip test updated to assert both `bodyHash` AND `sidecarAnnotationsHash` survive the load.
  - `spec/db-schema.md` — documents the new column under `scan_extractor_runs`.

  **Greenfield analyzer**

  Pre-1.0 greenfield: the new column is folded directly into `001_initial.sql` rather than shipping as a separate migration file (no released consumer depends on the prior schema). The wire shapes (`Node`, `ScanResult`, plugin manifest) are unchanged. No `spec/versioning.md` bump.

  ## User-facing

  Sidecar edits now propagate to the UI reliably — flipping `stability: experimental` to `deprecated` in a `.sm` updates the card chip on every code path (`sm scan`, `sm watch`, the live UI), not only the watcher heuristic that shipped in `0.21.0`.

- 13f8484: Fix two bugs around sidecar-driven UI updates and adopt Font Awesome Free in the bundled UI as a webfont addition (no spec changes, no plugin-author surface yet).

  **Watcher invalidates extractor cache on `.sm` sidecar edits (`src/core/watcher/runtime.ts`)**

  The kernel's per-extractor cache (`scan_extractor_runs`) is keyed by `bodyHash` + `frontmatterHash` of the `.md` file. Extractors that read `node.sidecar.annotations` (today: `core/stability`, `core/annotations`, `core/annotation-stale`) would silently re-use the previous contribution on a sidecar-only edit — the chip never refreshed in the UI until the underlying `.md` was touched. Fix: the primary watcher's `onBatch` now inspects `batch.paths`; if any path ends in `.sm`, it forwards `invalidateCache: true` to `runOnePass`, which sets `enableCache: false` and omits `priorExtractorRuns`. End-to-end verified: editing a sidecar's `stability:` value re-renders the corresponding card chip in ~5–6 s. This is a localized workaround; the structural fix (extending `scan_extractor_runs` with `sidecar_hash_at_run`, or surfacing an `IExtractor.readsSidecar?: boolean` declarative flag) is tracked separately.

  **Icon-only counter chips are now visible (`ui/src/app/renderers/node-counter/node-counter.ts`)**

  `NodeCounter` renders `card.footer.right` chips with `value: 0` as icon-only (the pattern adopted by `core/stability` experimental / deprecated and `core/annotation-stale`). The icon's `font-size: 0.6rem` is sized to sit next to a number — standalone, the glyph rendered as a sub-6×6 px dot, effectively invisible. Added a `vc-counter--icon-only` modifier (active when `value() === 0`) that bumps the standalone icon to `0.8rem` (~7.7×7.6 px of glyph). Numbered chips (warn / error counts, outgoing-ref counters) stay at `0.6rem` because the digit is the visual anchor.

  **Font Awesome Free 7.2.0 wired into the UI bundle (additive, webfont mode)**

  - `ui/package.json`: `@fortawesome/fontawesome-free` pinned at `7.2.0` (no caret).
  - `ui/angular.json`: `all.min.css` inserted between `primeicons.css` and `src/styles.css` in both `production` and `analyze` configurations so PrimeIcons keeps its existing `pi pi-*` classes and FA layers `fa-solid fa-*` on top. Initial budget warning raised `600 kB → 700 kB` to absorb the ~48 kB raw / ~6 kB gzip CSS delta; `maximumError: 750 kB` left untouched. Build is warning-free.
  - `ui/src/app/app.html`: one smoke-test migration — the Settings button moved from `icon="pi pi-cog"` to `icon="fa-solid fa-gear"`. This proves the webfont loads and is wired into PrimeNG's `<p-button [icon]>` slot. No other migrations in this change.

  No spec changes (the `IconString` grammar and `Provider.ui.icon` field are untouched — plugin authors still emit PrimeIcons / emoji only). FA is currently a private affordance for app chrome; broadening it to plugin manifests is a separate spec decision.

  ## User-facing

  Sidecar (`.sm`) edits now propagate to the UI in real time — change a `stability:` value and the card chip refreshes on the next watcher tick. Icon-only chips (experimental / deprecated / stale-sidecar) on the card footer are now legible (they were rendering as sub-pixel dots).

- a96c257: Add a per-project consent gate for `.sm` sidecar writes, generalise the "privacy-sensitive, must not be committed" idea to a closed set of project-local-only keys, and cache config on the daemon so repeated reads in `sm serve` no longer re-walk six file layers.

  **Per-key locality — new `PROJECT_LOCAL_ONLY_KEYS` set**

  Four config keys are now classified as **project-local only**: `allowEditSmFiles` (new), `scan.includeHome`, `scan.extraRoots`, `scan.referencePaths`. Valid layers for these values are `defaults`, `user`, `user-local`, `project-local`, `override`. **The committed `project` layer (`<cwd>/.skill-map/settings.json`) is forbidden** — values found there are stripped (with a warning) at load time. `writeConfigValue(...)` with `target: 'project'` for any of the four throws `ProjectLocalOnlyKeyError`.

  Sister concept to the existing `USER_ONLY_KEYS` (still scoped to `updateCheck.enabled`):

  | Set                       | Valid layers                                                  | Forbidden layer(s)         |
  | ------------------------- | ------------------------------------------------------------- | -------------------------- |
  | `USER_ONLY_KEYS`          | `defaults`, `user`, `user-local`, `override`                  | `project`, `project-local` |
  | `PROJECT_LOCAL_ONLY_KEYS` | `defaults`, `user`, `user-local`, `project-local`, `override` | `project`                  |

  Enforcement lives in `src/kernel/config/loader.ts` (loader-side strip + warning) and `src/core/config/helper.ts` (writer-side reject). The schema stays additive — older installs that wrote one of these keys to `settings.json` keep validating; the value is silently dropped at read time and the warning surfaces via `sm config show --source`.

  **Sidecar write consent (`allowEditSmFiles`)**

  Every `.sm` write — scaffold (`sm sidecar annotate`), hash-only refresh (`sm sidecar refresh`), bump (`sm bump`, `POST /api/sidecar/bump`) — now flows through `FilesystemSidecarStore.applyPatch`, the **single chokepoint** for sidecar writes. `applyPatch` consults `allowEditSmFiles` (default `false`) via `ensureSidecarWritesAllowed` before touching disk:

  - `true` → write proceeds.
  - `false` AND caller passes `confirm: true` (CLI `--yes` / BFF `{ "confirm": true }` body) → kernel persists `allowEditSmFiles: true` to `.skill-map/settings.local.json` and performs the write.
  - `false` AND no confirm → `EConsentRequiredError`. CLI on TTY prompts via the existing `confirm()` util; CLI without TTY exits 2 with a hint; BFF returns 412 `confirm-required` with `details: { key: 'allowEditSmFiles' }` so the UI can open a `ConfirmationService` dialog.

  Decline never persists — the next attempt re-asks. The flag lives in `project-local` (gitignored) so each collaborator consents independently.

  `sm sidecar annotate` was the one writer that bypassed the store (direct `writeFileSync`); it's now refactored to route through `FilesystemSidecarStore.applyPatch` so the gate is impossible to bypass. The "exists + !force" UX check stays at the command level (preserves the legacy refusal semantics).

  **Daemon config cache (`ConfigService`)**

  New `src/core/config/service.ts` exposes a lazy, reloadable wrapper around `loadConfig()`. The Hono server instantiates one at boot and threads it through `IRouteDeps`; routes consume `deps.configService.get()` / `.effective()` instead of calling `loadConfig` per request. Mutating routes (`PATCH /api/project-preferences`, future config writers) call `.reload()` after a successful write so the next read sees the new state.

  The watcher already had its own per-batch reload pattern (`core/watcher/runtime.ts:320-326`); the daemon now shares the same principle via a single service. CLI verbs remain stateless (short-lived process; caching adds no value).

  **`project-preferences` route persistence target switched to `project-local`**

  With `scan.includeHome` / `scan.extraRoots` / `scan.referencePaths` joining `PROJECT_LOCAL_ONLY_KEYS`, the PATCH route now writes to `target: 'project-local'` (`<cwd>/.skill-map/settings.local.json`). The existing 412 `confirm-required` privacy gate (for writes that EXPAND the disk-access surface) is unchanged.

  **New spec sections**

  - `architecture.md` §IO discipline — plugins (Provider / Extractor / Analyzer / Action / Formatter / Hook) are pure: they consume context and emit data via returns or `ctx.*` callbacks. They MUST NOT write to the filesystem. All materialisation flows through kernel Ports. The consent gate at the kernel boundary is sufficient precisely because no extension has the means to write.
  - `architecture.md` §Config layering — explicit table of the six layers + the two locality sets (`USER_ONLY_KEYS`, `PROJECT_LOCAL_ONLY_KEYS`) with members and enforcement semantics.
  - `architecture.md` §Annotation system · Write consent — the consent flow normatively documented.
  - `cli-contract.md` §`.sm` write consent — describes the CLI / BFF surfaces; `cli-contract.md` §Project-local-only config — describes `sm config set` behaviour for the four keys.
  - `schemas/project-config.schema.json` — new `allowEditSmFiles` boolean (default `false`); the three privacy-sensitive scan keys' descriptions updated to flag PROJECT_LOCAL_ONLY membership and stripping behaviour.

  **Tests**

  - New: `src/test/sidecar-consent.test.ts`, `src/test/config-service.test.ts`, `ui/src/services/sidecar.spec.ts` (3 new cases), `ui/src/app/views/inspector-view/inspector-view.spec.ts` (4 new cases).
  - Extended: `src/test/config-loader.test.ts` (locality stripping), `src/test/config-helper.test.ts` (PROJECT_LOCAL_ONLY guards), `src/test/sidecar-store.test.ts` (consent gate), `src/test/bump-action.test.ts`, `src/test/bump-cli.test.ts`, `src/test/sidecar-cli.test.ts`, `src/test/server-sidecar-endpoint.test.ts`, `src/test/project-preferences-route.test.ts`.
  - `npm test` (src) — 1302 / 1302 green. `npm test -w ui` — 320 pass (3 pre-existing failures in `node-card.spec.ts` from a prior commit, unrelated).

  ## User-facing

  Skill-map asks before creating `.sm` sidecars. Pass `--yes` (CLI) or accept the dialog (UI); your consent saves to `.skill-map/settings.local.json` (gitignored). Privacy scan paths (`scan.includeHome`, etc.) no longer load from committed `settings.json`.

- b676fdb: Migrate the experimental / deprecated stability indicators on graph cards from hardcoded template markup into a new built-in extractor `core/stability` that emits chips to the `card.footer.right` slot. Remove the dead-code injection icon that shared the same wrapper.

  **New built-in: `core/stability` (extractor, frontmatter-scope)**

  - `src/built-in-plugins/extractors/stability/index.ts` — reads `sidecar.annotations.stability` first, falls back to legacy frontmatter `metadata.stability` (mirror of the UI's `effectiveStability` source order in `ui/src/models/node-derived.ts`).
  - Declares two `viewContributions` against `card.footer.right`: `experimental` (icon `bolt`, label `experimental`, info-tone tooltip "Experimental — API may change") and `deprecated` (icon `ban`, label `deprecated`, warn severity, tooltip "Deprecated — avoid in new code"). Both `emitWhenEmpty: false`.
  - Payload uses `value: 0` so the existing `NodeCounter` renderer paints them icon-only — same pattern `core/annotation-stale` introduced for the clock chip in commit `c43e499`.
  - Registered in `src/built-in-plugins/built-ins.ts` between `slash` and `tools-count` (alphabetical within the `core` bundle). Built-in count assertions in `src/test/built-ins-modes.test.ts` (`25 → 26`) and `src/test/plugin-runtime-branches.test.ts` (`6 → 7`) updated.
  - Spec catalog: `spec/architecture.md` enumerates the cross-vendor extractors — `stability` appended.

  **Node card cleanup**

  - `ui/src/app/components/node-card/node-card.html`: drop the `@if (stability() === 'experimental' || ... || hasInjection())` block, the `.sm-gnode__footer-end` wrapper, the inline experimental flask SVG, the `pi-ban` deprecated chip, and the inline shield-injection SVG. The `.sm-gnode__footer-right-cluster` now wraps the `card.footer.right` slot host alone. Stability chips render through the new extractor; `[class.sm-gnode--deprecated]` host binding still reads `effectiveStability(node)` directly so the deprecated card-fade survives.
  - `ui/src/app/components/node-card/node-card.ts`: remove `hasInjection` / `injectionType` computeds and the `[class.sm-gnode--danger]` host binding (only consumer was the removed branch). The `stability` computed and the `effectiveStability` import stay — both still feed the deprecated host binding.
  - `ui/src/app/components/node-card/node-card.css`: drop `.sm-gnode--danger`, `.sm-gnode__footer-end`, `.sm-gnode__stat--danger`, and the `<svg>`-specific rules (`.sm-gnode__stat svg { width: 1em; height: 1em }` and the `i, svg` font-size combo) — nothing in the card emits inline SVG anymore. Comment on `.sm-gnode__footer-right-cluster` rewritten for the slot-only layout.
  - `ui/src/i18n/node-card.texts.ts`: drop `safety.injection(...)` (no consumer); `texts.stability.experimental` / `texts.stability.deprecated` stay because the inspector header (`inspector-view.html:74, 87`) still references them.

  **Injection branch removed (was dead code)**

  The injection icon was driven by `summary.safety.injectionDetected`, hardcoded to `false` in the stub summarizer at `ui/src/app/views/graph-view/graph-layout.ts:410` with an explicit "until the real Step 9+ summarizer lands" comment. The branch never rendered in this version; migrating it would have moved dead code from template to plugin. A real safety plugin can be built against `card.footer.right` (or `graph.node.alert`) once the Step 9+ summarizer is wired up with actual injection data.

  **Test cleanup**

  `ui/src/app/components/node-card/node-card.spec.ts`: drop the `describe('NodeCard — sidecar stale badge (Step 9.6.5)')` block. The stale badge moved to the slot system in commit `08c33b8` (`core/annotation-stale` emits an icon-only chip to `card.footer.right`); the spec was left behind asserting on hardcoded markup that no longer exists. Three positive tests were failing, three negative tests passed trivially against the missing element. Chip rendering is covered at the kernel layer (`src/built-in-plugins/analyzers/annotation-stale/annotation-stale.test.ts`).

  **Renderer behaviour unchanged**

  `NodeCounter` already supports icon-only chips through its `value > 0` guard — no template or style change to the renderer was needed. The `IconGlyph` resolver continues to accept emoji + PrimeIcons names only; no custom-SVG branch was introduced.

  ## User-facing

  The experimental / deprecated indicators on graph cards now come from a built-in plugin (`core/stability`) you can disable. The injection indicator was removed — it never fired and will return when the safety summarizer ships.

### Patch Changes

- 5ed14cb: Disabling a plugin now wipes its `scan_contributions` rows immediately, instead of waiting for the next `sm scan` to sweep them. Without the eager purge, the catalog sweep documented in `db-schema.md` § scan_contributions only ran on the next scan, so the UI kept rendering the plugin's footer / card chips even though the toggle showed `enabled: false`.

  Both toggle paths converge on the same purge:

  - CLI — `sm plugins disable <id>` and `sm plugins disable --all` (`TogglePluginsBase.toggle` in `src/cli/commands/plugins.ts`).
  - BFF — `PATCH /api/plugins/:id` and `PATCH /api/plugins/:bundleId/extensions/:extensionId` (the UI's Settings → Plugins toggle).

  Each call to `pluginConfig.set(id, false)` is followed by `adapter.contributions.purgeByPlugin(pluginId, extensionId?)`. `extensionId` is omitted for bundle-granularity ids (`claude`) and supplied for qualified ids (`core/slash`), mirroring how the catalog sweep groups rows. Re-enabling does NOT restore the rows — the next scan re-emits them, same as a cold start.

  Plugin-managed state (`state_plugin_kvs`, dedicated `plugin_<id>_*` tables) is **not** touched. The asymmetry is intentional: contributions are scan-derived (cheap to recompute, must reflect the live catalog), KV / dedicated-table state is plugin-managed and must survive toggle cycles. See `spec/plugin-kv-api.md` and `spec/db-schema.md` for the contract.

  **Spec changes** (`@skill-map/spec` minor — new method on `StoragePort.contributions`):

  - `spec/architecture.md` § View contribution system → Persistence — catalog sweep now narrowed to "uninstalled-on-disk plugins, removed contributions"; eager-purge-on-disable documented as the primary path for disabled bundles.
  - `spec/db-schema.md` § `scan_contributions` — same narrowing; new "Eager purge on disable" subsection describing `purgeByPlugin(pluginId, extensionId?)`.
  - `spec/cli-contract.md` § Plugins — `sm plugins disable` row mentions the immediate purge.
  - `spec/plugin-author-guide.md` § Plugin states — `disabled` row mentions the immediate purge.
  - `spec/plugin-kv-api.md` § Backup and retention — clarifies the asymmetry between `scan_contributions` (purged) and KV / dedicated tables (preserved).

  **Implementation** (`@skill-map/cli` patch):

  - `src/kernel/adapters/sqlite/contributions.ts` — `purgeContributionsByPlugin(db, pluginId, extensionId?)` now optionally narrows by extension.
  - `src/kernel/ports/storage.ts` — `StoragePort.contributions.purgeByPlugin(pluginId, extensionId?)` added to the contract.
  - `src/kernel/adapters/sqlite/storage-adapter.ts` — wires the namespace method to the helper.
  - `src/cli/commands/plugins.ts` — toggle base class calls the purge when `enabled === false`.
  - `src/server/routes/plugins.ts` — `persistAndProject` calls the purge when `enabled === false`.
  - `ui/src/app/components/settings-modal/settings-plugins.ts` — after a successful UI toggle, calls `CollectionLoaderService.load()` so the cached in-memory `node.contributions[]` is refreshed against the just-purged DB and the card chips disappear without the user pressing Refresh. The loader's existing `pendingRefresh` collapsing semantics handle back-to-back toggles cheaply.

  **Tests**:

  - `src/test/view-contributions.test.ts` — new unit test asserting `purgeByPlugin` narrows by `extensionId` when supplied.
  - `src/test/plugins-cli.test.ts` — new end-to-end test asserting `sm plugins disable <id>` drops the plugin's `scan_contributions` rows while leaving unrelated plugin rows untouched.
  - `ui/src/app/components/settings-modal/settings-plugins.spec.ts` — new test asserting the toggle handler calls `CollectionLoaderService.load()` so the card chips reflect the BFF purge. (The pre-existing `settings-plugins.spec.ts` suite is currently broken on `main` for unrelated reasons — `verifySemanticsOfNgModuleDef` Angular DI failure across 24 UI test files — but the new test is correctly written and will activate once that suite is fixed.)

  ## User-facing

  Disabling a plugin now removes its card chips from the UI immediately. Previously the chips lingered until the next `sm scan`, making the toggle look broken.

- b840302: Unify footer-chip icons across the three outgoing-reference extractors and remove three legacy hardcoded chips from the card now that the per-extension view contributions cover them.

  **Footer icons unified (built-in extractors)**

  - `core/external-url-counter` (`card.footer.right`): icon `🔗` (emoji) → `'link'` (PrimeIcons `pi-link`), matching the legacy hardcoded `pi-link` chip it now replaces in the card footer.
  - `core/at-directive`, `core/markdown-link`, `core/slash` (all `card.footer.left`): icons `'@'` / `'📎'` / `'/'` → `'arrow-down'` (PrimeIcons `pi-arrow-down`). All three are outgoing references from the node; the shared glyph clusters the left-footer visually as a single "out-counts" cluster. The manifest `label` (`mentions` / `links` / `commands`) still distinguishes them at the tooltip / a11y layer.

  **Renderer plumbing fixes**

  - `ui/src/app/slots/icon-glyph.ts`: `<i>` and `<span>` are forced to `font-size: inherit; line-height: inherit` so the wrapper's font-size reaches the glyph regardless of branch. The `<i>` branch also gets `transform: translateY(1px)` to compensate PrimeIcons' asymmetric metrics — mirrors the legacy `.sm-gnode__stat i` rule the renderer used to inherit before the slot model.
  - `ui/src/app/renderers/node-counter/node-counter.ts`: wraps `<sm-icon-glyph>` in a `<span class="vc-counter__icon">` so the font-size rule lives in NodeCounter's own template and reaches the icon via inheritance, not via cross-component encapsulation boundaries.
  - `ui/src/app/components/view-contributions-host/view-contributions-host.ts`: gap `0.25rem` → `0.7rem`, consistent with `.sm-gnode__footer { gap: 0.7rem }` so the new chip cluster sits at the same rhythm as the legacy footer.

  **Legacy chips removed from `node-card`**

  `node-card.html` / `.ts` / `.spec.ts` / `i18n/node-card.texts.ts` drop three hardcoded chips:

  - `linksIn` chip (`pi-arrow-down`) — was driven by the (currently paused) `core/link-counts` analyzer; will return through the view-contribution slot when the analyzer is reactivated.
  - `linksOut` chip (`pi-arrow-up`) — same story; the new per-extractor counters (`at-directive`, `markdown-link`, `slash`) already cover outgoing references via plugin-emitted chips.
  - `externalRefsCount` chip (`pi-link`) — fully replaced by `core/external-url-counter` rendering in `card.footer.right`, with the unified `pi-link` glyph above.

  Three spec tests dropped; 318 → 315 UI tests, all green.

  **Debug-slot visualizer (dev only)**

  `ui/src/app/debug-slots.css` now draws a per-contribution outline (color rotates via `:nth-child(4n+1..4)`) with a label tile above each chip showing the slot's `data-testid`. Uses `outline` (not `border`/`padding`/`margin`) so toggling debug does not shift layout. Only active when the URL has `?debug=slots`.

  **Graph-view defensive overrides**

  `ui/src/app/views/graph-view/graph-view.css` adds `--ff-connection-drag-handle-fill: transparent`, `--ff-connector-accent-color: transparent`, plus scoped `::ng-deep` rules to force `background`/`border-color`/`box-shadow: transparent` on `.f-node-output:not(.f-node)` / `.f-node-input:not(.f-node)` and `fill: transparent; stroke: transparent` on `.f-connection-drag-handle`. The visible "connector circle" at the source endpoint persisted despite token overrides; the wholesale rule kills it without breaking Foblex's internal geometry.

  ## User-facing

  The card footer is cleaner: the three outgoing counters (`@`-mentions, markdown links, `/`-commands) share a single `↓` arrow glyph on the left, and the URL counter keeps its link glyph on the right. Three legacy hardcoded chips (in / out links, external URLs) were removed.

- 1212f18: Rewrite the `description` field on every built-in plugin (extractors, analyzers, actions, formatters, hooks) in user-facing language. Removes internal jargon — slot ids, frontmatter key names, kernel-side concepts — in favour of explanations that match what the operator actually sees in Settings → Plugins and on the cards / graph.

  The `annotations` extractor's description now says outright what it does ("turns the supersedes / requires / related / conflictsWith / supersededBy entries into the arrows between nodes"), which was the original spark for the sweep: every operator who opened Settings → Plugins asked what `annotations` was for, because the previous description ("reads structured references from the sidecar `.sm` `annotations:` block") only made sense if you already knew the answer.

  No behaviour change.

  ## User-facing

  Built-in plugin descriptions in Settings → Plugins are rewritten in plain language: less internal jargon, clearer explanations of what each one does. The annotations extractor now says outright that it draws the arrows between nodes.

- 3b17043: Fix two `sm plugins` inconsistencies and align the tester tutorial with the verbs that actually exist at v0.20.0.

  **`sm plugins show` accepts qualified `<bundle>/<ext>` ids**

  Previously, only bare bundle ids (`core`, `claude`) and user-plugin ids resolved; passing a qualified extension id (e.g. `core/external-url-counter`) returned exit 5 / "Plugin not found", even though `sm plugins enable` and `sm plugins disable` accept the same shape. The verbs now agree on id resolution: a qualified id is validated (bundle exists, extension exists inside it) using the same directed error messages as the toggle verbs (`Qualified extension id references unknown bundle`, `Qualified extension id not found`), then the parent bundle's detail is rendered. `show` is informational, so the granularity-mismatch rejection that toggle applies is intentionally skipped — `sm plugins show claude/some-ext` still surfaces the `claude` bundle.

  **`sm plugins list` reflects per-extension disable state**

  For granularity=extension bundles (only the built-in `core` today), individually-disabled extensions were invisible in the list output: the row showed `core ✓ 21 ext` regardless of how many extensions had been turned off, and the only way to see per-extension state was `sm plugins show <bundle>` or `sm plugins doctor`. The list renderer now prefixes disabled extension names with the same `✕` glyph the row header uses (`✕ superseded`), inside the same dim names line under the bundle row. The bundle row glyph is unchanged (`core` itself stays `✓` because the bundle id is still enabled — only the extension flipped). User plugins (granularity=bundle) keep their existing rendering: the row glyph already tells the bundle-level story.

  **Tester tutorial — alignment with v0.20.0 verbs**

  The `sm-tutorial` skill (`.claude/skills/sm-tutorial/SKILL.md`, also shipped via `sm tutorial` as the bundled `dist/cli/tutorial/sm-tutorial.md`) promised behaviours that did not match the current CLI surface. Five corrections:

  - `kind: hook` and `kind: note` were promised for `.claude/hooks/demo-hook.md` and `notes/todo.md`. The Provider catalog at v0.20.0 emits `agent` / `command` / `skill` / `markdown` only; both files land as `markdown` (the catch-all). The fixture comments now state this explicitly and flag dedicated `hook` / `note` kinds as roadmap.
  - `sm graph --root <path>` does not exist (the verb has only `--format` and `--no-plugins`, and dumps the whole persisted graph). The line is removed from Step 6.
  - `sm export --format json --kind <kind>` does not exist (`export` takes a positional query and `--format`). The example is rewritten to use the actual query syntax: `sm export "kind=markdown" --format json` and `sm export "path=notes/**" --format json`. A short paragraph documents the query grammar (`kind=…`, `path=…`, `has=issues`, comma-OR within a key, AND across keys).
  - Step 5 explanation now states that `sm check` reads from the persisted `scan_issues` table without re-walking the filesystem, so the verb's output reflects whatever the last scan / watcher run captured.
  - Step 7 (broken-ref planting) ran `sm check` with the watcher already stopped (Step 4 ends with Ctrl+C), which made the verb print `✓ No issues` even after the file edit. An explicit `sm scan` now precedes `sm check` so the persisted snapshot picks up the bullet before the rule fires.

  ## User-facing

  `sm plugins show core/<ext>` now resolves like `enable`/`disable` do, and `sm plugins list` marks individually-disabled extensions with `✕`. The `sm tutorial` content is realigned with the v0.20.0 verbs (no more `sm graph --root` / `sm export --kind` / `kind: hook` claims).

- 0f621e9: `update available` banner now fires on the first invocation after a fresh install or a `npm i -g` upgrade. Previously the banner required two runs to surface: the first run loaded the empty / not-yet-populated cache row, skipped the banner, fetched the latest from npm, and persisted the cache; only the second run actually printed the message. Operators who installed and ran `sm` once a day effectively never saw the notification because the cache freshness window (24h) and the run cadence collided.

  **Root cause** — `runWithAdapter` in `src/cli/util/update-check-banner.ts` decided whether to print the banner BEFORE the registry fetch, using only the cached `latestVersion`. A null / equal-to-current cache short-circuited the banner block; the fresh `latest` value the fetch returned was persisted but never consulted by the current run.

  **Fix** — after a successful fetch, re-evaluate `isOutdated(VERSION, latest)` and emit the banner in the SAME run when the cache-side branch did not already fire and the 24h cooldown (`shownAt`) is clear. The persisted `shownAt` is updated accordingly so the 24h banner cadence still holds across subsequent runs. A guard (`didShowThisRun`) prevents double emission when both branches happen to point at the same outdated version.

  ## User-facing

  Update-available banner now appears on the very first `sm` run after installing or upgrading the CLI, instead of waiting until the second run. Once-per-day cadence after that is unchanged.

- Updated dependencies [f72dbfc]
- Updated dependencies [5ed14cb]
- Updated dependencies [fe13254]
- Updated dependencies [4f89a84]
- Updated dependencies [b840302]
- Updated dependencies [a96c257]
  - @skill-map/spec@0.21.0

## 0.20.1

### Patch Changes

- fd6926f: Surface the project path under the brand mark in the topbar.

  The topbar already rendered a small caption under `skill-map` showing the last segment of the scanned root (for example `local-scope` when scanning `fixtures/local-scope/`). When the scan root is `.` — the common case where the CLI runs from the project directory — the caption collapsed to an empty string and the row disappeared, hiding any indication of _which_ project the BFF is talking to.

  The shell now fetches `/api/health` on boot and uses its `cwd` (the absolute, tilde-anonymised project root) as the caption, falling back to `scan.roots[0]` for the demo bundle where `health.cwd` may not be meaningful. The caption shows the full path verbatim so testers and screenshot reviewers can identify the project at a glance.

  The topbar also adds a small `margin-top` between the wordmark and the caption so the two lines breathe.

  Internal: the "update available" chip in the topbar is now gated on Angular's `isDevMode()` — a developer running `npm run ui:dev` no longer sees a noisy hint pointing at the npm registry. Production builds (i.e. every published CLI release) are unaffected; `isDevMode()` is always `false` in the bundle that ships to users.

  ## User-facing

  The topbar now shows the full project path under the **skill-map** wordmark, so a screenshot or a quick glance at the UI is always self-identifying. Previously only the last folder segment was shown, and projects scanned from their own root saw no path at all.

## 0.20.0

### Minor Changes

- 5600a60: Move `updateCheck.enabled` to user scope and add a reusable typed config helper. Settings UI's General section now exposes the toggle.

  **Spec changes** (`@skill-map/spec`, patch):

  - `spec/schemas/project-config.schema.json` — `updateCheck` description gains a "user-scope only" note: this key SHOULD live in `~/.skill-map/settings.json`; the reference implementation forces user-scope reads via `core/config/helper:USER_ONLY_KEYS` and `sm config set` rejects writes to the project layer. Project-layer entries from older installs continue to validate but are silently ignored at read time. Schema itself stays additive (no breaking change).
  - `spec/index.json` regenerated.

  **Implementation changes** (`@skill-map/cli`, minor):

  - New `src/core/config/dot-path.ts` — promoted from `cli/commands/config.ts`. Exports `getAtPath` / `setAtPath` / `deleteAtPath` / `assertSafeSegments` / `enumerateConfigPaths` / `FORBIDDEN_SEGMENTS` / `ForbiddenSegmentError`. Same prototype-pollution guards as before.
  - New `src/core/config/atomic-write.ts` — promoted `writeJsonAtomic` + `readJsonObjectOrEmpty` so any settings-mutating code path shares one implementation (atomic temp-then-rename, no half-written files on crash).
  - New `src/core/config/helper.ts` — typed read / write surface composed over `loadConfig` + the promoted helpers + AJV revalidation:
    - `readConfigValue<T>(key, { scope, cwd, homedir, default?, strict? })`
    - `writeConfigValue(key, value, { target, cwd, homedir })` — AJV-revalidates the post-mutation file before atomic write
    - `removeConfigValue(key, opts)` — returns `boolean` indicating whether a write happened
    - `getValueSource(key, opts)` — wrap of `loadConfig().sources` for "who set this"
    - `USER_ONLY_KEYS` — a small set (today: `updateCheck.enabled`) the helper hard-pins to the user / global layer regardless of caller intent. Reads force `scope: 'global'`; writes throw `UserOnlyKeyError` on `target: 'project'`.
  - `src/cli/util/update-check-banner.ts` — `isUpdateCheckEnabled` now calls `readConfigValue<boolean>('updateCheck.enabled', { scope: 'global', ..., default: true })`. A project-layer override is silently ignored (the helper forces scope:'global' for the key); the previous "project wins by precedence" behavior is gone for this key only.
  - `src/cli/commands/config.ts` — refactored to use `core/config/helper` + the promoted helpers. `ConfigSetCommand` and `ConfigResetCommand` surface `UserOnlyKeyError` and `ConfigValidationError` as exit-2 errors with directed messages (`CONFIG_TEXTS.userOnlyKeyRejection` / `userOnlyKeyRejectionHint`). ~150 lines of inlined dot-path / atomic-write / forbidden-segments code deleted.
  - `src/cli/i18n/config.texts.ts` — new `userOnlyKeyRejection` / `userOnlyKeyRejectionHint` strings.

  **BFF additions** (`@skill-map/cli`):

  - New `src/server/routes/preferences.ts` — `GET /api/preferences` returns the user-scope envelope `{ updateCheck: { enabled: boolean } }`; `PATCH /api/preferences` accepts a partial patch and writes through `writeConfigValue` with `target: 'user'`. Manual body validation (no Zod, mirroring `routes/plugins.ts`); errors flow through `app.onError` as `HTTPException(400)` with the existing `bad-query` envelope code. Mounted in `src/server/app.ts`.
  - `src/server/i18n/server.texts.ts` — six new strings for the preferences route's 400 envelopes (`preferencesBodyNotJson`, `preferencesBodyNotObject`, `preferencesBodyEmpty`, `preferencesUpdateCheckNotObject`, `preferencesUpdateCheckEnabledNotBoolean`, `preferencesPersistFailed`).

  **UI additions** (private `ui/` workspace, ships bundled in `@skill-map/cli`):

  - New `ui/src/app/components/settings-modal/settings-general.{ts,html,css}` — General section of the Settings modal. Today renders a single `Check for updates` toggle wired to `updateCheck.enabled`, but the component is built around a declarative `GENERAL_TOGGLES: ReadonlyArray<IGeneralToggleDef>` array — adding a future user-only preference (locale, theme, …) is one entry there plus one nested key in `SETTINGS_TEXTS.general.toggles`, no template / component change.
  - `ui/src/app/components/settings-modal/settings-modal.ts` — `general` section flips from `coming-soon` placeholder to `available`; registers `SettingsGeneral` in the imports list. The modal HTML adds the corresponding `@case ('general')` branch.
  - `ui/src/i18n/settings.texts.ts` — new `general` block with heading / intro / load-error / save-error prefixes + per-toggle label & description.
  - `ui/src/models/api.ts` — new `IPreferencesApi` and `IPreferencesPatchApi` types mirroring the BFF wire shape.
  - `ui/src/services/data-source/data-source.port.ts` — `IDataSourcePort` gains `getPreferences()` / `setPreferences(patch)`. `RestDataSource` implements them via the new BFF route; `StaticDataSource` returns the shipped default for `getPreferences()` and rejects `setPreferences()` with `code: 'demo-readonly'`.
  - Two pre-existing test stubs (`ui/src/app/app.spec.ts`, `ui/src/app/views/graph-view/graph-view.spec.ts`) extended with the two new methods so the `IDataSourcePort` mock satisfies the contract.

  **Tests**:

  - New `src/test/config-helper.test.ts` — coverage for `readConfigValue` / `writeConfigValue` / `removeConfigValue` / `getValueSource`: regular precedence, `USER_ONLY_KEYS` ignoring project layer, `UserOnlyKeyError` rejection on project-target writes, idempotent remove, schema-violation rejection (`ConfigValidationError`), prototype-pollution guard.
  - New `src/test/preferences-route.test.ts` — boots `createServer()` against a tempdir cwd / homedir; covers default `GET` envelope, `PATCH` round-trip writes to user layer (NOT project), and 400 responses for bad body / empty body / wrong type.
  - `src/test/update-check.test.ts` — extended with one case asserting a project-layer `updateCheck.enabled: false` is ignored at read time (banner still prints).

  **Pre-1.0 minor bump on `@skill-map/cli`** — the read-behavior change for `updateCheck.enabled` is observable to any user who previously wrote the key into a project file. Documented in the "user-facing" section below. The spec change is a doc-only patch (description text only; schema unchanged).

  ## User-facing

  **Update-check is now a user preference.** Whether you see "Update available" notifications no longer depends on the project you are scanning. The toggle moved to **Settings → General** in the UI; the CLI equivalent is `sm config set -g updateCheck.enabled <bool>`. `sm config set` (without `-g`) now rejects this key with a clear "rerun with -g" error so you never write it to the wrong file by accident.

  If you previously had `updateCheck.enabled: false` in `<project>/.skill-map/settings.json`, that override is now **ignored** — re-set the value with `-g` (or untick the toggle in Settings → General) to make it stick across projects.

- a1bfe15: Eliminate the view-contribution `contract` abstraction — plugin authors now pick `slot` directly.

  The previous model exposed two layers to the plugin author: a closed catalog of 11 "contracts" (`node-counter`, `node-tag`, `node-breakdown`, ...) plus an internal UI map from contract → N compatible slots. Picking a contract caused the same data to render in EVERY compatible slot (e.g. `node-counter` broadcast to four surfaces simultaneously). The 2026-05-10 collapse drops the contract layer: the plugin author picks ONE slot from a closed catalog of 14 slots; the slot fixes both the renderer and the payload shape; nothing renders implicitly. Smaller mental model, no surprise duplication, slot ids that map 1:1 to a payload.

  **Spec changes** (`@skill-map/spec`):

  - `spec/schemas/view-contracts.schema.json` renamed to `spec/schemas/view-slots.schema.json`. `$defs.ContractName` (11-entry closed enum) replaced by `$defs.SlotName` (14-entry closed enum). `$defs.IViewContribution.contract` field renamed to `slot`. `$defs.payloads` re-keyed by slot id; slots that share a payload shape (`card.subtitle.left`, `card.footer.right`, `card.footer.left.counter`, `inspector.header.badge.counter` all use the counter shape) `$ref` a shared internal definition. The conditional `allOf` discriminators that mandated `icon` on `node-counter` and `node-icon` now mandate `icon` on every counter slot and on `card.title.right`.
  - The three previously-polymorphic slots are split via dotted suffix:
    - `card.footer.left` → `card.footer.left.counter` (single sub-slot — the `card.footer.left.tag` sub-slot was considered and dropped: the counter sub-slot is multi-element, no built-in adopter wanted a tag here, and the `inspector.header.badge.tag` slot covers the remaining tag-shaped use case)
    - `inspector.header.badge` → `inspector.header.badge.counter`, `inspector.header.badge.tag`
    - `inspector.body.panel` → `inspector.body.panel.breakdown`, `.records`, `.tree`, `.key-values`, `.link-list`, `.markdown` (one per shape, narrative order in the inspector body)
  - The five monomorphic slots (`card.title.right`, `card.subtitle.left`, `card.footer.right`, `graph.node.alert`, `topbar.actions.indicator`) keep their ids unchanged.
  - `spec/view-contracts.md` renamed to `spec/view-slots.md` and rewritten as a 14-slot catalog (one section per slot: payload shape, manifest declaration, emit example, where it renders).
  - `spec/architecture.md` § View contribution system: rewritten to reflect the two-layer model. The "Plugin author NEVER picks a slot" guidance is inverted; the comparison table's "Plugin author writes" row now says "`slot` name from a closed catalog"; the "Surfaces in" row now says "fixed renderer per slot, mounted at exactly the slot the author declared".
  - `spec/plugin-author-guide.md` § View contributions: rewritten tutorial. Manifest example uses `slot:`; the slot-catalog table replaces the contract-catalog table; new "Multi-slot rendering" sub-section explains that the same data in two surfaces requires two declarations (intentional).
  - `spec/db-schema.md` § `scan_contributions`: column `contract TEXT NOT NULL` renamed to `slot TEXT NOT NULL`; comment now references `view-slots.schema.json#/$defs/SlotName`.
  - `spec/schemas/extensions/base.schema.json`, `spec/schemas/api/rest-envelope.schema.json`, `spec/schemas/plugins-registry.schema.json`: `contract` field references swept to `slot`; doc strings re-pointed at `view-slots.schema.json`. `contributionsRegistry` envelope entries now carry `slot` (not `contract`).
  - `spec/conformance/coverage.md` row 30 re-pointed at `view-slots.schema.json` and the renamed conformance case.

  **Implementation changes** (`@skill-map/cli`):

  - `src/kernel/types/view-catalog.ts`: `TContractName` (11 entries) renamed to `TSlotName` (14 entries). `IViewContribution.contract` and `IRegisteredViewContribution.contract` renamed to `slot`.
  - `src/kernel/orchestrator.ts`: extractor + rule emit paths read `declared.slot`, validate via `validateContributionPayload(declared.slot, payload)`, persist with `slot:` field. Also threads a new `freshlyRunTuples` set down through `walkAndExtract` → `runScanInternal` → caller (see Persistence-fix block below).
  - `src/kernel/adapters/schema-validators.ts`: `SUPPORTING_SCHEMAS` reads `view-slots.schema.json`. `validateContributionPayload(slot, payload)` keys validators by slot id (14 keys); error code renamed from `'unknown-contract'` to `'unknown-slot'`. The validator filters out internal `$ref` targets (`_counter`, `_tag`, `_TreeNode`) so they cannot be queried by accident.
  - `src/migrations/001_initial.sql`: `scan_contributions.contract` column renamed to `slot`. No migration script — pre-1.0 greenfield, fixtures purge on next scan.
  - `src/kernel/adapters/sqlite/contributions.ts`, `src/kernel/adapters/sqlite/schema.ts`: field rename in record types and SQL queries.
  - `src/built-in-plugins/extractors/external-url-counter/index.ts`: `contract: 'node-counter'` → `slot: 'card.footer.right'`.
  - `src/built-in-plugins/extractors/at-directive/index.ts`: `contract: 'node-counter'` → `slot: 'card.footer.left.counter'`.
  - `src/built-in-plugins/rules/link-counts/index.ts`: `linksOut.contract` → `slot: 'card.footer.right'`; `linksIn.contract` → `slot: 'card.footer.left.counter'`.
  - `src/built-in-plugins/rules/unknown-contract/` renamed (via `git mv`) to `src/built-in-plugins/rules/unknown-slot/`. Export `unknownContractRule` → `unknownSlotRule`. Internal id `'unknown-contract'` → `'unknown-slot'`. Message "declares unknown contract" → "declares unknown slot". `KNOWN_CONTRACTS` set replaced by `KNOWN_SLOTS` (14 entries).
  - `src/built-in-plugins/rules/link-counts/index.ts`: rule paused — view-contributions block stripped, `evaluate()` is now a no-op `return []`. The `linksOut` chip duplicated the per-extractor counters living next to it (`@N` from at-directive, `📎N` from markdown-link, `/N` from slash); `linksIn` was unique but kept here for symmetry. Rule remains registered (no-op) so re-enabling is a single-file change.
  - `src/built-in-plugins/extractors/markdown-link/index.ts`, `src/built-in-plugins/extractors/slash/index.ts`: gain a `card.footer.left.counter` view contribution each (`📎N` and `/N` chips), aligning with `at-directive`'s existing `@N` chip and removing the rationale for the paused `link-counts` `linksOut`.
  - `src/built-in-plugins/built-ins.ts`: import path updated.
  - `src/cli/commands/plugins.ts`: `VIEW_CONTRACTS_CATALOG` (11 entries) renamed to `VIEW_SLOTS_CATALOG` (14 entries with summaries derived from `view-slots.md`). `PluginsContractsListCommand` renamed to `PluginsSlotsListCommand`; verb path `['plugins', 'contracts', 'list']` → `['plugins', 'slots', 'list']`. `PluginsCreateCommand` scaffolder emits manifest stubs with `slot:` (default `card.footer.left.counter`); help text and tip lines now reference `sm plugins slots list`. `plugins show` qualifies extension names with `<bundleId>/<extensionId>` for `granularity=extension` so shadowed siblings stay distinguishable in the listing.
  - `src/server/contributions-registry.ts`, `src/server/routes/contributions.ts`, `src/server/envelope.ts`: registry entries and lookup items use `slot:` field.
  - `src/core/runtime/plugin-runtime.ts`: `collectViewContributions` reads `entry.slot` and pushes `slot: entry.slot as TSlotName`.
  - `context/cli-reference.md` regenerated to absorb the verb rename.

  **Persistence fix — per-tuple sweep on `scan_contributions`** (`@skill-map/cli`):

  The pre-fix persist layer ran three passes (orphan → catalog → upsert) keyed at the `(plugin, extension, node, contributionId)` level, and that wasn't enough to catch the case "extractor used to emit for node X, body change removes the trigger, prior row stays stale". A 4th pass — a per-tuple sweep keyed by `(pluginId, extensionId, nodePath)` — now drops rows whose key is absent from the current scan's contribution buffer, but ONLY for tuples that actually ran this scan.

  - `src/kernel/types/storage.ts`: `IPersistOptions` gains an optional `freshlyRunTuples?: ReadonlySet<string>` field (format `<pluginId>/<extensionId>/<nodePath>`). Empty / absent set = no per-tuple sweep (legacy callers preserve the pre-fix behaviour where stale rows linger).
  - `src/kernel/orchestrator.ts`: `walkAndExtract` accumulates a `freshlyRunTuples: Set<string>`. Extractor + cache miss → tuple INCLUDED. Extractor + cache hit → tuple OMITTED (prior rows must survive). After `applyRules`, `runScanInternal` folds in `(rule × node)` for every rule that declares `viewContributions` (rules always run and see the full graph, no per-(rule, node) cache like extractors have). The set is returned alongside `contributions` and threaded into the persist call.
  - `src/kernel/adapters/sqlite/contributions.ts` + `src/kernel/adapters/sqlite/scan-persistence.ts` + `src/kernel/adapters/sqlite/storage-adapter.ts`: persist accepts the set, runs the sweep DELETE before the upsert, scoped to keys whose `(plugin, extension, node)` is in the set but whose `(plugin, extension, node, contributionId)` is NOT in the buffer. Cached-extractor tuples remain absent from the set, so their rows are untouched.
  - `src/core/runtime/scan-runner.ts` + `src/core/watcher/runtime.ts`: thread `freshlyRunTuples` from the orchestrator return into the persist call.
  - Backwards-compat: the field is optional. The persist layer treats an absent / empty set as "skip the sweep", matching pre-fix behaviour bit-for-bit.

  **UI changes** (private `ui/` workspace, ships bundled in `@skill-map/cli`):

  - `ui/src/app/contracts/contract-renderer-map.ts` renamed (via `git mv`) to `ui/src/app/slots/slot-renderer-map.ts`. The `CONTRACT_RENDERERS` + `CONTRACT_SLOTS` two-map structure is replaced by a single `SLOT_RENDERERS: Record<TSlotId, ComponentType>` (14 entries, 1:1 slot → renderer); `isKnownContract` renamed to `isKnownSlot`.
  - `ui/src/app/slots/slot-config.ts`: `TSlotId` union expanded to 14 entries; `SLOT_REGISTRY` rebuilt with sub-slots inheriting `maxItems` / `order` / `respectSeverity` from their former polymorphic parent.
  - `ui/src/app/slots/icon-glyph.ts` (new): tiny shared `<sm-icon-glyph>` component that resolves a manifest-declared `icon` per spec (`Extended_Pictographic` → emoji text; otherwise → `<i class="pi pi-{icon}">`). Adopted by `node-counter`, `node-alert`, `node-icon`, `scope-stat` — fixes the regression where `arrow-up` rendered as the literal three-character string instead of the PrimeIcons class.
  - `ui/src/app/components/view-contributions-host/view-contributions-host.ts`: dispatch simplified — `contractMatchesSlot(c.contract, slot)` replaced by `c.slot === slot`; renderer lookup is `SLOT_RENDERERS[slot]`.
  - `ui/src/models/api.ts`: `IContributionApi.contract` and `IContributionsRegistryEntryApi.contract` renamed to `slot`.
  - HTML templates: the polymorphic mounts split into per-shape hosts. `node-card.html` mounts `card.footer.left.counter` (single sub-slot, no `.tag`). `inspector-view.html` mounts `inspector.header.badge.counter` + `.tag` adjacent and the six `inspector.body.panel.*` sub-slots stacked in narrative order (breakdown → records → tree → key-values → link-list → markdown). `graph-view.html`, `app.html`, and the monomorphic mounts are unchanged.
  - `ui/src/app/debug-slots.css`: 10 new entries for the sub-slots (varied hue tones for visual distinction); 3 obsolete entries removed.
  - 11 renderer components had their `IRendererInputs` import path updated to the new `slots/slot-renderer-map`; doc strings refreshed.

  **Tests**:

  - `src/test/view-contributions.test.ts`: helper interfaces and fixtures swapped to `slot:`. Validation tests now call `validateContributionPayload(<slot-id>, ...)`. Negative test "rejects unknown contract names" renamed to "rejects unknown slot names" with assertion `result.errors === 'unknown-slot'`.
  - `src/test/server-annotations-endpoint.test.ts`, `src/test/server-sidecar-endpoint.test.ts`: schema path strings updated.
  - `src/test/plugin-runtime-branches.test.ts`: rule-id list assertion updated (`'unknown-contract'` → `'unknown-slot'`).
  - `src/built-in-plugins/rules/link-counts/link-counts.test.ts`: manifest assertions reflect the new slot ids.

  **Breaking** (per the pre-1.0 minor convention — see `CONTRIBUTING.md` / `spec/versioning.md` §Pre-1.0):

  - Plugin manifests declaring `viewContributions[*].contract: 'node-counter'` (or any of the other 10 contract names) now load as `invalid-manifest`. Migration is mechanical: rename the field to `slot` and pick one of the 14 slot ids that matches the prior contract's payload shape. Recommended mapping: `node-counter` → `card.footer.right` (or another counter slot), `node-tag` → `inspector.header.badge.tag` (the only tag slot in the catalog now), `node-breakdown/records/tree/key-values/link-list/markdown` → `inspector.body.panel.<shape>`, `node-alert` → `graph.node.alert`, `node-icon` → `card.title.right`, `scope-stat` → `topbar.actions.indicator`.
  - The CLI verb `sm plugins contracts list` is removed and replaced by `sm plugins slots list`.
  - The built-in soft-warning rule `core/unknown-contract` is removed and replaced by `core/unknown-slot` (same semantics, slot-keyed walk).
  - The database column `scan_contributions.contract` is renamed to `slot`. No migration script ships — purge fixture DBs and re-run `sm scan` after upgrading. The pre-1.0 greenfield posture (no schema versioning) holds.

  ## User-facing

  **The view-contribution model is simpler.** Plugin authors now pick **one slot** from a closed catalog of 14; the slot decides where the data renders, what payload shape is expected, and which renderer draws it. The previous model required learning two catalogs (contracts and slots) and accepted that the same data would broadcast to multiple surfaces automatically — that broadcast is gone.

  Visible changes in the SPA:

  - The URL-counter chip from `core/external-url-counter` now renders only in the card's footer-right cluster (was visible in four surfaces simultaneously).
  - The `@-mention` chip from `core/at-directive`, plus new `📎` (markdown links) and `/` (slash directives) counter chips from `core/markdown-link` and `core/slash`, render only in the card's footer-left cluster.
  - The `core/link-counts` rule is paused — its `linksOut` / `linksIn` chips are temporarily off the card. `linksOut` duplicated the new per-extractor counters; `linksIn` will return when the chip surface is reinstated. The rule stays registered as a no-op so re-enabling is a single-file change.
  - The CLI verb to browse the catalog is now `sm plugins slots list` (was `sm plugins contracts list`).
  - **Stale view contributions are cleaned up.** Editing a node so an extractor stops emitting a chip (e.g. removing the last `@mention` from a doc) now removes the chip on the next scan. Previously the chip would linger until the row was clobbered by an unrelated edit.
  - Renderer icons resolve correctly across emoji and PrimeIcons names (an icon like `arrow-up` no longer leaks as the literal three-character string when the renderer expected a class name).

- 5600a60: Hook trigger set grows from 8 to 10: add CLI-process-driven `boot` and `shutdown`. First built-in concrete consumer: `core/update-check` (the once-per-day update banner moves from an inline call site to a hook subscribing to `boot`).

  **Spec changes** (`@skill-map/spec`):

  - `spec/schemas/extensions/hook.schema.json` — `triggers[].enum` grows from 8 to 10 entries (`boot` first, `shutdown` last). Top-level description updated to reflect the new size and the pipeline-driven vs CLI-process-driven split.
  - `spec/architecture.md` § Hook · curated trigger set — table grows by two rows. `boot` documents the pre-verb dispatch (await semantics, fire-time, payload `{ argv }`); `shutdown` documents the post-verb dispatch (await semantics, payload `{ exitCode }`). The "Eight" wording flips to "ten" in the §Hook one-liner and the §Locality count of bundled built-ins (`one Provider, four extractors, five rules, one formatter, one hook` — the first built-in hook is `core/update-check`). The `## Stability and versioning` clause updates: trigger-set size goes from 8 to 10; adding an eleventh is a minor bump, removing or renaming any of the ten is a major bump.
  - `spec/index.json` regenerated.

  **Implementation changes** (`@skill-map/cli`):

  - `src/kernel/extensions/hook.ts` — `THookTrigger` union and the frozen `HOOK_TRIGGERS` array grow from 8 to 10 entries (`boot` first, `shutdown` last so a debug log of the array reads in lifecycle order). Doc comment updated.
  - `src/kernel/extensions/hook-dispatcher.ts` (new) — `IHookDispatcher`, `makeHookDispatcher`, and `makeEvent` extracted from `kernel/orchestrator.ts` so two callers can share the indexing / filter / error-handling semantics: the orchestrator for the eight pipeline-driven triggers (inside `runScan`), and `cli/entry.ts` for `boot` / `shutdown`. The orchestrator now imports the helpers; the duplicated inline definitions and `matchesFilter` / `buildHookContext` helpers are gone.
  - `src/kernel/index.ts` — re-exports `makeHookDispatcher`, `makeEvent`, and `IHookDispatcher` so the CLI entry (and future drivers) can build their own dispatcher without crossing into orchestrator internals.
  - `src/built-in-plugins/hooks/update-check/index.ts` (new) — first built-in concrete `IHook`. Subscribes to `boot`, deterministic mode. Imports `maybeRunUpdateCheck` from `cli/util/update-check-banner.js` and forwards the contracted `event.data: { dbPath, cwd, homedir, stderr, noColorFlag }` payload. Defensive: a `boot` event missing any contracted field is a no-op (rather than a throw), so a misconfigured driver degrades gracefully. The lint config does not restrict `built-in-plugins/**` from importing CLI helpers (built-ins are bundled in the same binary), so the cross-layer import is intentional — `cli/util/update-check-banner.ts` is the only legal home for the env / config reads (`SM_NO_UPDATE_CHECK`, `CI`, `loadConfig`, ANSI / TTY checks) per the kernel-boundary lint rules.
  - `src/built-in-plugins/built-ins.ts` — imports `updateCheckHook` and pushes it into the `core` bundle (last entry). The `bucketBuiltIn` dispatch table already routed `kind: 'hook'` to `out.hooks`; no per-kind code change.
  - `src/cli/entry.ts` — the inline `await maybeRunUpdateCheck(...)` post-`cli.run()` block is gone. Instead: the entry now imports `builtIns()` and `makeHookDispatcher`, builds a single dispatcher over `builtIns().hooks`, dispatches `boot` BEFORE `cli.process()` (so the banner lands above the verb's output, per the Phase 3 design call), and dispatches `shutdown` AFTER `cli.run()` and BEFORE `process.exit(exitCode)`. `boot` payload carries `{ argv, dbPath, cwd, homedir, stderr, noColorFlag }`; `shutdown` payload carries `{ exitCode }`. Both dispatches await; the dispatcher catches every hook error so a buggy hook can only delay the verb / exit, never alter the resolved exit code. User-plugin hooks subscribing to `boot` / `shutdown` are loaded but not yet dispatched on this path (built-in only) — documented as a follow-up in the README.
  - `src/core/runtime/plugin-runtime.ts` — `composeScanExtensions` "kernel-empty-boot" check no longer counts hooks. A hook subscribing only to `boot` / `shutdown` (the new CLI-driven triggers) reaches the composer through the built-in bundle but the orchestrator dispatcher would never invoke it; preserving the empty-boot shape regardless of hook presence keeps the conformance case honest while letting `core/update-check` ride along for the entry-side dispatcher to pick up.
  - `src/built-in-plugins/README.md` — adds the `core/update-check` row and a paragraph on the two dispatch entry points (orchestrator vs CLI entry) sharing the same dispatcher module.
  - `src/test/update-check-hook.test.ts` (new) — manifest-shape assertions and defensive-payload coverage for the hook (no-op when `dbPath` / `cwd` / `homedir` / `stderr` are absent; clean forward when contracted; DB missing → silent bail). Pre-existing unit + integration tests for `maybeRunUpdateCheck` (in `src/test/update-check.test.ts`) keep covering the cache + bail + banner behaviour end-to-end — the hook is a thin wrapper.
  - Two pre-existing tests updated for the new built-in count: `src/test/built-ins-modes.test.ts` (`listBuiltIns().length`: 23 → 24, comment updated to call out the new hook).

  **ROADMAP changes**:

  - §Plugin system · Hook trigger set — list grows from 8 to 10 entries; new paragraph documents the dispatcher module split (`kernel/extensions/hook-dispatcher.ts`) and points at `core/update-check` as the first built-in consumer.
  - §Glossary · Hook — one-liner updated from "one of eight" → "one of ten" with the pipeline vs CLI-process split.

  **Pre-1.0 minor bumps** per `spec/versioning.md` § Pre-1.0 — both surfaces grow additively (two new triggers, one new built-in hook, one new internal kernel module). No existing surface is removed or renamed; old hooks subscribing only to the eight pre-existing triggers keep working byte-for-byte. Pre-1.0 lets us land additive contract growth as `minor` without flipping to 1.0.0.

- 802e64f: Rename the `rule` plugin extension kind to `analyzer`.

  The kind formerly known as `rule` not only finds issues but also projects findings into the UI via `viewContributions` (cards, badges, tabs). "Rule" undersold the breadth of the contract; **Analyzer** captures both axes — graph analysis and visual projection. Pre-1.0, no released consumers depend on the old name, so this ships as a sweep without compatibility shims.

  **Wire format (breaking)**

  - `kind` enum in `extensions/base.schema.json` now lists `analyzer` instead of `rule`.
  - `extensions/rule.schema.json` is renamed to `extensions/analyzer.schema.json`.
  - The const value of `kind` on the kind-specific schema is `"analyzer"`.
  - The manifest array field `emitsRuleIds` is now `emitsAnalyzerIds`.

  **Issue model + REST + DB (breaking)**

  - `Issue.ruleId` is now `Issue.analyzerId` in the JSON wire and the TS shape.
  - `GET /api/issues?ruleId=<id>` becomes `GET /api/issues?analyzerId=<id>`.
  - The SQL column `scan_issues.rule_id` is now `scan_issues.analyzer_id`; the index `ix_scan_issues_rule_id` becomes `ix_scan_issues_analyzer_id`.

  **Events (breaking)**

  - The hook trigger `rule.completed` is now `analyzer.completed`. The payload field renames from `ruleId` to `analyzerId`.

  **CLI (breaking)**

  - `sm check --rules <ids>` becomes `sm check --analyzers <ids>`.
  - The conformance kill-switch env var is `SKILL_MAP_DISABLE_ALL_ANALYZERS` (was `SKILL_MAP_DISABLE_ALL_RULES`); the corresponding `conformance-case.schema.json` field is `disableAllAnalyzers`.
  - The advisory placeholder `{{ruleIds}}` in `--include-prob` output is now `{{analyzerIds}}`.

  **Kernel + built-ins (breaking)**

  - TypeScript symbols: `IRule` → `IAnalyzer`, `IRuleContext` → `IAnalyzerContext`, `IRuleOrphanSidecar` → `IAnalyzerOrphanSidecar`.
  - The 11 built-in extensions previously under `src/built-in-plugins/rules/` now live under `src/built-in-plugins/analyzers/`. Each `*Rule` symbol (e.g. `triggerCollisionRule`) is renamed to its `*Analyzer` form (`triggerCollisionAnalyzer`).
  - `IBuiltIns.rules` → `IBuiltIns.analyzers`; `IPluginRuntimeBundle.extensions.rules` → `analyzers`; `IScanExtensions.rules` → `analyzers`.
  - The kernel filter utility `kernel/util/rule-filter.ts` (`matchesRuleFilter`) is renamed to `analyzer-filter.ts` (`matchesAnalyzerFilter`).

  **Testkit (breaking, public)**

  - `runRuleOnGraph` → `runAnalyzerOnGraph`.
  - `makeRuleContext` → `makeAnalyzerContext`.
  - `IRunRuleOptions` → `IRunAnalyzerOptions`.
  - Re-exports `IAnalyzer`, `IAnalyzerContext` instead of the `IRule` variants.

  **Migration**

  Greenfield rename — no fallback. Existing user plugins with `kind: "rule"` and `emitsRuleIds` need to update their manifests. The scaffolder (`sm plugins create`) emits `kind: 'analyzer'` automatically; a future `sm plugins upgrade <id>` will rewrite legacy manifests.

  ## User-facing

  The plugin extension kind was renamed from **Rule** to **Analyzer** to better reflect what these plugins do — they analyze the graph AND project findings into the UI. End-user-visible changes:

  - The CLI flag `sm check --rules <ids>` is now `sm check --analyzers <ids>`.
  - The `sm check --json` output's per-issue `ruleId` field is now `analyzerId`.
  - Hook triggers in plugin manifests rename from `rule.completed` to `analyzer.completed`; the event payload field `ruleId` is now `analyzerId`.
  - The Settings → Plugins page lists plugins of kind "analyzer".
  - The marketing site shows the satellite as "Analyzer plugin kind" instead of "Rule plugin kind".

  If you maintain a custom plugin with `kind: "rule"`, update the manifest to `kind: "analyzer"`, rename `emitsRuleIds` to `emitsAnalyzerIds`, and rename any imported `IRule` / `IRuleContext` symbols to `IAnalyzer` / `IAnalyzerContext`. The directory name and `id` rules remain unchanged.

- 5600a60: Add `sm scan -g` (global scan) plus three privacy-sensitive project scan settings: `scan.includeHome`, `scan.extraRoots`, `scan.referencePaths`. Settings UI exposes them in a new "Project" section.

  **Spec changes** (`@skill-map/spec`, minor):

  - `spec/cli-contract.md` § Scan — `sm scan -g/--global` flag documented: with `-g` the scan walks every active Provider's `explorationDir` resolved against `~` (typically `~/.claude`, `~/.gemini`, `~/.agents`) instead of the cwd; config + DB resolve from the global scope. Mutually exclusive with positional roots (exit `2`). New §Effective roots subsection enumerates how the resolver composes `cwd` + `includeHome` + `extraRoots` + `-g`.
  - `spec/cli-contract.md` § Config — `sm config set` gains an optional `--yes` flag and a new §Privacy-sensitive config subsection: writes that EXPAND disk access outside the project (toggling `scan.includeHome` `false`→`true`, adding out-of-project paths to `scan.extraRoots` / `scan.referencePaths`) require `--yes` to confirm. Writes that NARROW the surface need no flag.
  - `spec/schemas/project-config.schema.json` — `scan` block grows three keys:
    - `includeHome: boolean` (default `false`).
    - `extraRoots: string[]` (default `[]`).
    - `referencePaths: string[]` (default `[]`).
      Every key carries a "privacy-sensitive" warning in its description so the schema-as-doc stays honest.
  - `spec/index.json` regenerated.

  **Implementation changes** (`@skill-map/cli`, minor):

  - `src/config/defaults.json` — three new defaults under `scan` (`includeHome: false`, `extraRoots: []`, `referencePaths: []`).
  - `src/kernel/config/loader.ts` — `IScanConfig` gains `includeHome`, `extraRoots`, `referencePaths`. Each documented inline as privacy-sensitive.
  - `src/kernel/extensions/rule.ts` — `IRuleContext` gains optional `referenceablePaths?: ReadonlySet<string>` (the side index `core/broken-ref` consults) and `cwd?: string` (absolute project root, threaded so rules can resolve relative `link.target`s without heuristics).
  - `src/kernel/orchestrator.ts` — `RunScanOptions.referenceablePaths?` and `RunScanOptions.cwd?` propagate through `runScanInternal` → `runRules` → per-rule `evaluate()`.
  - `src/core/runtime/scan-roots.ts` (new) — `resolveScanRoots({ positionalRoots, scope, cwd, homedir, providers, includeHome, extraRoots })`. Centralises the spec's § Effective roots rules: positional roots win verbatim; otherwise compose cwd + (includeHome ? HOME provider dirs : []) + extraRoots for project scope, or HOME provider dirs only for global scope. `-g` + positional roots throws.
  - `src/core/runtime/reference-paths-walker.ts` (new) — `walkReferencePaths(rawRoots, cwd, homedir)` returns `{ paths: Set<absolute>, truncated, missingRoots }`. Recursive walk that skips symlinks + `node_modules`/`.git`/`.skill-map`; capped at `REFERENCE_WALK_MAX_FILES` (50_000) for safety.
  - `src/core/runtime/scan-runner.ts` — `IScanRunOpts.scope?: 'project' | 'global'` (default `'project'`). Resolves DB via `resolveDbPath({ global: scope === 'global', ... })`, `loadConfig` honours the scope, roots resolve via `resolveScanRoots`, reference paths walk via `walkReferencePaths`, and the resolved `cwd` + `referenceablePaths` thread into `RunScanOptions`. Emits stderr advisories for HOME inclusions and reference-walk truncation / missing roots. The `runOptions` assembly extracted to a `buildRunScanOptions` helper to stay under the cyclomatic-complexity cap.
  - `src/core/runtime/i18n/scan-runner.texts.ts` — three new strings (`includingHomeAdvisory`, `includingExtraRootsAdvisory`, `referenceWalkTruncated`, `referenceWalkMissingRoot`).
  - `src/built-in-plugins/rules/broken-ref/index.ts` — refactored to consult `ctx.referenceablePaths` after the in-graph lookup misses. A path-style link target whose absolute resolution (`resolve(ctx.cwd, link.target)`) is in the side index is treated as resolved (file exists outside the indexed graph). Trigger-style links (`/foo`, `@bar`) skip the side-index lookup. The orchestrator's helper extracted to keep the rule under the complexity cap.
  - `src/cli/commands/scan.ts` — wires `-g/--global` to `runScanForCommand`'s new `scope` option. Mutex with positional roots is rejected up front with a directed message (`SCAN_TEXTS.globalWithRoots`).
  - `src/cli/commands/config.ts` — `ConfigSetCommand` gains `--yes`. When the key is in `PRIVACY_SENSITIVE_KEYS` and the new value would expand the surface, the verb prints the list of paths the change would expose and exits `2` unless `--yes` is set; with `--yes` it prints the same list as a confirmation receipt.
  - `src/cli/i18n/config.texts.ts` — `privacyGateRequired` / `privacyGateRequiredHint` / `privacyGateConfirmed`.
  - `src/cli/i18n/scan.texts.ts` — `globalWithRoots`.
  - `src/core/config/helper.ts` — adds `PRIVACY_SENSITIVE_KEYS` (a `ReadonlySet<string>`) and `projectPathExposure({ key, value, cwd, homedir })` that returns `{ expandsSurface, exposedPaths }`. Same predicate is consumed by both the CLI verb and the BFF route so the wire-side and CLI-side behaviour stay symmetric.

  **BFF additions**:

  - `src/server/routes/project-preferences.ts` (new) — `GET /api/project-preferences` returns `{ scan: { includeHome, extraRoots, referencePaths } }`; `PATCH /api/project-preferences` writes via `core/config/helper:writeConfigValue` with `target: 'project'`. Privacy-sensitive writes that expand the surface require `confirm: true` in the body — otherwise the route returns 412 `confirm-required` with the list of paths the change would expose.
  - `src/server/i18n/server.texts.ts` — eight new strings under the project-preferences section.
  - `src/server/app.ts` — registers the new route + adds `'confirm-required'` to `TErrorCode`; `codeForStatus(412)` maps to it.

  **UI additions** (private `ui/` workspace):

  - `ui/src/app/components/settings-modal/settings-project.{ts,html,css}` (new) — Project section. Renders the `includeHome` toggle plus two editable path lists (`extraRoots`, `referencePaths`) with add / remove controls. A `<p-confirmdialog>` enumerates the paths a privacy-sensitive change would expose; on accept the patch is re-issued with `confirm: true`.
  - `ui/src/app/components/settings-modal/settings-modal.{ts,html}` — `Project` added to the sidebar between `General` and `Plugins`. New `projectVisible` computed signal mirrors the General / Plugins lifecycle.
  - `ui/src/i18n/settings.texts.ts` — `sections.project` + `project: { heading, intro, includeHomeLabel, includeHomeDescription, extraRootsLabel, extraRootsDescription, extraRootsPlaceholder, referencePathsLabel, referencePathsDescription, referencePathsPlaceholder, addPathLabel, removePathLabel, confirmDialogHeader, confirmDialogIntro, confirmDialogAccept, confirmDialogReject }`.
  - `ui/src/models/api.ts` — new `IProjectPreferencesApi` and `IProjectPreferencesPatchApi` types (mirroring the BFF shape).
  - `ui/src/services/data-source/data-source.port.ts` — `IDataSourcePort` gains `getProjectPreferences()` / `setProjectPreferences(patch)`. `RestDataSource` and `StaticDataSource` implementations updated.
  - Two pre-existing test stubs (`ui/src/app/app.spec.ts`, `ui/src/app/views/graph-view/graph-view.spec.ts`) extended with the two new methods.

  **Tests**:

  - New `src/test/scan-roots.test.ts` — exhaustive coverage of `resolveScanRoots` permutations (positional verbatim, `-g` mutex throw, project / global derivations, dedup).
  - New `src/test/reference-paths-walker.test.ts` — recursive walk, missing roots, symlinks skipped, skip-list dirs, multi-root.
  - New `src/test/project-preferences-route.test.ts` — boots `createServer()` against a tempdir cwd / homedir; covers default `GET`, the `confirm-required` 412 on expansion, the `confirm: true` round-trip, and 400 body-shape errors.

  **Pre-1.0 minor bumps** per `spec/versioning.md` § Pre-1.0 — both surfaces grow additively (one new flag on `sm scan`, three new optional config keys, one new BFF route, one new UI section). Existing `scan` invocations behave identically with the new defaults (every new key defaults to the historical zero-state).

  ## User-facing

  **`sm scan -g` now scans your HOME directory.** Run `sm scan -g` (without positional roots) to walk every active provider's HOME dir — typically `~/.claude`, `~/.gemini`, `~/.agents` — using the global config + DB.

  **Three new privacy-sensitive project settings.** Open Settings → Project to:

  - **Include HOME provider directories** — when on, `sm scan` (without `-g`) also walks `~/.claude`, `~/.gemini`, `~/.agents` alongside your project content.
  - **Extra scan roots** — paths you can add to the scan (indexed as nodes alongside the project root).
  - **Reference paths (link validation)** — paths walked only to validate links; files there aren't indexed but `core/broken-ref` won't warn when a link target exists in one of them.

  Every change that expands disk access beyond your project root requires explicit confirmation: a confirm dialog in the UI listing the paths that will be read, or `sm config set <key> <value> --yes` on the CLI. Writes that narrow the surface (toggling off, removing paths) need no confirmation.

- 825dce4: View-contribution slot expansion + new `node-icon` contract + host-enforced plugin lock.

  **Spec changes** (`@skill-map/spec`):

  - New contract `node-icon` in the closed catalog (`spec/view-contracts.md`, `spec/schemas/view-contracts.schema.json`). Single icon per node — small standalone marker rendered next to the card title. Manifest requires `icon`; payload optionally overrides per-node and may add `severity` (color tint, reusing the closed `Severity` palette) and `tooltip`. No counts, no labels — for chip + number use `node-counter`; for label + severity use `node-tag`; for an alert badge on the graph node corner use `node-alert`. The schema's `allOf` discriminator gains the `node-icon` branch (mirrors the existing `node-counter` rule that requires `icon`); the `Severity` `$def` description now lists `node-icon` alongside the other severity-aware contracts.
  - New BFF error code `locked` (HTTP 403) on `PATCH /api/plugins/:id` and `PATCH /api/plugins/:bundleId/extensions/:extensionId` — emitted when the target id is in the host's hardcoded lock-list. `GET /api/plugins` mirrors the same rule by stamping an optional `locked: true` flag on the affected items so UIs can render the toggle disabled. The flag is omitted when false. Documented in `spec/cli-contract.md` (item shape, error code source table, restart-required note).

  **Implementation changes** (`@skill-map/cli`):

  - New `src/kernel/config/locked-plugins.ts` — single source of truth for the host lock-list (today: `core/markdown`). Three layers enforce it: the CLI (`sm plugins enable|disable` rejects with exit 5 + a directed message; `--all` quietly skips locked targets), the BFF (`PATCH /api/plugins/...` returns 403 `locked`), and the runtime resolver (`plugin-resolver.ts` ignores any persisted `config_plugins` row or `settings.json` entry against a locked id and returns the installed default — defense in depth so "lock" stays unbreakable regardless of stored state). Lives under `src/kernel/config/` so all three layers share the import without breaking the kernel's "no driver knows about other drivers" rule. The lock is host-only and not user-editable by design — to remove an entry, edit the file.
  - `src/server/app.ts` — `TErrorCode` gains `'locked'`; `codeForStatus` maps HTTP 403 → `locked`. `src/server/i18n/server.texts.ts` — new `pluginsLocked` / `pluginsExtensionLocked` messages. `src/server/routes/plugins.ts` — `IPluginExtensionItem` and `IPluginListItem` gain optional `locked?: boolean`; both PATCH handlers reject locked targets with HTTPException 403 before the persistence step.
  - `src/built-in-plugins/rules/unknown-contract/index.ts`, `src/kernel/types/view-catalog.ts`, `src/cli/commands/plugins.ts` (`VIEW_CONTRACTS_CATALOG`) — new `node-icon` entry registered in every catalog the kernel/CLI publishes. The `unknown-contract` lint rule now considers `node-icon` known (no warning).
  - `src/cli/commands/plugins.ts` — bundle-detail rendering now qualifies extension names with `<bundleId>/` only when `granularity: 'extension'` (the toggle-able id surface); for `granularity: 'bundle'` the per-extension names stay bare since they are informational rather than user-tippable.
  - `src/cli/i18n/plugins.texts.ts` — new `pluginLocked` / `pluginLockedHint` strings.
  - `src/test/server-endpoints.test.ts` — two new cases: PATCH against `core/markdown` returns 403 `locked`, and `GET /api/plugins` stamps `locked: true` on the same row.
  - `src/built-in-plugins/extractors/at-directive/index.ts` — gains a `node-counter` view contribution (`count` / icon `@` / label `mentions` / `emitWhenEmpty: false`) and a one-line `ctx.emitContribution('count', ...)` after the extractor's main loop. First built-in extractor to emit a real contribution end-to-end, exercising the new card slots without any user plugin installed.

  **UI changes** (private `ui/` workspace, ships bundled in `@skill-map/cli`):

  - Three new slot ids in the closed UI catalog (`ui/src/app/slots/slot-config.ts`): `card.title.right` (cap 2, sits next to the node title), `card.subtitle.left` (cap 3, sits in the date stat row), `card.footer.right` (cap 5, sits alongside the hardcoded status icons in a new `.sm-gnode__footer-right-cluster` wrapper that owns the right-alignment). All three are `multi`/`priority`/`append`/`respectSeverity: true`. The card template (`ui/src/app/components/node-card/node-card.html` + `.css`) wires the three host instances; no slot is empty-collapsed (the host stays silent when no contribution targets it).
  - New `node-icon` renderer (`ui/src/app/renderers/node-icon/node-icon.ts`) — sized to match `.sm-gnode__chevron` (22×22, glyph 0.7rem) so the marker reads as a sibling of the chevron when both sit on the title row. Severity classes map to the same theme tokens the alert renderer uses.
  - The `node-counter` contract now also targets `card.footer.right` and `card.subtitle.left` (its informative slot list grows), so existing `node-counter` plugins automatically light up the new card slots without manifest changes.
  - `ui/src/app/components/view-contributions-host/view-contributions-host.ts` — the `DemoContributionsService` injection and "decorate" wiring are gone (the demo service was deleted; production sources only).
  - `ui/src/app/services/demo-contributions.ts` — **deleted**. The synthetic chips-for-slot-validation service finished its purpose now that real contributions land in the new slots.
  - `ui/src/app/views/graph-view/graph-view.{html,css,ts}` — the `.sm-gnode__marker-stub` placeholder svg + its CSS stub are dropped (the host underneath is the production surface; with `node-alert` plugins now demo-ready and `node-icon` shipping, the placeholder is redundant). The `resetLayout()` confirm dialog upgrades from `window.confirm()` to PrimeNG's `<p-confirmdialog>` (header / message / typed accept-and-reject buttons; mask gets the same global blur as the public site's cookie-consent banner).
  - Settings → Plugins (`ui/src/app/components/settings-modal/settings-plugins.{ts,html,css}`) — locked rows render an amber "Locked" pill with a `pi-lock` glyph next to the existing source/version/granularity tags; the `<p-toggleswitch>` stays mounted but disabled, so the user sees the current enabled state and a tooltip explaining why it cannot move. Both bundle and extension rows participate. New helpers `bundleToggleInteractive` / `extensionToggleInteractive` gate the row-click and sub-row-click handlers.
  - `ui/src/models/api.ts` — `IPluginExtensionApi` and `IPluginItemApi` gain optional `locked?: boolean` (mirrors the BFF wire shape).
  - `ui/src/i18n/settings.texts.ts` — new `lockedLabel` / `lockedTooltip`. `ui/src/i18n/graph-view.texts.ts` — `resetLayoutConfirm` reshapes from a single string into `{ header, message, accept, reject }` to feed the PrimeNG dialog.
  - `ui/src/app/debug-slots.css` — three new debug outline colors (orange / teal / purple) for the new slots.
  - `ui/src/styles.css` — global `.p-dialog-mask` style (blur + dim) so the new `<p-confirmdialog>` and any future `<p-dialog [modal]>` get the same glass look the public site uses for its cookie-consent banner.

  **Repo plumbing**:

  - `package.json` — `bff:dev` gets a `prebff:dev` step (`npm run bff:scan`) that runs `sm scan` against `fixtures/local-scope` first, so the dev BFF always boots with a populated DB.
  - `fixtures/local-scope/` — the curated demo-content directory shrinks to a minimal `DOC1.md` + `DOC2.md` pair (slim surface for testing the new view-contribution slots and the locked-plugin behaviour). The full curated content (claude / gemini agents, skills, commands, GEMINI.md, README.md, plus the `.gitignore` / `.skillmapignore`) is preserved as `fixtures/local-scope.full/` for cases that need the kitchen-sink fixture.

  **ROADMAP changes**:

  - §UI contribution system — Slot catalog list grows from 5 to 8; Contract catalog count flips from 10 to 11 with a one-line note on `node-icon`'s niche relative to `node-alert` and `node-counter`. Last-updated marker bumped to 2026-05-10.

  **Pre-1.0 minor bump** per `spec/versioning.md` § Pre-1.0 — the spec change is additive (new contract entry + new optional field on the wire shape; existing `view-contracts.schema.json` consumers keep validating), the CLI change is additive (new error code, new slots, new contract, new lock surface — nothing removed), so both ride a normal minor.

  ## User-facing

  **Three new card slots and a small per-node icon contract.** The graph card now reserves room for plugin-emitted markers in three new spots: a tiny icon next to the node title (right side), a small chip in the date row, and an extra cluster on the right of the footer alongside the status icons. Existing `node-counter` plugins automatically light up the new footer-right and subtitle slots — no manifest changes needed. Plugin authors can also pick a new contract, `node-icon`, for a single-glyph marker (e.g. language flag, "has audio", platform badge) when a counter or tag would be too noisy. See [`spec/view-contracts.md`](https://github.com/crystian/skill-map/blob/main/spec/view-contracts.md#node-icon) for the full schema.

  **Plugins can now be locked by the host.** Settings → Plugins shows a "Locked" pill on plugins that the host marks as mandatory — today only `core/markdown` (the universal `.md` fallback). The toggle stays visible but disabled so it is obvious the lock is intentional, with a tooltip explaining why. `sm plugins disable core/markdown` now rejects the call with a clear message instead of writing a no-op override.

  **Reset Layout uses a proper dialog.** The "Reset all node positions" action used to fire a browser-native `confirm()` popup; it now uses the same in-app dialog style as the rest of the UI (with a destructive-styled "Reset" button and a "Cancel" escape).

### Patch Changes

- 5600a60: Add the `core/job-orphan-file` built-in rule. Surfaces orphan MD files under `.skill-map/jobs/` (no matching `state_jobs.filePath` row) as `warn` issues during `sm scan`. Mirrors the `core/annotation-orphan` model: detection runs OUTSIDE the rule and the rule only projects.

  - New `src/built-in-plugins/rules/job-orphan-file/index.ts` — declarative rule registered in the `core` bundle (next to `core/annotation-orphan` for thematic affinity). Severity `warn`, deterministic mode. The rule body is a 12-line `for` over `ctx.orphanJobFiles` projecting each path as an issue with `nodeIds: [path]`, `data.filePath: path`, and a message that suggests `sm job prune --orphan-files`.
  - New `src/built-in-plugins/i18n/job-orphan-file.texts.ts` — single template, `{{filePath}}` placeholder.
  - `src/kernel/extensions/rule.ts` — `IRuleContext` gains optional `orphanJobFiles?: readonly string[]`. Additive; legacy callers that omit it leave the new rule a no-op.
  - `src/kernel/orchestrator.ts` — `RunScanOptions.orphanJobFiles?` threads through `runScanInternal` → `runRules` → per-rule `evaluate({ ..., orphanJobFiles })`. When the option is absent or empty the array passed to rules is `[]`.
  - `src/core/runtime/scan-runner.ts` — the persist branch precomputes orphans inside its existing `withSqlite` scope: `findOrphanJobFiles(jobsDir, await adapter.jobs.listReferencedFilePaths()).orphanFilePaths` lands on `runScanWith(prior, priorRuns, orphanJobFiles)` and onward to `runOptions.orphanJobFiles`. The ephemeral / dry-run branch passes `[]` (no DB → nothing to compare against). `defaultProjectJobsDir` is resolved once via `defaultProjectJobsDir(ctx)`. The runner always sets `runOptions.orphanJobFiles` (possibly `[]`) to keep the wiring uniform.
  - The same `findOrphanJobFiles` helper still backs `sm job prune --orphan-files` (the action that deletes the files). Detection (rule) and action (CLI verb) stay in sync because both consume the exact helper; no logic duplication, no double-emission risk — the rule reports, the CLI verb prunes.
  - `src/built-in-plugins/README.md` — adds the new rule row.
  - `src/test/job-orphan-file-rule.test.ts` — unit tests over the rule's pure projection (absent / empty input, multi-orphan emission, order preservation, determinism). Three pre-existing test bumps reflect the new built-in count: `src/test/built-ins-modes.test.ts` (`listBuiltIns().length`: 22 → 23), `src/test/plugin-runtime-branches.test.ts` (rule-bucket count: 11 → 12, plus the post-`core/superseded`-disable list).

  Pre-1.0 patch: every change is additive and the new rule is a built-in inside the existing `core` bundle (no new schemas, no contract changes; `IRuleContext` only grows an optional field).

  ## User-facing

  **`sm scan` now flags orphan job files.** A new built-in rule, `core/job-orphan-file`, scans `.skill-map/jobs/` for MD files that no `state_jobs` row references and reports each as a `warn` issue. This is detection only — to actually delete the files, run `sm job prune --orphan-files` (unchanged). Useful when the DB was wiped manually but the file tree is still around (or vice versa, recovered DB but the runner crashed mid-render and the file never made it into the row).

- 5600a60: Move file parsers under `src/built-in-plugins/parsers/` for layout consistency with the other built-ins.

  `frontmatter-yaml` and `plain` parsers — and their tests — now live at `src/built-in-plugins/parsers/{frontmatter-yaml,plain}/`. The kernel-internal parser registry in `src/kernel/scan/parsers/index.ts` imports from the new location; `getParser(id)` and `registerParser` are unchanged. No `kind: 'parser'` is exposed: parsers stay kernel-internal, the registry is still frozen, the parsers are not registered into `IBuiltInBundle.extensions`, and `src/kernel/index.ts` does not re-export any of it. Provider authors keep referencing parsers by id via `read.parser` exactly as before — pure relocation, no behaviour change, no public surface change.

  `src/built-in-plugins/README.md` — adds an "Internal-only parsers" note explaining why the parsers live here but are absent from the inventory table.

- Updated dependencies [5600a60]
- Updated dependencies [a1bfe15]
- Updated dependencies [5600a60]
- Updated dependencies [802e64f]
- Updated dependencies [5600a60]
- Updated dependencies [825dce4]
  - @skill-map/spec@0.20.0

## 0.19.0

### Minor Changes

- 3376a75: spec 0.18.0 — universal markdown fallback as a built-in Provider. The format-named generic kind `markdown` moves out of the per-vendor Provider catalogs (claude / gemini) into a dedicated built-in `core/markdown` Provider. Markdown is provider-agnostic — no vendor owns the universal `.md` format — and bundling the fallback as a regular Provider under the `core` group preserves the spec invariant that no extension is privileged. The kernel orchestrator now dedups files across the multi-Provider walk so each path is offered to AT MOST one `classify`: vendor Providers retain priority on files inside their territory, and `core/markdown` (registered LAST) picks up exactly the orphan `.md` files no vendor claimed — files at the project root, under `.claude/hooks/`, `notes/`, `CLAUDE.md`, `GEMINI.md`, or anywhere else outside a known vendor path. The fallback can be disabled via `sm plugins disable core/markdown` (consistent with every other extension under `core`); orphan markdown then becomes silently invisible, matching pre-0.18.0 behaviour.

  **Spec changes** (`spec/architecture.md`): new §Provider · dispatch order and the universal markdown fallback documents the iteration contract (vendor Providers first → `core/markdown` LAST), the path-dedup invariant, and the user-disable escape hatch. `spec/db-schema.md` `Node.kind` row updated to reflect the new ownership map. `spec/conformance/cases/orphan-markdown-fallback.json` (new) locks the contract end-to-end via a multi-Provider fixture asserting that `.claude/agents/reviewer.md` lands as kind `agent` (claude) and `ARCHITECTURE.md` lands as kind `markdown` (core-markdown). `spec/conformance/coverage.md` rows 4 (`scan-result.schema.json`) and 11 (`frontmatter/base.schema.json`) flip 🟢 covered via the new case.

  **Implementation changes** (`@skill-map/cli`): new `src/built-in-plugins/providers/core-markdown/` (provider + schema). `markdown` kind removed from claude and gemini provider catalogs; their `classify` no longer returns `'markdown'` for any path. `src/kernel/orchestrator.ts` adds a per-scan `Set<path>` to dedup across the multi-Provider walk. The `core` bundle gains `coreMarkdownProvider` (granularity stays `extension` — disable-able like every other core item).

  **Breaking** (per the pre-1.0 minor convention — see CONTRIBUTING.md / `spec/versioning.md` §Pre-1.0): the `Node.provider` value for files at `notes/`, `.claude/hooks/`, `CLAUDE.md`, and arbitrary root-level `.md` files changes from `'claude'` (or `'gemini'` for `GEMINI.md`) to `'markdown'`. Downstream consumers that filtered nodes by `provider === 'claude' && kind === 'markdown'` need to query `kind === 'markdown'` only.

- f0ddae0: Move the cross-vendor Extractors out of the `claude` plugin bundle and into `core`, and rename `frontmatter` → `annotations` to reflect the post-Step 9.6 reality that the canonical home for those structured references is the sidecar `.sm` `annotations:` block (Decision #125), not the markdown frontmatter.

  **Qualified-id changes**

  - `claude/frontmatter` → `core/annotations`
  - `claude/slash` → `core/slash`
  - `claude/at-directive` → `core/at-directive`

  The `claude` bundle now contains only `claudeProvider` (path classification + frontmatter parser). The Extractors moved into `core` (`granularity: 'extension'`), so each is now independently toggleable via `sm plugins disable core/<id>`. Previously these extractors lived under the `claude` bundle (`granularity: 'bundle'`) and could only be removed by disabling the whole Claude integration — the same `gemini` and `agent-skills` Provider bundles already reused them implicitly with an apologetic comment in `built-ins.ts`.

  **Why now.** The three Extractors are universal:

  - `slash` matches `/<command>` (every coding-agent platform — Claude, Gemini, Cursor, Aider — uses slash commands).
  - `at-directive` matches `@<handle>` with both GitHub-style (`@scope/name`) and namespace-style (`@ns:verb`) forms.
  - `annotations` (née `frontmatter`) reads `requires` / `related` / `supersedes` / `supersededBy` / `conflictsWith`, all defined in the skill-map spec, not in Claude's conventions; the canonical source moved to the sidecar in Step 9.6 with a transitional fallback to legacy frontmatter `metadata:`.

  Keeping them under `claude/` was deuda histórica from when Claude was the only Provider. Moving them to `core` resolves the apologetic Gemini comment and matches the architectural reality.

  **Surface changes**

  - `src/built-in-plugins/extractors/frontmatter/` → `src/built-in-plugins/extractors/annotations/`. Module export `frontmatterExtractor` → `annotationsExtractor`. `pluginId: 'claude'` → `'core'`. Docstring rewritten so the sidecar is the canonical surface and the legacy fallback is documented as transitional.
  - `src/built-in-plugins/extractors/{slash,at-directive}/index.ts` — `pluginId: 'claude'` → `'core'`.
  - `src/built-in-plugins/built-ins.ts` — three Extractors moved out of the `claude` bundle (now Provider-only) into `core`. The apologetic comment in the `gemini` bundle is gone (reuse is now structural). Top-level docstring rewritten to describe the new bundle layout.
  - `spec/architecture.md` § A.6 — namespace description updated to make `core/` the home of cross-vendor Extractors and vendor bundles strictly the Provider home.
  - `spec/plugin-author-guide.md` § Qualified extension ids — built-in inventory table reflects the new ids; § Granularity table updated to use `claude/claude` as the bundle-granularity rejection example.
  - `spec/db-schema.md` § `scan_extractor_runs` — example qualified id updated.
  - `spec/schemas/extensions/base.schema.json` — qualified-id description example updated.
  - `src/built-in-plugins/README.md` — bundle table + descriptions updated.
  - `ROADMAP.md` and `.changeset/view-contributions-system.md` — adopter mentions cross-reference the rename.
  - Tests: `src/test/built-ins-modes.test.ts`, `src/test/plugin-runtime-branches.test.ts`, `src/test/plugins-cli.test.ts`, `src/test/kernel.test.ts`, `src/built-in-plugins/extractors/extractors.test.ts`, `src/built-in-plugins/rules/rules.test.ts`, `src/built-in-plugins/formatters/ascii/ascii.test.ts`, `src/built-in-plugins/rules/validate-all/validate-all.test.ts`, `ui/src/app/components/linked-nodes-panel/linked-nodes-panel.spec.ts`, `ui/src/services/data-source/static-data-source.spec.ts` — qualified-id catalogue, `pluginId` assertions, fixture `sources` arrays, and the bundle-granularity rejection test all updated to the new ids and describe-block names.

  **Migration**

  - Persisted `config_plugins` rows referencing the old qualified ids (none of the moved Extractors had a useful bundle-granularity disable target, but if any user explicitly enabled / disabled `claude/<id>` it now no-ops; redo the toggle against `core/<id>`).
  - The scan caches (`scan_extractor_runs`, `node_enrichments`, `scan_contributions`) self-revalidate: rows keyed by the old qualified id `claude/<id>` quietly become orphan and are swept on the next scan; new rows land under `core/<id>`. No migration code required.

  **Out of scope.** The legacy `metadata:` frontmatter fallback inside the `annotations` Extractor stays in this bump to keep the diff to "rename + move". A follow-up bump removes it and tightens the docstring once the migration is confirmed complete across observed projects.

  **Pre-1.0 minor bump.** Per `spec/versioning.md` § Pre-1.0 and `AGENTS.md`, breaking changes ship as minors while a workspace is in `0.Y.Z`.

- d7ddd08: Drop the `parsed` view contribution from `core/annotations`.

  The extractor declared `viewContributions: { parsed: { contract: 'node-key-values', label: 'Frontmatter', ... } }` and emitted a flat key/value projection of the frontmatter top-level scalars to the inspector. With the inspector card already surfacing `title`, `description`, `version`, and `stability` as first-class node fields denormalised by the kernel, the panel was a redundant copy of data the user already saw one click higher. Reclassified as a misadopter of the view contribution system: contributions are for plugin-derived data, and frontmatter scalars live on `node.frontmatter` as a first-class kernel field served directly by the BFF.

  **Surface changes**

  - `src/built-in-plugins/extractors/annotations/index.ts` — `viewContributions` block removed, `ctx.emitContribution('parsed', ...)` call removed, `scalarFrontmatterEntries` helper removed. Module docstring updated. Extractor is now single-purpose: emits links from sidecar annotations.
  - `src/built-in-plugins/README.md` — inventory row updated.
  - `ROADMAP.md` — built-in adopter list and decision table reflect that only `core/external-url-counter` survives as a built-in adopter.

  **Persistence**: no SQL migration. The `scan_contributions` table's catalog sweep (`replaceAllScanContributions` with `registeredContributionKeys`) drops orphan rows whose `<plugin_id>:<extension_id>:<contribution_id>` triple is not in the live catalog; rows for `core:annotations:parsed` go away on the next scan.

  **UI**: the `<sm-view-contributions-host>` slot host is unaffected (no slot binds to `core/annotations:parsed` specifically). The `node-key-values` contract and its renderer (`NodeKeyValues` in `ui/src/app/contracts/contract-renderer-map.ts`) stay in the closed catalog — available for future adopters, just not consumed by any built-in extension today.

  **Pre-1.0 minor bump** per `spec/versioning.md` § Pre-1.0. Users who relied on the "Frontmatter" inspector panel: the data shown there (`title`, `description`, etc.) is already rendered on the node card directly; arbitrary custom frontmatter scalars are no longer surfaced — open the markdown file directly to read them, or wait for the upcoming inspector slot redesign.

- 454311c: Drop the transitional legacy `metadata:` frontmatter fallback from `core/annotations`. The extractor now reads structured references (`supersedes`, `supersededBy`, `requires`, `related`, `conflictsWith`) **only** from the sidecar `.sm` `annotations:` block (Decision #125 / Step 9.6 canonical surface). The `core/superseded` rule follows the same path and now reads from the sidecar.

  **Why.** The fallback was carried as a transition aid while early projects migrated their structured refs from frontmatter to sidecars. The migration is complete in our reference projects, the canonical surface is the sidecar, and keeping the fallback split the source of truth across two surfaces with no real consumer left behind. Removing it shrinks `core/annotations` to a single-source extractor and aligns the docstring with the runtime behaviour.

  **Surface changes**

  - `src/built-in-plugins/extractors/annotations/index.ts` — `pickMetadata` helper removed; `extract()` no longer reads `ctx.frontmatter.metadata`. Docstring rewritten so the sidecar is the only source. The `seen` dedup set keeps catching repeats across the structured arrays (`requires` / `related` / `conflictsWith` listing the same target) but no longer needs cross-source dedup.
  - `src/built-in-plugins/rules/superseded/index.ts` — reads `node.sidecar.annotations.supersededBy` instead of `node.frontmatter.metadata.supersededBy`. Skips nodes without a present sidecar. Manifest description and module docstring updated.
  - `src/built-in-plugins/rules/broken-ref/index.ts` — docstring fixed (the rule already read `frontmatter.name`; the comment incorrectly referred to `metadata.name`).

  **Tests**

  - `src/built-in-plugins/extractors/extractors.test.ts` — `annotations extractor` describe block rewritten: every test now seeds the sidecar overlay (`withAnnotations(...)`); legacy `metadata:` fixtures replaced by sidecar inputs. Adds an explicit guard test "ignores legacy frontmatter `metadata:` (sidecar is the only source)".
  - `src/built-in-plugins/rules/rules.test.ts` — `mockNode` helper packs `extraMeta` into `node.sidecar.annotations` instead of `node.frontmatter.metadata`. The `ignores nodes with no metadata block` test renamed to `ignores nodes with no sidecar annotations`.
  - `src/test/scan-e2e.test.ts`, `src/test/scan-incremental.test.ts`, `src/test/scan-persistence.test.ts`, `src/test/scan-readers.test.ts`, `src/test/broken-ref-trigger-resolution.test.ts` — fixtures migrated from inline `metadata:` blocks to co-located `.sm` sidecars. Each test that exercised structured-link emission now does a baseline scan to capture real `body` / `frontmatter` hashes, then writes the sidecar with those hashes (the sidecar reader marks status `fresh` only when both hashes match the live file). The `before(() => ...)` setup hooks become `before(async () => ...)` where needed.

  **Persistence.** No SQL migration. The scan caches (`scan_extractor_runs`, `node_enrichments`) self-revalidate on the next scan; rows attributed to the prior `metadata:`-fed annotations stay in the cache as orphans until invalidated.

  **Pre-1.0 minor bump.** Per `spec/versioning.md` § Pre-1.0 and `AGENTS.md`, breaking changes ship as minors while a workspace is in `0.Y.Z`. Any project that still has `metadata: { supersedes / requires / related / supersededBy / conflictsWith }` in markdown frontmatter loses those edges silently on the next scan; migrate them into a co-located `.sm` `annotations:` block.

- b3ba3de: Drop the four denormalised fields (`title`, `description`, `stability`, `version`) from the public `Node` surface. The DB columns survive as indexing surface; the JSON wire shape and TypeScript `Node` interface no longer carry them.

  The kernel used to project those four into `Node.{title,description,stability,version}` from their canonical sources (`frontmatter.{name,description}` and `sidecar.annotations.{stability,version}`) so consumers had a single flat read surface. With the inspector slot redesign incoming and the explicit decision to read directly from the canonical surfaces, the alias became redundant: same data, two paths, one of them unnecessary indirection.

  The DB columns (`scan_nodes.{title,description,stability,version}`) stay so SQL-backed verbs (`sm list --sort-by`, faceted listings) keep their indexing fast path. The persistence layer projects the columns at write time from the canonical sources rather than from kernel-set Node fields. That keeps SQL ergonomic without polluting the API.

  **Surface changes**

  - `spec/schemas/node.schema.json` — `title` / `description` / `stability` / `version` removed from the property list. The schema's curated public shape now matches the runtime `Node` interface.
  - `src/kernel/types.ts` — `Node` interface drops the four fields. `Stability` type stays (used by extension manifests).
  - `src/kernel/orchestrator.ts` — `buildNode()` no longer populates the dropped fields; `applyAnnotationsOverlay()` removed (its only job was to set `node.{stability,version}` from the sidecar, now done at persistence-projection time).
  - `src/kernel/adapters/sqlite/scan-persistence.ts` — `nodeToRow()` projects the four columns from `node.frontmatter` and `node.sidecar?.annotations` via three small helpers (`pickString`, `pickStability`, `pickIntegerVersion`).
  - `src/kernel/adapters/sqlite/scan-load.ts` — `rowToNode()` no longer rehydrates the four fields onto Node. Storage adapter consumers that need them read the row directly.
  - `src/cli/commands/show.ts` — `collectNodeFields()` projects render-time via a new `projectAnnotationFields(node)` helper. Trio of single-purpose pickers added (`pickNonEmptyString`, `pickStabilityFromAnnotation`, `pickIntegerVersionFromAnnotation`) keep complexity ≤ 8.
  - `src/cli/commands/export.ts`, `src/built-in-plugins/formatters/ascii/index.ts` — `pickTitle()` reads `frontmatter.name` directly.
  - `src/built-in-plugins/rules/validate-all/index.ts` — `toNodeForSchema()` projection drops the four fields (they're no longer in `node.schema.json`).
  - `ui/src/models/api.ts` — `INodeApi` drops the four fields. The unused `TStability` import is gone.
  - `ui/src/services/collection-loader.ts` — `projectNode()` no longer falls back to `api.{title,description}`; reads directly from `frontmatter.{name,description}`.

  **Tests** — fixtures and assertions across `node-enrichments.test.ts`, `render-sanitize-invariant.test.ts`, `scan-incremental.test.ts`, `server-query-adapter.test.ts`, `sidecar-reader.test.ts`, and the conformance case `sidecar-end-to-end.json` updated. The `node-enrichments` test uses the dropped fields as opaque sentinels to verify enrichment buffer mechanics; those sites cast through `unknown as Partial<Node>` with an explanatory comment — the persistence layer JSON-serialises the bag verbatim, so the round-trip works regardless of the strict Node typing.

  **Migration** — consumers that read `node.title` migrate to `node.frontmatter?.name`; same shape for `description` (`frontmatter.description`), `stability` (`sidecar.annotations.stability`), and `version` (`sidecar.annotations.version`). DB queries that filter or sort by these columns work unchanged.

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.

- 22f4439: Reduce the Extractor extension kind to **deterministic-only**. The `mode` field is removed from `extractor.schema.json`; `IExtractor` no longer carries `mode`; `IExtractorContext` no longer exposes `ctx.runner`. `Extractor` joins `Provider` and `Formatter` as an extension that sits on the deterministic scan path; LLM-driven enrichment of a node is now strictly an **Action** concern, queued through the job subsystem.

  **Why.** A "probabilistic Extractor" never actually ran during `sm scan` — it always dispatched as a job — so the dual-mode declaration was nominal, not operational. The pipeline still carried the cost: `ctx.runner` injection, the `body_hash_at_enrichment` / `stale` / `is_probabilistic` columns, the schema branch, the orchestrator's `isProb` guard. Zero Extractors with `mode: 'probabilistic'` shipped in the repo. Reducing Extractor to deterministic-only collapses an awkward dual-mode into "Extractor = pure transform over a node body; if you want LLM, write an Action".

  **Surface changes**

  - `spec/schemas/extensions/extractor.schema.json` — `mode` removed.
  - `spec/architecture.md` — capability matrix updated (Extractor → deterministic-only); `§Extractor · enrichment layer` rewritten; the stability note documents that pre-1.0 narrowing a kind from dual-mode to single-mode is permitted as a minor bump.
  - `spec/plugin-author-guide.md` — probabilistic tag-inferrer example replaced with a deterministic frontmatter-tag example; six-categories table updated; `ctx.runner` mention removed for Extractors.
  - `spec/db-schema.md` — `node_enrichments.{stale, body_hash_at_enrichment, is_probabilistic}` documented as **reserved-but-inert** (always `0` for Extractor writes); kept on the row for a future Action-issued probabilistic enrichment revision so the persistence contract does not need a migration when that revision lands.
  - `spec/cli-contract.md` — `sm refresh <node>` and `sm refresh --stale` no longer reference the prob-stub state; `--stale` is a no-op in this revision.
  - `src/kernel/extensions/extractor.ts`, `src/kernel/orchestrator.ts` — `mode` and `runner` removed; the orchestrator's enrichment record always sets `isProbabilistic: false`.
  - `src/cli/commands/refresh.ts`, `src/cli/i18n/refresh.texts.ts` — prob-skip path removed; `Persisted N enrichment row(s)` replaces `Persisted N deterministic enrichment row(s)`.
  - `src/built-in-plugins/extractors/*/index.ts` — five built-in extractors no longer declare `mode: 'deterministic'`.
  - `src/migrations/001_initial.sql`, `src/kernel/adapters/sqlite/schema.ts` — comments updated; columns retained (greenfield, no migration; the row shape is forward-compatible with the future revision).
  - `src/test/built-ins-modes.test.ts` — invariant flips: extractors must NOT declare `mode` (matching Provider / Formatter).
  - `src/test/node-enrichments.test.ts` — Test (d) removed (prob-extractor body-change → stale-flag), `buildProbEnricher` helper removed; the merge contract test (e) keeps hand-built stale rows so the helper's filter behaviour stays pinned for the future revision.

  **Pre-1.0 minor bump.** Per `spec/versioning.md` §Pre-1.0 and `AGENTS.md`, breaking changes ship as minors while a workspace is in `0.Y.Z`. No released consumer depended on Extractor `mode: 'probabilistic'` (zero in built-ins, fixtures, conformance, e2e); the future Action-issued enrichment revision opens a clean path for the same use case from inside the job lifecycle.

  **Out of scope (deferred to Phase B / Step 11).** How a probabilistic Action writes data persistent to a node (enrichment, sidecar, etc.). Today an Action emits a `report_json` plus an optional `TActionWrite[]` array (`{ kind: 'sidecar' }` is the only variant); the future revision will extend the discriminated union with `{ kind: 'enrichment' }` so a probabilistic Action can populate `node_enrichments` directly. That change is independent of this one and lands when the first real probabilistic Action (skill-summarizer or equivalent) needs it.

- e636074: Fold every post-001 SQLite kernel migration into `001_initial.sql`: the original four (`002_sidecar_columns.sql`, `003_drop_node_author.sql`, `004_sidecar_root_json.sql`, `005_node_favorites.sql`) plus the later `002_view_contributions.sql` introduced after the first fold by the view contribution system. Pre-1.0 greenfield consolidation — no released consumer depends on the historical migration steps, so collapsing the schema evolution into a single up-only migration removes the per-step bookkeeping cost and gives new databases the final shape on first init. The runner now sees `user_version: 1` as the latest. Schema content unchanged from the pre-fold endpoint (sidecar denormalisation via `sidecar_present` / `sidecar_status` / `annotations_json`, `author` column dropped from `scan_nodes`, `sidecar_root_json` column, `state_node_favorites` table, `version INTEGER` per Decision #125, plus `scan_contributions` table from the view contribution system).

  **Breaking** (per the pre-1.0 minor convention — see CONTRIBUTING.md / `spec/versioning.md` §Pre-1.0): the schema reset means existing `.skill-map/skill-map.db` files from a pre-fold install need to be wiped (`rm -rf .skill-map/`) before re-running `sm init`; downstream users on built-from-source forks are advised the same.

- 40d0a81: Two small wire enrichments that the new Settings modal needs:

  **`GET /api/plugins` items now carry `description?: string`** — both at the bundle level and inside each `extensions[]` entry. The bundle's value is sourced from `IBuiltInBundle.description` for built-ins (now a required field on the type — every built-in bundle declares its summary inline at `built-in-plugins/built-ins.ts`) and from `plugin.json#/description` for user plugins. Each extension entry's value comes from its own manifest's `description` per `IExtensionBase` (`extensions/base.schema.json#/properties/description`). The SPA's Settings list renders the descriptions as muted secondary text and folds them into the substring-search index alongside the ids, so authors can ship discoverable copy without needing a separate docs round-trip.

  **`GET /api/health` now carries `cwd: string` and `dbPath: string`** — both absolute. `cwd` is the project root the BFF resolves against (`runtimeContext.cwd`); `dbPath` mirrors `IServerOptions.dbPath`. The companion `db: 'present' | 'missing'` field still reports whether the file exists; the new fields tell the operator where to find it. Surfaced so the SPA's About panel can render "you are looking at <project>" plus the DB location without a second endpoint.

  Both additions are forward-compatible: existing health clients ignore the new fields, and existing plugins UI consumers tolerate the absence of `description` (it's optional on the wire).

- 40d0a81: Add `POST /api/scan` so the SPA's topbar refresh button can trigger a manual scan + persist without dropping the user back to the CLI. The same `runScanWithRenames` + `persistScanResult` pipeline the watcher uses runs end-to-end inside the BFF, broadcasting `scan.started` then `scan.completed` over `/ws` so every connected client refreshes — `CollectionLoaderService`'s reactive subscription already handles the SPA side.

  **Mutex**

  A process-level latch (`src/server/scan-mutex.ts`) prevents two POSTs from racing each other. Only the manual POST holds the latch; the watcher's debounced batches stay outside it because `createWatcherRuntime` already serializes its own batches and SQLite WAL serializes the persist transactions, so a watcher × POST race is benign at the storage layer. The latch's job is honest user feedback ("Scan in progress, retry shortly") when their second click arrives before the first scan resolves, not global serialization.

  **Errors**

  - `409 scan-busy` (new envelope code) — another POST is already in flight. The 409 status is shared with `POST /api/sidecar/bump`'s `sidecar-fresh`, so `app.onError` discriminates by message prefix (`scan-busy:` vs `sidecar-fresh:`); both prefixes were already conventions in the catalog.
  - `400 bad-query` — server booted with `--no-built-ins` or `--no-plugins`. Same gate the existing `?fresh=1` GET applies, for the same reason: a partial pipeline would persist a misleading DB.
  - `500 db-missing` — project DB absent. Read paths degrade to the empty shape; mutations cannot.

  **UI** (private workspace, no separate version bump)

  - Topbar refresh button (`pi pi-refresh`) sits between the theme toggle and the settings gear. Tooltip carries the same `X nodes · Y links` counts as the previous info icon. Click → `dataSource.runScan()`; the icon spins (`pi-spin`) and the button is `disabled` while the scan is in flight. Test id: `shell-refresh`.
  - New port method `IDataSourcePort.runScan(): Promise<IScanResultApi>` — `RestDataSource` posts to `/api/scan`; `StaticDataSource` rejects with `code: 'demo-readonly'` (the static bundle is immutable).
  - The button does NOT manually re-fetch from the loader after the response — the route's WS broadcast already triggers the loader's reactive refresh. The `await this.loader.load()` in the click handler is a belt-and-suspenders fallback for the demo path (no WS) and for races where the WS event fires before the POST promise resolves.

  **Internal**

  - `IScanRunOpts.emitterFactory` (new optional field on `core/runtime/scan-runner.ts`) — when set, the runner threads the supplied emitter into `runScanWithRenames` instead of building a stderr-bound progress emitter. The watcher already uses the same pattern; the BFF's `POST /api/scan` route now reuses it to plug the broadcaster.
  - `buildBroadcasterEmitter` in `src/server/watcher.ts` is now exported so the new route can wire the same emitter the watcher uses.

- 496fb72: Complete the `IAnalyzerContext.emitContribution` runtime channel and add `core/link-counts` built-in rule.

  The view-contribution surface had a half-implemented seam: any extension's manifest could declare `viewContributions`, the catalog (`kernel.getRegisteredViewContributions()`) recognised Rule declarations, but `IAnalyzerContext` had no `emitContribution` callback so a Rule's `evaluate()` had no way to actually emit. Extending `IAnalyzerContext` with `emitContribution(nodePath, contributionId, payload)` completes the seam.

  The first adopter is `core/link-counts` — a built-in Rule that emits two `node-counter` contributions per node (`linksOut`, `linksIn`) based on the post-merge graph. The data lives on `node.linksOutCount` / `node.linksInCount` already; the Rule projects it into the view contribution system so slot-aware UI surfaces (graph cards, inspector chips) render the counts uniformly with any plugin contribution. Skips emit when count is 0 to avoid empty panels.

  External URL counts (`core/external-url-counter`) keep their existing extractor-emit path; this change adds a sibling Rule, not a refactor.

  **Surface changes**

  - `src/kernel/extensions/rule.ts` — `IAnalyzerContext.emitContribution(nodePath, contributionId, payload)` added.
  - `src/kernel/orchestrator.ts` — `runRules()` builds a per-rule emission buffer with the same validator + persist semantics as the Extractor path; `RunScanOptions` adds `viewContributions?` (parallel to `annotationContributions?`). The `readDeclaredContributions` helper is generalised from `IExtractor` to any extension that carries `viewContributions` (structural typing).
  - `src/built-in-plugins/rules/link-counts/index.ts` — new built-in.
  - `src/built-in-plugins/built-ins.ts` — `linkCountsAnalyzer` registered under `core` bundle; built-in count rises from 21 to 22 (and rules from 10 to 11).
  - `spec/architecture.md` § View contribution system → Emit path — Rule-emit signature documented alongside the Extractor signature; both routed to the same `scan_contributions` rows. The reserved `emitScopeContribution` for scope-stat is noted as still pending.

  **Tests**

  - `src/built-in-plugins/rules/link-counts/link-counts.test.ts` — unit tests for the rule's evaluate logic + integration test that runs the orchestrator end-to-end and asserts the persisted contribution rows.
  - `src/test/built-ins-modes.test.ts` — total built-ins count bumped 21 → 22.
  - `src/test/plugin-runtime-branches.test.ts` — composed.rules.length asserts bumped 10 → 11; rule id list updated.
  - `src/built-in-plugins/rules/rules.test.ts`, `src/built-in-plugins/rules/validate-all/validate-all.test.ts`, `src/test/unknown-field-rule.test.ts` — test contexts now supply a noop `emitContribution` (required field on the new `IAnalyzerContext`).

  **Persistence**: no SQL migration. The `scan_contributions` table is agnostic to the emitting kind; Rule emissions land in the same rows as Extractor emissions. The orphan sweep + catalog sweep semantics keep working unchanged.

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.

- 2b44d6c: Settings → Changelog tab + user-facing changelog pipeline.

  The Settings modal's "Changelog" sidebar entry was a `coming-soon` placeholder. It now renders the user-facing release notes — newest-first, bullet list per version, package pills after each highlight. Read-only by design (the same JSON ships with the SPA in both live and demo modes; no BFF call).

  **Authoring convention.** Each `.changeset/*.md` that bumps `@skill-map/cli` may end with an optional `## User-facing` H2 section — a short user-focused note (markdown allowed: `inline code`, **emphasis**, [links](#)). The technical body above stays unchanged for the auto-generated `CHANGELOG.md`.

  **Pipeline.** The new `scripts/build-user-changelog.js` runs as the FIRST step of `npm run release:version` (before `changeset version` consumes the changesets). It:

  - Walks every `.changeset/*.md`, parses YAML frontmatter, extracts the `## User-facing` markdown body when present.
  - Computes the next `@skill-map/cli` version from the pending bumps (max bump type, pre-1.0 cap).
  - Prepends a single new entry to `ui/src/data/user-changelog.json` consolidating every changeset that bumps the CLI.
  - Idempotent: if the top entry already targets the same version, the script no-ops.
  - Releases with zero `## User-facing` sections produce a `kind: 'internal'` placeholder so the version still appears with a "focus on stability and infra" line — versions don't silently disappear from the user changelog.

  **Surface changes**

  - `ui/src/app/components/settings-modal/settings-changelog.{ts,html,css}` — new component. Renders entries via `MarkdownRenderer` (the same markdown-it + DOMPurify path the inspector body uses); each highlight body becomes a bullet, package list becomes mono pills.
  - `ui/src/data/user-changelog.{ts,json}` — typed JSON data + interfaces. Seed contains two manually-authored entries (0.18.0, 0.17.0) so the panel shows content from day one. Future releases populate via the script.
  - `ui/src/app/components/settings-modal/settings-modal.{ts,html}` — `changelog` section flips from `coming-soon` to `available`, new `<sm-settings-changelog />` mount in the `@switch`.
  - `ui/src/i18n/settings.texts.ts` — Changelog section strings.
  - `package.json` (root) — `release:version` now runs `node scripts/build-user-changelog.js` before `changeset version`.
  - `AGENTS.md` — new rule documenting the `## User-facing` convention.
  - `.claude/agents/commit.md` — commit skill updated with §6.1 (decide whether to add `## User-facing`) plus a quick-reference decision tree and a "doesn't edit user-changelog.json directly" entry.

  **Side fixes shipped together**

  - `ui/src/app/components/settings-modal/settings-about.ts` — Project DB now shows the path **relative to** the Project Folder row above (`.skill-map/skill-map.db`) instead of the absolute redundant prefix. The status word `present` is dropped from the value when the DB is wired up — the path alone is enough; non-`present` states (e.g. `missing`) keep the indicator.
  - `ui/src/app/services/update-check.ts` — `load()` short-circuits when the runtime mode is `demo`. The static demo bundle has no BFF; the previous unconditional `fetch('/api/update-status')` 404'd in demo mode and broke the e2e smoke suite. Reads via `readSkillMapModeFromMeta()` directly (not through DI) so existing unit tests that construct the service via `new` outside of an injection context keep passing.
  - `e2e/smoke/demo.spec.ts` — "boots without console errors" test now correlates `requestfailed` events with the generic `Failed to load resource:` console messages and ignores third-party asset failures (Google Fonts CDN). The `/api/*` guard test stays intact: that's the demo bundle's actual contract.
  - `scripts/dev-reset.sh` — new `--target=demo` mode that wipes `fixtures/demo-scope/.skill-map/` and re-inits. Unblocks the `npm run demo:build` chain when the demo fixture's DB falls behind a kernel migration consolidation.

  ## User-facing

  **Settings → Changelog.** The Changelog tab in Settings now lists what's new in skill-map: one entry per release, newest first, bullet points for the user-facing changes plus the workspace(s) each change affected. The same content is bundled with the demo so it's available offline too. The tab populates automatically on every release.

  **Project DB path.** The "Project DB" row in Settings → About now shows the path relative to your project folder (`.skill-map/skill-map.db`) instead of repeating the absolute prefix already shown in the row above. Cleaner, less redundant.

- 40d0a81: Add a global Settings modal in the SPA with a Plugins section — the first user-facing surface for toggling installed plugins from the UI. Backed by two new BFF mutation endpoints and an enriched `GET /api/plugins` shape.

  **BFF**

  - `PATCH /api/plugins/:id` — toggle a granularity=`bundle` plugin's user override. Body `{ enabled: boolean }`. Persists to `config_plugins` via the same `IConfigPluginsPort.set` path the CLI's `sm plugins enable / disable` uses. Response: the projected list (same shape as `GET /api/plugins`) so callers replace state in one shot.
  - `PATCH /api/plugins/:bundleId/extensions/:extensionId` — qualified-id form for granularity=`extension` bundles (today: `core` plus any user plugin that opts in).
  - Granularity is enforced symmetrically: bundle-form against an extension-only bundle returns 400 `bad-query`; qualified-form against a bundle-only target returns the same. Unknown plugin / extension ids return 404 `not-found`. Missing project DB returns 500 `db-missing` (read-side endpoints still degrade to empty shapes; mutations cannot persist without a DB so they fail fast).
  - `GET /api/plugins` items now carry `granularity: 'bundle' | 'extension'` and an optional `extensions[]` array (present only for granularity=`extension` plugins) so the UI can render expandable per-extension toggles for `core` without a second round-trip.

  **Restart caveat**

  The loaded plugin runtime is boot-cached; toggle changes apply on the next `sm scan` or `sm serve` restart. The endpoint does NOT broadcast a WS event today. The Settings modal renders a persistent `<p-message severity="warn">` banner ("Restart required") so users aren't surprised when their toggle doesn't immediately re-render the graph.

  **UI** (private workspace, no separate version bump)

  - Gear icon in the topbar (`shell__actions`) opens a PrimeNG `p-dialog` modal. The modal is `@defer`-loaded so the Dialog + ToggleSwitch + Message chunks (~57 KB) only ride the wire on first open.
  - Each plugin row is one `p-toggleswitch` for granularity=`bundle`; granularity=`extension` rows expand to reveal per-extension toggles. Failure-mode plugins (`incompatible-spec`, `invalid-manifest`, `load-error`, `id-collision`) render with their reason and no toggle (toggling enabled doesn't unbreak a broken plugin).
  - Test ids per the project convention: `action-settings`, `settings-modal`, `settings-banner-restart`, `settings-row-<id>`, `settings-toggle-<id>`, `settings-bundle-expand-<id>`, `settings-extrow-<bundle>-<ext>`, `settings-ext-toggle-<bundle>-<ext>`.

  **Decision: no hot-reload**

  Toggling does not recompose the plugin runtime in-process. A hot-reload path would need to invalidate the kind registry, contributions registry, route-level decorators, and any in-flight scan; all for a modal that's used once or twice per session. The restart caveat is the spec'd contract; revisit if and when watcher-driven toggles become a common workflow.

- 68709b9: Sidecar schema cleanup: rename root block `for:` → `identity:` and drop the unused `hidden` field from the curated annotations catalog.

  **Mental model.** A `.sm` sidecar is, conceptually, the annotations file for its `.md` node — every key under it is an annotation. The YAML root organises those annotations into structural blocks: `identity` (anchor + drift hashes), `annotations` (curated catalog), `audit` (timestamps), `settings` (reserved), and `<plugin-id>:` namespaces. The schema and docs now lead with that framing.

  **`for:` → `identity:`.** The block was always semantically about anchoring the sidecar to its node and tracking drift hashes — `for:` was concise but cryptic and got mistaken for "metadata about the node". Renamed to `identity:` everywhere: schema, parser, store, bump action, scaffold helper, fixtures, docs, UI debug panel.

  **`hidden` removed.** The curated catalog declared `annotations.hidden` for "exclude from default listings" but nothing in the runtime ever consumed it (no `--include-hidden` flag, no list filter). Dead spec surface. Dropped from the schema; the catalog now stands at **13 fields**. The matching UI rendering is gone too.

  **Surface changes**

  - `spec/schemas/sidecar.schema.json` — top-level `for` property renamed to `identity`; `required: ['for']` → `required: ['identity']`. Root description updated to lead with the "annotations file" mental model. `$defs.identity` was already named correctly; only the property reference moved.
  - `spec/schemas/annotations.schema.json` — `hidden` property removed. Description bumped from "load-bearing 14 fields" to "13 fields".
  - `spec/schemas/node.schema.json` — `Node.sidecar.root` description updated: reserved blocks list now reads `identity / annotations / settings / audit`; example sub-paths use `root.identity.*`.
  - `spec/architecture.md` — § Annotation system rewritten to lead with the mental model; identity contract uses `identity.path` / `identity.bodyHash` / `identity.frontmatterHash`. `display (hidden)` dropped from the curated-catalog enumeration.
  - `spec/cli-contract.md`, `spec/plugin-author-guide.md` — example sidecars use `identity:` blocks.
  - `spec/conformance/fixtures/**/*.sm` — three fixture sidecars updated.
  - `src/kernel/sidecar/parse.ts` — reads `root['identity']`; `IParsedSidecar` fields `forBodyHash` / `forFrontmatterHash` / `forPath` renamed to `identityBodyHash` / `identityFrontmatterHash` / `identityPath`.
  - `src/kernel/orchestrator.ts` — drift detection consumes the renamed fields.
  - `src/built-in-plugins/actions/bump/index.ts` — patch object emits `identity:` instead of `for:`.
  - `src/built-in-plugins/rules/unknown-field/index.ts` — `RESERVED_ROOT_BLOCKS` set updated.
  - `src/cli/commands/sidecar.ts` — `sm sidecar refresh` and `sm sidecar annotate` write the renamed block.
  - `ui/src/app/components/inspector-debug-panel/*` — `forBlock` / `IForBlock` renamed to `identityBlock` / `IIdentityBlock`.
  - `ui/src/app/components/annotations-panel/*` — `hidden` rendering removed (template, taxonomy section, texts catalog, spec).
  - All test fixtures (`src/test/**`, UI specs, e2e) updated to use `identity:` blocks.

  **Migration**: every `.sm` file in the wild that uses the old `for:` block is now invalid against the schema. The right fix per node:

  - Open the `.sm`.
  - Rename the top-level key from `for:` to `identity:` (no value changes).
  - Save.

  A future `sm migrate` action could automate this; for now manual edit is the path. The kernel's parser will fail closed (`invalid-sidecar` issue) on a non-renamed file, so missed migrations surface at scan time.

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.

- 8577563: Tags · click-to-multi-select via Foblex Flow's native selection.

  Replaces the reverted filter / fade approach. Clicking a tag chip in the inspector annotations panel computes every node whose `frontmatter.tags` ∪ `sidecar.annotations.tags` carries the tag and feeds them to `FFlowComponent.select(paths, [])`. Foblex paints the matching nodes with `.f-selected` on the host element; the visual halo lives outside the existing single-focus selection ring so both can coexist on the same card.

  **Why this approach over the previous fade-out**

  The previous filter-driven fade collided with the selection-driven adjacency dim — both used the same `.sm-gnode--dimmed` class, so combining "selected node + adjacency-dim + tag-filter" looked identical to "selected node + adjacency-dim". The new design uses a separate visual layer (Foblex's `.f-selected` host class) that does NOT inherit opacity-dim semantics; the multi-select halo reads as "highlighted across the graph" without competing for the dim channel.

  **Surface changes**

  - `<sm-annotations-panel>` chips become `role="button"` with `(click) / (keydown.enter) / (keydown.space)` → emits `(tagClick)` carrying the tag string. Tooltips dropped (the chip's `--author` / `--user` outline already conveys attribution). The panel renders the Taxonomy section even without a sidecar overlay (when `frontmatter.tags` is non-empty) so frontmatter-only nodes (`GEMINI.md`, `README.md`, the Gemini agents / skills) surface their author tags too.
  - `<sm-node-card>` tag row paints dual-source — author chips outlined in primary, user chips filled — but stays read-only at this surface (clicks live on the inspector chip). The `tagChips` computed reads `frontmatter.tags` first then `sidecar.annotations.tags`, with legacy `metadata.tags` as the user-side fallback.
  - `<app-inspector-view>` forwards `(tagClick)` through a new `(tagSelect)` output. Decouples the panel from the graph: standalone-mode hosts can ignore it; the graph view in embedded mode wires it to Foblex's selection API.
  - `<app-graph-view>` adds `<f-selection-area />` inside `<f-flow>` so Shift+drag rectangle multi-select works natively. Also adds `flow.select(paths, [])` driven by the new `onTagSelect` handler. `activeTagSelection: signal<string | null>` tracks the active tag for toggle (clicking the chip whose tag is already active calls `flow.clearSelection()`).
  - `isDimmed` / `isEdgeDimmed` short-circuit to `false` while `activeTagSelection !== null` — the multi-select halo is the dominant visual then; stacking opacity 0.25 on top would make matching nodes read "selected but ghosted".
  - `graph-view.css` paints `.sm-gnode-host.f-selected` with a 3px primary ring on the inner card + a soft drop-shadow on the host. Composes with the existing `.sm-gnode--selected` (single-focus) ring instead of replacing it — a node that's both single-focused AND in the multi-select set carries both rings.
  - `inspector-view.html` annotations card gate widens from `n.sidecar?.present` to `n.sidecar?.present || authorTags().length > 0` so the card stays visible for frontmatter-only tag-bearing nodes.

  **Behaviour summary**

  - Click node body → panel opens, single-focus selection, adjacency-dim hides non-neighbours.
  - Click tag chip in panel → multi-select halo on every node carrying the tag (toggle: same chip clears). Adjacency-dim is **suspended** while the tag selection is active. Panel stays open.
  - Shift + drag on canvas → native rectangle multi-select via `<f-selection-area />`.
  - Click another tag → swap; click same tag → clear.

  **Out of scope (next iteration)**

  - Zoom-to-selection on tag click and zoom-restore on clear — the Architect explicitly flagged this as the next step; bookmarked for a follow-up patch.
  - List view multi-select equivalent — tags on the list view stay attribute-only for now.
  - Multi-tag composition (AND / OR) — single-tag covers the demo.

  **Fixture refresh** (`fixtures/local-scope/`): every `.md` now declares author tags (3-5 each, distributed for overlap). 32 distinct tags, 58 instances across 11 nodes — `gemini`×4, `review`×4, `quality`×3+1, `angular`×2+2, `frontend`×2+2 give multi-node match sets you can see at a glance. Sidecars of the five tagged-on-author nodes were re-bumped via `sm bump --pending` so identity hashes match.

  **Side fix**: `context/view-contributions.md` drops a stale plan path that no longer exists on disk.

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.

- 762aad3: Tags · Phases 2-7 (full implementation): persistence, BFF wire shape, CLI, UI.

  Phase 1 declared the dual-source tag system at the spec level (`frontmatter.tags` for author tags, `sidecar.annotations.tags` for user tags, both first-class). This bump lands the implementation end-to-end.

  **Phase 2 — DB schema + adapter**

  - `src/migrations/001_initial.sql` — new `scan_node_tags(node_path, tag, source)` table with `(node_path, tag, source)` PK, `CHECK source IN ('author','user')`, `(tag)` index for indexed search, `(node_path)` index for per-node projection.
  - `src/kernel/adapters/sqlite/schema.ts` — `IScanNodeTagsTable` interface added; registered on `IDatabase`.
  - `src/kernel/adapters/sqlite/tags.ts` — new adapter with `replaceAllScanTags(trx, records, livePaths)` (orphan-sweep + replace-all per-node), `loadTagsForNode(db, path)`, `loadTagsForPaths(db, paths)`, and `findNodesByTag(db, tag, source?)` for the CLI.

  **Phase 3 — Persistence projection**

  - `src/kernel/adapters/sqlite/scan-persistence.ts` — `nodesToTagRecords(nodes)` projects rows from BOTH `frontmatter.tags` (`source='author'`) and `sidecar.annotations.tags` (`source='user'`); per-source intra-array dedup; called inside the same persist transaction as `scan_nodes` / `scan_links` / `scan_contributions`. Cached nodes' tag rows project from the cached `node` (already in memory) so the rebuild is cheap regardless of cache hit / miss.

  **Phase 4 — BFF wire shape**

  - `ui/src/models/api.ts` — `INodeApi.tags?: { byAuthor: readonly string[]; byUser: readonly string[] }` + `ITagsApi` interface.
  - `src/kernel/ports/storage.ts` — `StoragePort.tags` namespace (`listForNode`, `listForPaths`, `findNodes`).
  - `src/kernel/adapters/sqlite/storage-adapter.ts` — wires the tags namespace from the `tags.ts` adapter helpers.
  - `src/server/routes/nodes.ts` — `/api/nodes/:pathB64` and `/api/nodes` (bulk) decorate every node with its `tags = { byAuthor, byUser }`. Bulk path keeps the round-trip count at one (one query for contributions + one for tags) regardless of page size.
  - `src/server/routes/scan.ts` — `/api/scan` (the SPA's F5 / cold-boot canonical corpus) decorates the same way; tags + contributions loaded via `Promise.all` to keep the latency profile flat.

  **Phase 5 — CLI**

  - `src/cli/commands/list.ts` — new `--tag <name>` flag (matches author OR user tag, indexed `WHERE tag = ?` query) + `--tag-source author|user` (narrows to one surface). `--tag-source` without `--tag` is rejected with a directed error. `--tag <name>` with zero matches prints "No nodes found." (or `[]\n` under `--json`) and exits 0. The body of `run()` was split into `#parseFlags` / `#runQuery` / `#resolveTagAllowList` / `#buildFindNodesFilter` to keep cyclomatic complexity under the project limit.
  - `src/cli/i18n/list.texts.ts` — new error texts.
  - `context/cli-reference.md` regenerated.

  **Phase 6 — UI**

  - `ui/src/app/components/annotations-panel/*` — `<sm-annotations-panel>` accepts a new `authorTags: readonly string[]` input. The Taxonomy section renders both sources in a single panel: author chips first with an outlined style, user chips after with the default filled style. Each chip carries `data-tag-source="author|user"` for tests + selectors. Tooltips clarify attribution per chip. CSS adds `.ann-panel__chip--author` / `.ann-panel__chip--user` rules.
  - `ui/src/app/views/inspector-view/inspector-view.ts` — new `authorTags()` computed projects from `node.frontmatter.tags`; passed into the panel via the new input.
  - `ui/src/i18n/annotations-panel.texts.ts` — `tagSourceAuthorTooltip` and `tagSourceUserTooltip` strings added.

  **Phase 7 — Tests + smoke**

  - `src/test/scan-readers.test.ts` — `IListOverrides` + `buildList()` extended with `tag` / `tagSource` so the suite's `ListCommand` instantiations don't leak Clipanion `Option` descriptors when `--tag*` is unused.
  - `ui/src/app/components/annotations-panel/annotations-panel.spec.ts` — coverage for: user-only tag rendering, both sources rendered with author-first ordering, taxonomy section hidden when both sources empty.
  - Smoke-tested end-to-end from a 3-node fixture: `--tag` matches the union; `--tag-source user` narrows correctly; missing tag returns "No nodes found." (exit 0); sidecar-driven user tags appear after a re-scan.

  Test suite (1175 tests) green; lint, spec drift, reference drift checks clean.

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.

- f3e6347: Tags · zoom-to-matching on click + active chip indicator + side-panel-aware fit.

  Three follow-ups on the Foblex multi-select tag UX (`8577563`).

  **1) Zoom + pan to the matching set**

  Clicking a tag chip now also drives the canvas viewport to fit the bounding box of the matching nodes. Foblex doesn't expose a "fit subset" API (`fitToScreen` fits everything, `centerGroupOrNode` centers ONE id), so the math lives inline:

  - Bounding box from the layout cache positions (top-left) plus an approximate node size (260 × 120 — width is fixed, height is the unexpanded average).
  - Scale = `min(availW / bboxW, availH / bboxH)`, clamped to `[ZOOM_MIN, TAG_FIT_MAX_ZOOM]` where `TAG_FIT_MAX_ZOOM = 2`. Soft cap below `ZOOM_MAX = 4` so a single-match tag doesn't catapult one card to fill the whole screen.
  - Center: bbox centroid mapped to the visible-area centroid (see (3) below for the panel-aware part).
  - Animated tween: cubic ease-out over 320ms via `requestAnimationFrame`. Token-based cancellation (`viewportAnimToken`) so back-to-back tag clicks don't fight each other — the latest call wins, prior in-flight loops abort on their next frame.

  The viewport snapshot taken on the FIRST tag activation (`viewportBeforeTagSelect`) is restored on toggle clear (clicking the same chip again) — the user lands back on the pan/zoom they were on before the zoom-to-matching jump. Tag-to-tag swaps don't overwrite the snapshot, so a long chain of swaps still restores the original on final clear.

  **2) Active chip visual in the inspector**

  The chip whose tag drives the current Foblex selection now renders in an "active" visual state: solid primary fill, white label, 2px ring. Wires through:

  - `graph-view.ts` exposes `activeTagSelection` as `protected` so the template can bind it.
  - `graph-view.html` passes `[activeTag]="activeTagSelection()"` to `<app-inspector-view>`.
  - `inspector-view` adds the `activeTag` input and forwards it to `<sm-annotations-panel>` as `[activeTag]`.
  - `annotations-panel` adds the input + `isActiveTag(t)` helper. Template appends `ann-panel__chip--active` to `[styleClass]` when matching.
  - New CSS rule paints `--active`: `background: var(--p-primary-color)`, `color: var(--p-primary-color-text, white)`, ring shadow.

  A tag present in both author and user sources (e.g. `angular` in `frontend-old.sm`, `reference` in `kitchen-sink.sm`) lights up BOTH chip variants because the click semantic is union by tag string. Reflects the selection truthfully — both attributions of the tag are part of what's selected.

  **3) Side-panel-aware fit**

  Reported visual issue: when the inspector panel is open, matching nodes could land underneath it because the fit math assumed the full canvas wrap was visible. Fixed by subtracting `clampedPanelWidth()` from the available width when `selectedNodeId() !== null`, and centring the bbox horizontally in the VISIBLE half (`visibleW / 2`) rather than the geometric centre of the wrap. Panel closed ⇒ `panelW = 0` ⇒ original behaviour.

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.

  ## User-facing

  **Tags zoom-to-matching.** Clicking a tag chip in the inspector now pans + zooms the graph to fit every node that carries the tag. Click the same chip again to clear the selection and return to the previous view. The chip itself lights up to show what's filtering — an active tag is unmistakable in the panel.

- 89c1c17: Add an "update available" notification surface (CLI banner + UI chip).

  A passive background check now compares the running `@skill-map/cli` against the latest version published on the npm registry (`https://registry.npmjs.org/@skill-map/cli/latest`). When a newer release is available the CLI prints a one-line banner at the END of every command (after the verb's own output, on stderr), and the UI shows a chip next to the existing "Beta" badge in the topbar that opens the npm package page in a new tab.

  The check is throttled aggressively so it never feels intrusive:

  - Banner fires **at most once per 24h** — `shownAt` is persisted alongside the cached latest version.
  - Registry probe fires **at most once per 24h** — `checkedAt` drives the refresh decision; the fetch runs AFTER the verb's output with a 1500ms `AbortController` timeout, so a slow / unreachable registry never delays a command.
  - Probe + banner are skipped entirely when ANY of the following hold (cheap short-circuits, evaluated in order):
    1. `process.env.SM_NO_UPDATE_CHECK === '1'`
    2. `process.env.CI` truthy (catches GitHub Actions, GitLab, CircleCI, Travis, etc.)
    3. `process.stderr.isTTY !== true` (pipes / redirects / non-interactive shells)
    4. project DB missing (`./.skill-map/skill-map.db` not present — no scope to read from)
    5. `updateCheck.enabled === false` in the effective settings

  **Storage**

  Cache state lives in the project DB on `config_preferences` under the key `_kernel.update-check`. Value is a JSON blob `{ latestVersion, checkedAt, shownAt }`. No new table, no migration. The `_kernel.` prefix marks the row as kernel-managed (not a `sm config set` user preference). Per-project scope was an explicit decision: the cache lives wherever the verb's project DB lives; users who only run `sm -g …` against a global DB get the same behaviour scoped to that DB.

  **User opt-out**

  `spec/schemas/project-config.schema.json` gains a top-level optional block:

  ```json
  "updateCheck": {
    "enabled": false
  }
  ```

  Default is `true`. Set in either `.skill-map/settings.json` (project) or `~/.skill-map/settings.json` (user) via the existing layered loader.

  **BFF**

  New route `GET /api/update-status` returns the cached payload:

  ```json
  {
    "current": "0.18.0",
    "latest": "0.19.0",
    "isOutdated": true,
    "checkedAt": 1715212345678,
    "shownAt": 1715212345678
  }
  ```

  The route is read-only — it never triggers a probe; it reflects whatever the CLI cached on its last run. Always returns 200; missing-cache shape is `{ current, latest: null, isOutdated: false, checkedAt: null, shownAt: null }`.

  **UI**

  A new chip rendered next to the existing "Beta" stamp in the shell topbar (`ui/src/app/app.html`), gated by `updateCheck.isOutdated()`. The chip is an `<a>` to the npm package page (target `_blank`, `rel="noopener noreferrer"`), with a tooltip showing the upgrade command. Service is one-shot at boot — no polling, no dismiss button.

  **Surface changes**

  - `src/core/update-check/index.ts` — pure helpers (`fetchLatestVersion`, `compareVersions`, `isOutdated`) + types. No `process.env` reads.
  - `src/kernel/storage/update-check.ts` — Kysely-backed cache helpers against `config_preferences`.
  - `src/kernel/ports/storage.ts` — `preferences` namespace added to `StoragePort` (`loadUpdateCheckCache` / `saveUpdateCheckCache`).
  - `src/kernel/adapters/sqlite/storage-adapter.ts` — wires the namespace into the adapter.
  - `src/cli/util/update-check-banner.ts` — `maybeRunUpdateCheck` glue. Owns every env / settings read.
  - `src/cli/i18n/update-check.texts.ts` — texts catalog for the banner (two-line block per `context/cli-output-style.md` §3.1b).
  - `src/cli/entry.ts` — post-`cli.run()` hook between the verb's exit code resolution and `process.exit`.
  - `src/server/routes/update-status.ts` — read-only BFF route.
  - `src/server/app.ts` — registers the route after `registerContributionsRoutes`.
  - `spec/schemas/project-config.schema.json` — `updateCheck.enabled` block (additive, optional).
  - `spec/index.json` — regenerated by `npm run spec`.
  - `ui/src/app/services/update-check.ts` — signal-based service; one-shot fetch.
  - `ui/src/i18n/update-check.texts.ts` — UI catalog.
  - `ui/src/models/api.ts` — `IUpdateStatusResponseApi` next to the existing BFF DTO mirrors.
  - `ui/src/app/app.ts`, `ui/src/app/app.html`, `ui/src/app/app.css` — chip wiring.

  **Tests**

  - `src/test/update-check.test.ts` — 29 tests covering semver compare, fetch (with stubbed `globalThis.fetch` + AbortError), storage round-trip, and end-to-end `maybeRunUpdateCheck` matrix (banner emits / refresh fires / each bail condition).
  - `src/test/server-update-status-endpoint.test.ts` — 2 BFF integration tests (populated cache + missing DB).
  - `ui/src/app/app.spec.ts` — 2 chip tests (rendered when outdated, absent otherwise).

  **Persistence**: no SQL migration. The `config_preferences` table is already in `001_initial.sql`.

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0 — schema additions are minor.

- 5624143: view contribution catalog reorg — kernel side + bundled UI debug toolkit. Pre-1.0 minor per `spec/versioning.md`; pairs with the matching `@skill-map/spec` minor that drives the rename.

  **Kernel surface aligned** — `TContractName` / `IViewContribution` / `IRegisteredViewContribution` in `src/kernel/types/view-catalog.ts` follow the new `<scope>-<form>` names (`node-counter`, `node-tag`, `node-breakdown`, `node-records`, `node-tree`, `node-key-values`, `node-link-list`, `node-markdown`, `node-alert`, `scope-stat`). Optional `priority?: number` (default 100) added to both the manifest type and the registered projection so the UI can read the ordering hint at lookup time.

  **Built-in plugin manifests updated** — `core/annotations` (`node-key-values`), `core/external-url-counter` (`node-counter` — re-declares `icon` per the new manifest requirement), `core/unknown-contract` rule (catalog references). `src/cli/commands/plugins.ts` (the `sm plugins create` scaffolder + `sm plugins contracts list` listing) prints the new names; `src/test/view-contributions.test.ts` covers the rename + the `node-counter` payload narrowing + `icon` required check + the priority field.

  **UI bundled in this CLI release** (the `ui/` workspace ships inside `@skill-map/cli` per AGENTS.md):

  - Renderer folders renamed in lockstep (`ui/src/app/renderers/<contract>`); slot host (`<sm-view-contributions-host>`) now strips `severity` from the forwarded payload when the slot declares `respectSeverity: false`, so the same contract can render tinted in one slot and neutral in another.
  - `card.footer.left` slot (formerly `card.chip`) flips to `order: 'priority'` and remounts to live next to the hardcoded stat row in `node-card.html` — the position the new name describes.
  - New corner anchor at the NE tip of every graph node card hosts the `graph.node.alert` slot (formerly `graph.node.marker`), with a placeholder lucide-style AlertTriangle SVG until a real plugin emits `node-alert`. `pointer-events: none` on the anchor so clicks fall through.
  - Two new severity background tokens (`--sm-severity-info-bg`, `--sm-severity-success-bg`) round out the palette in light + dark.

  **New debug toolkit** for the bundled UI (opt-in, off by default):

  - `?debug-slots=1` — toggles a dashed outline + hover label on every slot mount via `DebugSlotsService`, persisted in localStorage so reloads keep the overlay. Uses `box-shadow` so toggling does not shift layout. Two slots (`graph.node.alert`, `topbar.actions.indicator`) gained their first real `<sm-view-contributions-host>` mount in this release; the overlay makes the empty state visible.
  - `?debug-perf=1` — one-shot query override that forces the floating PerfHud on (`DebugPerfService`), no localStorage; falls back to `DEFAULT_SETTINGS.graph.perfHud` once the query is gone.
  - `DemoContributionsService` — sprinkles synthetic `node-counter` / `node-tag` chips across nodes (empty / one / a few / overflow buckets by hash of `node.path`) and exposes a `lookup()` that returns synthetic registry entries with debug emoji icons (fire / lightning / sparkles / target / rocket / gem for counters; tag / bookmark / pin for tags). The contributions host consults it as a fallback when the real registry has no record, so demo data renders without a real plugin loaded.

- 0702381: spec 0.19.0 — view contribution system. Plugin extensions can now surface per-node typed data in the UI by picking a `contract` name from a closed kernel-published catalog (10 contracts: `per-node-counter`, `per-node-tag`, `per-node-breakdown`, `per-node-records`, `per-node-tree`, `per-node-key-values`, `per-node-link-list`, `per-node-summary`, `node-marker`, `scope-summary`) and emitting payloads at scan time via `ctx.emitContribution(id, payload)`. Plugin authors NEVER ship UI code, never write JSON Schema, and never pick UI slots — they declare intent via `viewContributions: Record<string, IViewContribution>` on each extension manifest, and the closed catalog of input-types (10 entries: `string-list`, `single-string`, `boolean-flag`, `integer`, `enum-pick`, `enum-multipick`, `path-glob`, `regex`, `secret`, `key-value-list`) drives the `settings:` declarations on the plugin manifest root. New CLI verbs `sm plugins create`, `sm plugins contracts list`, `sm plugins upgrade` make scaffolding the canonical entry point.

  **Spec additions**: `spec/view-contracts.md` + `spec/input-types.md` (catalog references); `spec/schemas/view-contracts.schema.json` + `spec/schemas/input-types.schema.json` (closed-enum AJV catalogs with per-contract payload schemas); `spec/architecture.md` § View contribution system (kernel surface, persistence semantics, BFF surface, isolation rules, soft-warning rules, catalog versioning); `spec/plugin-author-guide.md` § View contributions (tutorial); `spec/db-schema.md` § `scan_contributions` (orphan + catalog sweep + upsert semantics, NOT pure replace-all). `spec/schemas/extensions/base.schema.json` extended with `viewContributions` map; `spec/schemas/plugins-registry.schema.json` extended with manifest-root `settings` + `catalogCompat` semver field + `incompatible-catalog` plugin status; `spec/schemas/api/rest-envelope.schema.json` extended with `contributionsRegistry` field on payload-bearing variants + `contributions.registered` envelope kind. `spec/schemas/extensions/extractor.schema.json` relaxes `emitsLinkKinds` minItems so pure-contributions extractors (`emitsLinkKinds: []`) load cleanly.

  **Implementation additions** (`@skill-map/cli`): kernel surface (`IExtensionBase.viewContributions`, `IExtractorCallbacks.emitContribution`, `IAnalyzerContext.viewContributions`, `kernel.{get,set}RegisteredViewContributions`); orchestrator emit-time wiring with AJV per-contract payload validation (off-contract → `extension.error` event + silent drop, mirror of `emitLink`); persistence layer (`scan_contributions` table in `src/migrations/001_initial.sql` per the migrations-consolidation greenfield fold, `src/kernel/adapters/sqlite/contributions.ts` adapter, sweep semantics in `replaceAllScanContributions`); BFF (3 endpoints under `/api/contributions/*`, `contributionsRegistry` on every payload-bearing envelope, `contributions[]` per node on `/api/scan` + `/api/nodes`); CLI verbs (`PluginsCreateCommand` scaffolder + `PluginsContractsListCommand` + `PluginsUpgradeCommand` migration shell); two built-in adopters (`core/annotations` — landed here as `claude/frontmatter` and renamed during the cross-vendor extractor move to `core/` — → `per-node-key-values`; `core/external-url-counter` → `per-node-counter`); two soft-warning rules (`core/unknown-contract`, `core/contribution-orphan`).

  **UI additions** (private `ui/` workspace): closed slot catalog (`ui/src/app/slots/slot-config.ts`) + closed renderer catalog (`ui/src/app/contracts/contract-renderer-map.ts`) + 10 renderer Angular components + slot host (`<sm-view-contributions-host>`) + contributions registry service. Mounts in inspector header badge + body + node card chip slots. Data path extensions: `IContributionApi` + `IContributionsRegistryApi`; `INodeApi.contributions[]`; `INodeView.contributions[]` (projection layer); `IDataSourcePort.lookupContribution`; rest data source ingests `contributionsRegistry` on every fetch + lazy lookup endpoint.

  **AGENTS.md** gained two new rules: "Externalized texts, not internationalized" (the project text-externalizes via per-component `*.texts.ts` catalogs, no Transloco / locale dictionaries; plugin manifests follow the same posture — `label`/`emptyText` are plain English strings, not `{ en, es }` records) and "Plugins are scaffolded, not hand-written" (`sm plugins create` is the canonical entry point, hand-writing supported but discouraged because the scaffolder catches invalid contract picks at author time vs at load).

  **Persistence semantics — important behavioral change for `scan_contributions`**: NOT pure replace-all. The watcher's cached pass leaves the buffer empty for cached nodes (no `extract()` → no `emitContribution`), so a wipe-all would drop valid prior rows on every watcher boot. The persist runs three passes inside the same transaction: (1) orphan sweep — drops rows whose `node_path` is NOT in `livePaths`; (2) catalog sweep — drops rows whose qualified id is NOT in `registeredContributionKeys`; (3) upsert — `INSERT ... ON CONFLICT DO UPDATE SET payload_json = excluded.payload_json` for every buffer row. Cached nodes' rows survive. Disabled-plugin rows are swept on next scan once the catalog reflects the disable. See `spec/db-schema.md` § `scan_contributions` for the full contract.

  **Breaking** (per the pre-1.0 minor convention): plugins that hand-rolled an extension manifest with `viewContributions: {...}` against a now-deprecated contract name will surface as `incompatible-catalog` and need `sm plugins upgrade <id>` (no migrations registered for catalog v1.0.0; the verb is structural). New plugin-load status `'incompatible-catalog'` joins the existing six.

### Patch Changes

- d8630e8: Redesign the `sm check` human renderer. Issues are now grouped by file with a sectioned layout: a header line summarises severity counts (only non-zero ones, joined with `·` and individually colored), each touched file gets its own heading, and rows render as `    <glyph>  <analyzerId>   <message>` with the rule-id column padded to align messages within the rendered set. Severity glyphs replace the old `[severity]` prefix — `✕` red for errors, `⚠` yellow for warns, `ℹ` cyan for infos — and the same color precedence as `sm plugins list` / `sm serve` applies (stdout TTY plus `--no-color`). Multi-node issues attach to their primary `nodeIds[0]`; when the rule message embeds `" from <primary>"` and the primary path is already in the section header, the renderer trims the redundancy so prose like "Broken X reference from <path> → <target>" reads as "Broken X reference → <target>". Plugin-authored fields are sanitised once into a flat row shape before rendering. The previous flat one-line-per-issue format is gone; tests that asserted on `[warn]` / `[error]` prefixes now match on the new glyphs.
- 9534efe: Redesign the `sm config list` human renderer. Effective dot-paths are now grouped into a closed catalogue of sections — General, Scan, Jobs, Roots & plugins, History, plus an `Other` catch-all for future keys — printed in that order. Each section gets a header followed by indented `  <key>   <value>` rows, with the key column padded to the longest key in the section and entries sorted alphabetically by their displayed form (the section prefix is stripped in display, so `scan.tokenize` shows as `tokenize` under Scan, `jobs.maxConcurrency` as `maxConcurrency` under Jobs, etc.). Empty sentinels (`null`, `[]`, `{}`) collapse to a dim em-dash so the eye skips defaults and lands on populated overrides. The flag surface is unchanged and `--json` output is byte-identical to before; only the human path is touched. Tests that asserted on the old flat `key = value` shape now match the new padded `<key>   <value>` rows.
- ccad7da: Polish `sm config get / set / show / reset` human output to share the visual rhythm of the rest of the CLI. Each success line now opens with the green ✓ glyph; the trailing `(wrote <path>)` and `(from <layer>)` suffixes are dim; settings paths render relative to cwd when they sit under it (so the user sees `.skill-map/settings.json` instead of an absolute path). No flag surface change; `--json` paths unchanged.
- b3500b0: Polish `sm db backup` / `sm db restore` / `sm db reset` / `sm db migrate` human output: prefix every success line with the green ✓ glyph, render DB / backup / target paths relative to cwd when they sit under it (so the user sees `.skill-map/skill-map.db` instead of the absolute `~/projects/.../skill-map.db`), and add the same glyph to the `kernel · …` and `plugin <id> · …` migration status lines so a glance is enough to confirm "everything ok". Failure paths still emit on stderr without a glyph (existing UX). No flag surface change.
- c9d0e15: Universal blank line before the `done in <…>` elapsed-time footer. The line was rendering tight against each verb's body output (`<final body line>\ndone in 5ms`) which read as visually crowded. Now every verb gets a blank-line separator. Tutorial's verb-specific trailing `\n` (added a few commits ago for the same purpose) reverts since the universal one covers it.

  Concretely: `UTIL_TEXTS.doneIn` template flips from `'done in {{elapsed}}\n'` to `'\ndone in {{elapsed}}\n'`. No flag surface change; `--quiet` still suppresses the line entirely.

- c6436a6: Polish `sm graph` error path: the `No formatter registered for format=…` message now opens with a red ✕ glyph, matching the rest of the CLI's error-line style. The successful render path is untouched — its output comes from the registered formatter (markdown-flavored ASCII), which is intentionally preserved as-is for diff-tool / pipe compatibility.
- 19e8da3: `sm history` and `sm history stats`: redesign the human renderers to match
  the visual rhythm of the recent `sm scan` / `sm refresh` / `sm list` /
  `sm config list` / `sm show` polish.

  **`sm history` (table)** — old shape: a fixed 7-column flat-array layout
  (`COL_WIDTHS`) with a `-`-separator row under the header. ISO timestamps
  rendered with the literal `T` between date and time, the action column
  truncated against a hard-coded slot, and no footer hint. New shape:

  - Per-column widths are computed dynamically from the rendered set
    (header + data), with `COL_ID` capped at 26 and `COL_ACTION` at 28 so
    pathological ids don't blow the layout. Every other column is
    unbounded — single- and double-digit counts no longer reserve a 4-char
    slot.
  - Rows carry a 2-space indent (`ROW_INDENT`) matching `sm list` /
    `sm plugins list`. The dash separator is gone.
  - Headers render dim. Data cells: `id` plain, `started` dim, `action`
    plain, `status` colored (red on `failed`, yellow on `cancelled`, plain
    on `completed`), `duration` dim, `tokens` plain, `nodes` dim. Status
    cells preserve the `failed (timeout)` / `cancelled (user-cancelled)`
    shape composed at the boundary in `IHistoryRow` so colour applies to
    the whole cell.
  - Started column swaps the ISO `T` for a space (`2026-04-30 10:00:00Z`)
    so the date / time pair reads as one human field rather than a
    machine token. JSON output is unchanged.
  - Footer block: blank line, `<count> executions` (plural-correct via
    the new `tableFooterNoun*` keys), then a dim tip pointing at
    `sm history stats`.
  - `DURATION` column header renamed to `DUR` to keep the column tight
    now that widths size to content. This is a label only — no flag, no
    JSON key.

  **`sm history stats`** — old shape: free-prose lines (`Window: …`,
  `Totals: …`, `Global error rate: …`) followed by sectioned headers
  with un-aligned bullet rows (`Top actions by tokens:` /
  `Top nodes:` / `Failures by reason:`) that always rendered even when
  empty. New shape — sectioned, aligned, color-aware:

  ```
  sm history stats — N executions · X failed · Y% error rate

    Window
      Since   <iso>
      Until   <iso>

    Totals
      Executions  N (X ok · Y failed · Z cancelled)
      Tokens      <in> in / <out> out
      Duration    <ms>

    Top actions (by tokens)
      <id>@<version>  N runs  ·  <in>/<out>

    Top nodes
      <path>  N runs

    Failures by reason
      <reason>  N
  ```

  - One-line dense header (`statsHeader`) replaces the three-line
    Window/Totals/error-rate prose preamble. The summary co-locates
    count, failure count, and error rate so the operator sees the
    bottom line before scanning.
  - Indented `Window` / `Totals` / `Top actions (by tokens)` /
    `Top nodes` / `Failures by reason` blocks built from
    `statsSectionHeader` + `statsFieldRow`. Field labels (`Since` /
    `Until` / `Executions` / `Tokens` / `Duration`) render dim and are
    padded to the longest visible label inside each section.
  - The `Top actions` / `Top nodes` / `Failures by reason` sections
    drop entirely when their slice is empty — the old layout printed
    empty headers on a fresh DB. Run counts are plural-correct
    (`statsRunsSingular` / `statsRunsPlural`).
  - `Executions` value composes a `N (X ok · Y failed · Z cancelled)`
    breakdown via `formatExecBreakdown`, with green / red / yellow on
    the populated buckets and zero buckets dropped. Token splits are
    dim. Failure counts in the breakdown render red.
  - Helpers added: `renderStatsWindow`, `renderStatsTotals`,
    `formatExecBreakdown`, `renderStatsTopActions`, `renderStatsTopNodes`,
    `renderStatsFailures`, `trimMs` (drops `ms` suffix and swaps `T` for
    a space on ISO durations).

  Color is wired through `ansiFor({ isTTY, noColorFlag })` for both
  verbs — same precedence as the rest of the polished renderers (TTY
  detection plus `--no-color`). The `--json`, `--since`, `--until`,
  `--status`, `--top`, and `--period` paths are byte-identical to before
  on both verbs; only the human paths are touched. The old
  `// eslint-disable-next-line complexity` annotations are gone — the
  new helpers are all under the cyclomatic limit.

  Texts catalog: removed the old free-prose keys (`statsWindow`,
  `statsTotals`, `statsGlobalErrorRate`, `statsTopActionsHeader`,
  `statsTopNodesHeader`, `statsFailuresByReasonHeader`, and the
  free-prose `Top*Row` shapes). Added `statsHeader`,
  `statsSectionHeader`, `statsFieldRow`, the section-title and
  field-label constants, the new column-aligned `statsTopActionsRow` /
  `statsTopNodesRow` / `statsFailuresRow`, `statsExecutionsCount`,
  `statsTokensSplit`, `statsRunsSingular` / `statsRunsPlural`, and the
  table-footer keys (`tableFooterCount`, `tableFooterNounSingular`,
  `tableFooterNounPlural`, `tableFooterTip`). `tableHeaderDuration`
  shortened from `DURATION` to `DUR`.

  Tests in `src/test/history-cli.test.ts` updated for the ISO
  date-time separator swap (the column-collapse regression test now
  matches `2026-MM-DD HH:MM:SSZ` instead of `2026-MM-DDT…`). Every
  other history-cli assertion (`failed (timeout)` /
  `cancelled (user-cancelled)` status composition, `No executions
found.`, `--json`, `--since`, `--status`, `--top`, `--period`, audit
  H2 ANSI-strip) passes unchanged. No spec, kernel, or flag-surface
  change; CLI reference output is identical.

- a224379: Polish `sm init`, `sm bump`, and `sm hooks install pre-commit-bump` human output to share the green ✓ glyph rhythm of the rest of the CLI. Each success line — gitignore update, .skill-map/ provisioning, first-scan summary, single-node bump (with or without sidecar creation), pre-commit hook install / chain / already-installed — now opens with `✓`. Pluralised nouns in the first-scan summary (`1 node` / `N nodes`) replace the old `(s)`-suffix style. No flag surface change; `--json` paths unchanged.
- 2d66cb6: Redesign the `sm list` human renderer. The fixed 50-column path / 8-column kind table is replaced with a dynamic layout: column widths are computed from the actual data (PATH soft-capped at 60, every other column unbounded so single- and double-digit counts don't waste a 4-char slot), rows carry a 2-space indent matching the rhythm of `sm plugins list`, `sm check`, and `sm config list`, and the old single-dash separator is gone. Header columns and the KIND column render dim (chrome / metadata), the ISSUES column turns yellow when non-zero so triage targets pop and stays dim at zero, and the data values (OUT / IN / EXT / BYTES) stay plain. A footer block follows: a blank line, `<count> node(s)` (singular / plural via the new `tableFooterNoun*` keys), then a dim tip pointing at `sm show <path>` and `sm check`. Color resolution goes through `ansiFor({ isTTY, noColorFlag })` so `--no-color` and non-TTY pipes stay byte-clean. The flag surface is unchanged and `--json` output is byte-identical to before; only the human path is touched. Tests that asserted on the old `header + sep + N data` line counts now count data rows by `.md` matches (robust to header / footer churn) and additionally assert the new footer's `<count> nodes` line.
- 4a2d36a: Refresh the public-facing tagline across README (EN/ES), CLI compact help header, and the UI top bar. The new line — "The missing map for your generative-AI ecosystem — discover what your Markdown is trying to tell you." / "El mapa que le faltaba a tu ecosistema de IA generativa — descubre lo que tus Markdown intentan decirte." — replaces the previous "graph explorer" wording everywhere it surfaces to users. The CLI `sm --help` compact header mirrors the README "In a sentence" line per the doc-comment contract on `HELP_TEXTS.compactHeader`; `context/cli-reference.md` already covers the new wording and needs no regeneration.

  **README polish** (`README.md`, `README.es.md`): badge order normalised to CI → npm cli → npm spec → TS → Node → License, with a new `@skill-map/cli` version badge that was previously missing. The Glossary section and the "Full glossary" link in the Links list are removed from both READMEs (the canonical vocabulary lives in `ROADMAP §Glossary` and the inline summary was drifting). Spanish copy normalised to neutral tú-form (medís→mides, rastreá→rastrea, editás→editas, querés→quieres, abrí→abre, usás→usas) per the site-copy convention. References to "note"/"nota" as a file kind replaced with "markdown" everywhere user-visible — aligning with the 0.18.0 `core/markdown` Provider rename so the docs and the runtime agree on a single name for orphan `.md` files.

  **UI Beta stamp** (`ui/`, ships bundled inside `@skill-map/cli`): adds a small "Beta" stamp next to the wordmark in the top bar, mirroring the one already present on the public website. Stardos Stencil, thin red rule frame, slight `-4°` tilt; light theme uses `#ad322b` and dark uses `#cf4640`. Externalised string in `ui/src/i18n/app.texts.ts` (`beta: 'Beta'`); Google Fonts request kept minimal (single weight, preconnect + one stylesheet) since this is the only element that uses the family.

- 1485204: Redesign `sm orphans` / `sm orphans reconcile` / `sm orphans undo-rename` human output to match the visual rhythm of the rest of the CLI.

  `sm orphans` (list) now opens with `sm orphans — N issues` and renders one yellow ⚠ row per issue, with `analyzerId` + subject columns padded for alignment and the message dim. Empty state collapses to `✓ No orphan / auto-rename issues.` Tip line points at `reconcile` / `undo-rename` so the user knows the next move.

  `sm orphans reconcile` renders a two-line success block — `✓ Reconciled <from> → <to>` followed by a dim breakdown row (`N rows · jobs N · execs N · summaries N · enrichments N · kv N · favorites N`). Dry-run swaps the glyph (⋯ yellow) and the verb, plus a dim `(dry-run)` tag at the end of the headline.

  `sm orphans undo-rename` follows the same pattern: ✓ green / ⋯ yellow head line + dim body line.

  No flag surface change; `--json` paths unchanged.

- addd5cf: Terminal-UX polish across `sm plugins doctor` and `sm tutorial`. Doctor warning bodies no longer repeat the qualified id (`Provider '<id>' declares ...`) — the id already lands in the entry header glyph row, so the body now reads `Declares explorationDir '<path>', but ...`. `sm tutorial` opens with the same violet "Skill Map" figlet block that `sm serve` does (printed to stderr so it stays out of any pipe consuming stdout), and a trailing blank line in the success template puts breathing room between the body and the `done in <…>` footer.
- c26aab4: `sm refresh`: redesign the human renderer to a single result line in the
  rhythm of the recent `sm scan` / `sm list` / `sm config list` polish.

  The old shape printed a mid-action banner on stderr ("Refreshing
  enrichments for X" / "Refreshing N stale rows across M nodes") and then
  a post-action "Persisted N enrichment row(s)" on stdout. Two channels,
  two messages, redundant with the elapsed-time footer on stderr that the
  shared command runner already emits.

  New shape — one line on stdout per outcome:

  - `✓  N enrichment row(s) from <node.path>` for `sm refresh <path>`.
  - `✓  N enrichment row(s) across M node(s)` for `sm refresh --stale`.
  - `✓  No stale enrichment rows.` when `--stale` finds nothing.
  - `✕  Node not found: <path>` + dim hint on stderr for the lookup miss
    (replaces the prose `sm refresh: node not found in the persisted
scan: …` two-sentence wall).

  Plural-correct nouns (`row` vs `rows`, `node` vs `nodes`) and ANSI
  colour for the glyph (green tick, red cross, dim hint) wired through
  the existing `ansiFor` helper so `--no-color` and non-TTY pipes drop
  back to plain text. Validation / failure copy (`refreshFailed`,
  `nodeAndStaleMutex`, `noTargetSpecified`, `readFailedDetail`) is
  untouched — those are argparse-tier errors, not result output.

  Tests in `src/test/node-enrichments.test.ts` updated to match the new
  stdout/stderr split and the case-insensitive copy. No spec, kernel, or
  flag-surface change; CLI reference output is identical.

- 7e1a756: Polish `sm scan compare-with` and `sm sidecar annotate / refresh / prune` human output.

  `sm scan compare-with` opens with a glyph headline (`✓` clean / `~` drift) and a sectional breakdown per row (`nodes:`, `links:`, `issues:`) with mid-dot separators — replacing the previous one-line `Delta vs X: N nodes added, M removed, K changed; …` dense format. The diff section format (`## nodes`, `+ path (kind)`, `- path (kind)`, `~ path (reason changed)`) stays unchanged for diff-tool / markdown compatibility. The "(no differences)" line picks up a green `✓`.

  `sm sidecar` verbs add green `✓` to every success line: `annotate created`, `refresh fresh`, `refresh updated`, `prune none`, `prune summary`. The dry-run summary uses yellow `⋯` plus a dim `(no changes made)` tag. Plural-correct file noun (`1 file` / `N files`) replaces the old `file(s)` form.

  No flag surface change; `--json` paths unchanged.

- d1e2f17: Redesign the `sm scan` outcome renderer and fix a real bug in the orchestrator's contribution-rejection error path. The outcome layout switches from a single dense summary line to the same sectioned shape as `sm check` and `sm plugins list/show/doctor`: a header `<glyph>  N nodes · M links · K issues   in <Xms>  (P roots)` with `✓` green when no error-severity issues land and `✕` red otherwise, the issues count colored by worst severity (yellow when warn-only, red when errors present, dim when zero), and an indented body line with the relative DB path (or "would persist to <path> (dry-run)" under `--dry-run`). Color resolution mirrors `sm check` / `sm serve`: stdout TTY plus `--no-color`, forwarded explicitly through `IScanRunOpts.colorEnabled` into `createStderrProgressEmitter`, which now wraps its `⚠` glyph in xterm-214 yellow when enabled. The progress emitter's `extension.error:` literal prefix is gone — the line now reads `<glyph>  <message>`, where the glyph carries the severity and the message stays the message. Bug fix on the way: the two `emitContribution` rejection paths in the orchestrator (`unknown-contribution-id` and `payload-invalid`) previously emitted extension-error events without a `message` field, so the stderr emitter fell through to the cryptic "extension reported an error (no detail)." line on every scan that hit a contribution validation failure (e.g. a frontmatter value over `per-node-key-values`'s 512-char ceiling). Both call sites now build a real human message from new `orchestrator.texts.ts` templates so the user sees what was rejected and why.
- 9abeb32: `sm show`: redesign the human renderer to match the visual rhythm of
  the recent `sm scan` / `sm check` / `sm refresh` / `sm list` /
  `sm config list` polish.

  Old shape: identity line `<path> [<kind>] (provider: <provider>)`,
  stacked `title:`/`description:`/`stability:`/`version:` rows aligned
  by hand-tuned label padding, `Weight: bytes …` and a continuation
  `        tokens …` sharing one prose line, `External refs: N`,
  `Frontmatter:` heading + indented JSON, `Links out (N, U unique):` /
  `Links in (N, U unique):` headers with `(none)` placeholders when
  empty, `- [<kind>/<confidence>] → <endpoint> (×N)  sources: a, b`
  bullet lines, and an `Issues (N):` section with
  `- [<severity>] <analyzerId>: <message>` rows.

  New shape — sectioned, aligned, color-aware:

  ```
    ✓  <path>   <kind>   provider: <provider>

    <Label>  <value>
    …

    Frontmatter
      { … }

    Links out (N)
      →  <kind>  <confidence>  <endpoint>  (×N)

    Issues (N)
      ⚠  <analyzerId>   <message>
  ```

  - One-line header with green `✓` glyph (mirrors `sm scan` /
    `sm refresh` outcome lines). The `provider: <provider>` tail is
    dim and elided when `provider === kind` — the universal-markdown
    fallback rendered `kind=markdown` next to `(provider: markdown)`,
    which was pure noise.
  - Field block (`Title` / `Description` / `Stability` / `Version` /
    `Bytes` / `Tokens` / `External refs`) with dim labels and a label
    column padded to the longest visible label across the rendered
    subset. Multi-line values (typically long descriptions) wrap with
    continuation rows indented to the value column. Trailing
    whitespace-only lines from YAML block scalars (`description: |`
    ending in `\n`) are stripped so an empty continuation row never
    appears between fields. `Bytes` and `Tokens` use the unified
    `<total> total · <frontmatter> frontmatter · <body> body` shape;
    `Tokens` is gated on presence (still null for synthesizing
    Providers).
  - `Frontmatter` always renders (the `{}` body conveys "no metadata"
    even when empty); the JSON body is dim.
  - `Links out` / `Links in` sections drop entirely when the node has
    no edges in that direction — the old `(none)` placeholder was
    noise on already-clean nodes. When present, rows are
    column-aligned by kind + confidence widths within the section,
    arrow + confidence are dim, and the `(×N)` collapsed-row marker
    is dim. The `sources: a, b` tail is dropped from human output
    (still present in `--json`).
  - `Issues` section drops when empty; rows mirror `sm check` —
    severity glyph (`✕` red / `⚠` yellow / `ℹ` cyan), dim analyzerId
    padded to the longest analyzerId in the section, message. Messages
    containing ` from <nodePath>` are trimmed because the path is
    already in the header — prose like "Broken X reference from
    <path> → <target>" reads as "Broken X reference → <target>",
    matching the trim already done by `sm check`.

  Color is wired through `ansiFor({ isTTY, noColorFlag })` — same
  precedence as `sm check` / `sm plugins list` / `sm serve` (TTY
  detection plus `--no-color`). The grouping logic (`aggregateLinks`,
  `IGroupedLink`) and the `--json` payload are unchanged. Tests in
  `src/test/scan-readers.test.ts` updated to match the new shape:
  glyph + path header, `Bytes` field row, `Links out (N)` count, and
  `External refs  N` (field row, no colon). The `Links in` regex was
  dropped because empty sections drop now and incoming-link presence
  depends on the fixture. No spec, kernel, or flag-surface change;
  CLI reference output is identical.

- b94ce7f: Document `.sm` sidecar files in user-facing READMEs and the interactive
  tutorial. Adds a "Sidecar `.sm` files (don't be alarmed when they appear)"
  section to `README.md` and `README.es.md` (between Quick start and the
  Interactive tutorial), a terser one-paragraph summary in `src/README.md`
  (which ships in the `@skill-map/cli` npm tarball), and replaces the
  buried sidecar paragraph in `sm-tutorial` Step 3 with a short
  heads-up blockquote. The content explains what `.sm` files are, why they
  sit beside the `.md` instead of inside its frontmatter, that `sm scan` /
  `sm watch` / the live UI never create them (only `sm bump` and
  `sm sidecar annotate` do), and that they belong in git. No behavioural
  change — purely documentation surfacing of an existing architectural
  decision (Step 9.6, Decision #125).
- bb74f42: Apply the in-CLI visual style to `sm version`, `sm tutorial`, and the four `sm plugins enable / disable` rejection error messages.

  `sm version` rows now render with a 2-space indent and a dim key column (`sm` / `kernel` / `spec` / `runtime` / `db-schema`), so the version values pop visually.

  `sm tutorial` success body adopts the same shape as the rest of the CLI: green `✓` glyph + headline ("sm-tutorial.md created at ./<dir>/" with a dim relative path) + dim `English` / `Español` labels. The "already exists" / "could not read SKILL source" / "write failed" error paths get the red `✕` glyph + dim hint line.

  `sm plugins enable / disable` reject paths (`granularity=bundle` rejects qualified id, `granularity=extension` rejects bare bundle id, unknown plugin id, qualified id under unknown bundle, unknown extension under known bundle) all reformatted to the same shape: red `✕` headline + indented secondary-line `Use ...` fix + dim hint line. Replaces the previous one-line dense error.

  No flag surface change; `--json` paths unchanged. Test fixture in `cli.test.ts` updated to tolerate the new 2-space indent on the version matrix.

- b2f56ff: Polish `sm watch` per-batch summary line and stub verbs to match the visual rhythm of the rest of the CLI.

  `sm watch`'s post-batch `scanned <N> nodes / <M> links / <K> issues in <ms>` line is now `✓ <N> nodes · <M> links · <K> issues   in <ms>`, mirroring the `sm scan` outcome shape (green ✓ glyph, mid-dot separators, dim duration tag, plural-correct nouns).

  Every stub verb (`findings`, `actions list`, `actions show`, `job submit`, `doctor`, etc) now opens its `not yet implemented (planned)` advisory with a yellow `⋯` glyph so the user gets a visual handle on "this is coming, not broken."

- Updated dependencies [3376a75]
- Updated dependencies [f0ddae0]
- Updated dependencies [b3ba3de]
- Updated dependencies [22f4439]
- Updated dependencies [40d0a81]
- Updated dependencies [40d0a81]
- Updated dependencies [496fb72]
- Updated dependencies [40d0a81]
- Updated dependencies [68709b9]
- Updated dependencies [9f04fc2]
- Updated dependencies [89c1c17]
- Updated dependencies [5624143]
- Updated dependencies [0702381]
  - @skill-map/spec@0.19.0

## 0.18.0

### Minor Changes

- 305e75a: Step 9.6.3 — built-in `bump` Action + sidecar write channel. Adds the deterministic `core/bump` Action and the new `ISidecarStore` port (with the `FilesystemSidecarStore` impl) that materialises Action-returned `{ kind: 'sidecar', path, changes }` payloads against on-disk `.sm` files. The Action stays pure — `invoke()` computes a deep-merge patch and returns it; the Store re-reads the on-disk sidecar, deep-merges (objects RECURSE; arrays REPLACE), revalidates the merged result against `sidecar.schema.json` + `annotations.schema.json`, and writes back inside a path-keyed critical section using the standard atomic `.tmp + rename` pattern.

  **Runtime contract extension.** `IAction` gains an optional `invoke<TInput, TReport>(input, ctx): IActionResult<TReport>` method (additive — actions that don't implement it keep working). `IActionResult` carries `report: TReport` plus an optional `writes?: TActionWrite[]` array; today `TActionWrite` is the discriminated union `{ kind: 'sidecar'; path; changes }`, with future write kinds (storage rows, plugin KV) landing additively. `IActionContext` introduces `{ node, nodeAbsolutePath, invoker, now }` so Actions can stamp `audit.lastBumpedBy` from a CLI-supplied `'cli'` (or `'plugin:<id>'`) value without doing any IO themselves.

  **`bump` Action behaviour matrix** (Decision #1 of the brief): stale node (or no sidecar yet) → patch increments `annotations.version`, refreshes `for.{bodyHash, frontmatterHash}`, populates `audit.lastBumpedAt` + `lastBumpedBy` (and on first-time creation also `audit.createdAt` + `audit.createdBy`); fresh node without `force` → refusal (`{ ok: false, reason: 'fresh' }`, no writes); fresh node with `force: true` → silent no-op (`{ ok: true, noop: true }`, no writes — intended for the upcoming batch flow `sm bump --pending --staged`).

  **Spec.** `sidecar.schema.json` now formalises the `audit:` sub-shape (`lastBumpedAt` / `lastBumpedBy` / `bumpReason` / `createdAt` / `createdBy`, all optional at the property level, `additionalProperties: true`); the `bump` Action atomically fills `lastBumpedAt` + `lastBumpedBy` on every bump and `createdAt` + `createdBy` on first creation. The conformance fixture at `spec/conformance/fixtures/sidecar-example/agent-example.sm` now carries a populated audit block. New `spec/schemas/bump-report.schema.json` declares the deterministic report shape — distinct from `report-base.schema.json` which carries LLM-specific `confidence` + `safety` and is therefore wrong for deterministic Actions.

  **Greenfield + pre-1.0 versioning.** The `audit:` block formalisation is technically a breaking surface (a previously-permissive `additionalProperties: true` block now declares typed properties), but per the greenfield-no-versioning policy and the pre-1.0 versioning rule (every breaking change ships as a minor while the workspace is `0.Y.Z`), this lands as a minor on both `@skill-map/spec` and `@skill-map/cli`. No released consumer depended on the prior shape; the empty `audit: {}` documented in 9.6.2 is forward-compatible with the new declarations.

  Coverage matrix row 26 stays 🟡 partial (notes updated to mention the audit-block formalisation); row 28 lands as 🔴 missing — direct conformance case for `bump-report.schema.json` ships together with the `sm bump --json` CLI verb in Step 9.6.4. Implementation tests at `src/test/sidecar-store.test.ts` and `src/test/bump-action.test.ts` cover the runtime behaviour today.

- 79dfdea: Step 9.6 catalog-curation follow-up (2026-05-07): remove the vestigial `Node.author` denormalisation end-to-end. The 9.6.2 migration sourced `Node.author` from `annotations.author`; the 2026-05-07 catalog curation dropped `author` from `annotations.schema.json`, leaving the column without a canonical source. The earlier curation changeset said `Node.author` would stay untouched; this follow-up reverses that — keeping a denorm path for an opaque `additionalProperties: true` rider was inconsistent with the curated catalog and added persistence + display surface for a field the schema no longer documents.

  **Spec.** `spec/schemas/node.schema.json` no longer documents the `author` property. `spec/architecture.md` § "Read path (denormalization)" lists two columns instead of three (`stability`, `version`). `spec/db-schema.md` § scan_nodes drops the `author` row. `spec/index.json` regenerated.

  **Kernel.** `Node.author` removed from the runtime type and `IScanNodesTable.author` removed from the SQLite schema. `applyAnnotationsOverlay` no longer reads `annotations['author']`; the cache-hit reset in `runScan` no longer clears `node.author`; `buildNode` no longer initialises the field. New migration `003_drop_node_author.sql` issues `ALTER TABLE scan_nodes DROP COLUMN author;` (SQLite 3.35+ — node:sqlite ships ≥ 3.45). `scan-persistence.ts` and `scan-load.ts` no longer write or read the column.

  **CLI.** `sm show` no longer renders an `author:` row in the node header. `SHOW_TEXTS.nodeFieldAuthor` removed. The built-in `validate-all` rule's `toNodeForSchema` no longer copies `author` over to the wire shape it validates against.

  **Tests.** `sidecar-reader.test.ts`, `storage.test.ts`, `node-enrichments.test.ts`, `server-query-adapter.test.ts` updated. The fresh-sidecar fixture in `sidecar-reader.test.ts` no longer writes an `author:` annotation (rides on `additionalProperties: true` if anyone keeps writing it informally; not a denorm-source anymore).

  **Greenfield.** No automatic salvage path. Pre-9.6.2 rows had the column reset to NULL by migration 002. Anyone who later wrote `author:` in their `.sm` keeps the value verbatim under `scan_nodes.annotations_json`; the `unknown-field` rule warns on the key as a typo guard.

  **Out of scope.** UI display tiering (4-tier vendor/plugin layout, inspector sections) remains a separate task; the UI's `INodeApi.author` optional field is not consumed by any service / view, and the BFF will simply never produce it after this change. Rip-out lands with the inspector tiering pass.

- 670eaa4: Catalog refinement: drop `released` from the curated annotation catalog. The catalog now stands at **14 fields**.

  **Rationale.** `released` (lifecycle "officially released") was redundant with `audit.lastBumpedAt` (activity timestamp written by every `bump`) for this project's flow — the spec doesn't distinguish official release from bump, so a separate lifecycle field added confusion without unique semantics. Activity timestamp now lives exclusively in the reserved `audit:` block.

  **Spec.** `spec/schemas/annotations.schema.json` removes the `released` property; description updated to "load-bearing 14 fields" and clarifies that the activity timestamp lives in `audit.lastBumpedAt`. `spec/architecture.md` listing updated. `spec/index.json` regenerated.

  **Fixtures.** `fixtures/local-scope/.claude/agents/kitchen-sink.sm` drops the `released:` line (only fixture that carried it). Hashes unaffected — `for.bodyHash` and `for.frontmatterHash` are over the `.md`, not the `.sm`.

  **UI.** Card `daysAgo` (`ui/src/app/components/node-card/node-card.ts`) and inspector `headerDays` (`ui/src/app/views/inspector-view/inspector-view.ts`) both switch to reading `sidecar.root.audit.lastBumpedAt` — the canonical activity timestamp now flowing on the wire after R15. Annotations panel drops the `released` row from the lifecycle section (`ILifecycleSection.released` field, parsing, render, and the `texts.fields.released` strings in both `inspector-view.texts.ts` and `annotations-panel.texts.ts`).

  **Backward compatibility.** `additionalProperties: true` stays — sidecars carrying `released:` continue to validate (the field rides through as an unknown opt-in key). The built-in `unknown-field` rule will warn on it post-curation, matching the pattern for the 16 fields dropped in the 2026-05-07 catalog curation.

  Greenfield-permitted breaking surface (no released consumers depend on the prior shape) shipping as a `@skill-map/spec` minor per the pre-1.0 rule.

- d12f7d2: Two new built-in Providers — `gemini` and the vendor-neutral `agent-skills` — plus a tighter `IProvider.classify()` contract so multiple Providers can scan the same roots without colliding.

  **`gemini`**

  - Walks Google's Gemini CLI on-disk conventions: `.gemini/agents/*.md` → `agent`, `.gemini/skills/<name>/SKILL.md` → `skill`, `.gemini/**/*.md` and `GEMINI.md` → `markdown` (the format-named generic fallback).
  - Per-kind frontmatter schemas absorb Google's documented contracts verbatim:
    - `agent.schema.json` — 7 vendor-specific fields (`kind: local|remote`, `tools`, `mcpServers`, `model`, `temperature`, `max_turns`, `timeout_mins`) per https://geminicli.com/docs/core/subagents/. `name` + `description` come from spec base.
    - `skill.schema.json` — thin `allOf` extension of base; Google's documented Skill format requires only `name` + `description`.
    - `markdown.schema.json` — fallback, base only.
  - UI: Gemini purple + Google blue palette; `pi-sparkles` icon for agents.
  - Conformance: `basic-scan` case + `minimal-gemini` fixture (agent + skill + GEMINI.md).
  - Bundle granularity: `bundle` (the Provider is the bundle's only extension today; future Gemini-namespaced extractors land here).

  **`agent-skills`**

  - Vendor-neutral Provider that owns the open-standard path `.agents/skills/<name>/SKILL.md` jointly adopted by Anthropic, OpenAI (Codex), and Google (Gemini). Single kind: `skill`. Reclaims the path so vendor-specific Providers don't have to — the day a Codex Provider lands, the spec's `provider-ambiguous` rule fires zero times because the open-standard path already has a home.
  - UI: deliberately neutral slate (`#64748b` / `#94a3b8`) so the kind reads as "vendor-agnostic" at a glance.
  - Conformance: `basic-scan` case + `minimal-agent-skills` fixture.

  **`IProvider.classify()` returns `string | null`**

  - Old contract: `classify(path, fm): string` — must return a kind name. Old Claude returned `'markdown'` for non-`.claude/` paths; with one Provider this was fine, with multiple Providers it doubles up the same path (SQLite UNIQUE on `scan_nodes.path` violation).
  - New contract: `classify(...) → string | null`. `null` means "not my file"; the orchestrator skips it. Each Provider claims its own conventions and disclaims the rest.
  - Claude: claims `.claude/{agents,commands,skills}/`, `.claude/**/*.md` (catch-all under `.claude/`), `notes/**/*.md`, and `CLAUDE.md`. Disclaims everything else.
  - Gemini: claims `.gemini/{agents,skills}/`, `.gemini/**/*.md`, and `GEMINI.md`. Disclaims everything else.
  - agent-skills: claims `.agents/skills/<name>/SKILL.md` only.

  **Per-Provider node painting (consumer-side fix from Phase A)**

  - `node-card` now binds `[style.--accent]="providerAccent()"` so a node sourced from a non-primary Provider paints with its own Provider's color (e.g. a Gemini-sourced `agent` renders in `#9b72cb` even when Claude is the primary contributor to the `agent` kind). Primary Providers fall through to the existing `--sm-kind-<kind>` CSS var without an inline override.
  - `KindRegistryService.providersOf(kind)` returns the per-Provider sub-map; `node-card.providerAccent()` reads `entry.providers[node.provider]?.color`.

  **Conformance fixture migration**

  - All Claude conformance fixtures (`minimal-claude`, `rename-high-{before,after}`, `orphan-{before,after}`) move from project-relative `agents/` / `commands/` / `skills/` paths to `.claude/agents/` / `.claude/commands/` / `.claude/skills/` so the Claude Provider's strict `classify()` claims them.
  - `spec/conformance/fixtures/sidecar-end-to-end/agents/` → `.claude/agents/`. The matching `sidecar-end-to-end.json` case asserts the new paths.
  - `spec/conformance/cases/plugin-missing-ui-rejected.json` updated to assert all 3 built-in providers in the result (was 1).
  - `spec/conformance/fixtures/plugin-missing-ui/.skill-map/plugins/bad-provider/provider.js` now declares the `markdown` kind to mirror Claude's catalog.
  - The bad-provider fixture is unchanged in intent — still rejects manifests missing `ui` — but uses the `markdown` kind to align with the Provider's current catalog.

  **Tests**

  - 8 new Gemini provider tests, 6 new agent-skills tests, 2 new node-card per-Provider painting tests. The bulk of the existing tests update to the new fixture paths; built-in modes / pluginId tests now allow the `gemini` and `agent-skills` pluginIds; the cross-provider count assertions in `plugin-runtime-branches.test.ts` (3 providers when no toggles) pick up the two new bundles.
  - Total: 1098 cli tests + 307 ui tests, all green.

  **Backward compatibility**

  Greenfield (`feedback_greenfield_no_versioning.md`): the `classify()` signature change is breaking for any plugin Provider in the wild — no released consumer holds a Provider implementation today. Stays minor pre-1.0 per `versioning.md` § Pre-1.0. Existing local DBs rescan to pick up the new kind layout (no migration ships).

- 5e0ebcd: Rename five public type aliases on the kernel surface to match the project's `T*` prefix convention for type aliases (categories 1-4 already documented in `context/kernel.md` + `src/kernel/types.ts`; category 5 was implicit and is now formalized).

  - `LogLevel` → `TLogLevel`
  - `LogMethodLevel` → `TLogMethodLevel`
  - `ProgressListener` → `TProgressListener`
  - `LogFormatter` → `TLogFormatter`
  - `IProviderKindIcon` → `TProviderKindIcon`

  The first four are exported from `kernel/index.ts` / `kernel/ports/*` and from the root barrel. The fifth is re-exported from `kernel/extensions/index.ts` and consumed by the BFF (`server/envelope.ts`). All five are TS-only `type` aliases (string-literal unions, function-type aliases, discriminated unions) — they do not appear as standalone entries in `spec/schemas/*.json` and are not part of the JSON contract on the wire.

  Note on the `IProviderKind*` family: `IProviderKind` and `IProviderKindUi` keep the `I` prefix because they are declared as `interface` (Category 4 — internal interfaces). `IProviderKindIcon` is renamed because it is a `type` alias (Category 5), not an interface. The asymmetry is intentional and tracks the new five-bucket convention.

  Why now: the project already uses `T*` for every other type alias on the public surface (`TActionWrite`, `TExecutionMode`, `TGranularity`, `THookFilter`, `THookTrigger`, `TNodeChangeReason`, `TPluginLoadStatus`, `TPluginStorage`, `TWatchEventKind`). The four flagged names were drifting against that convention. The kernel naming-bucket doc in `context/kernel.md` and `src/kernel/types.ts` previously listed only four buckets ("internal shapes" with `I*` for everything in TS-only land); a fifth bucket "internal type aliases" with `T*` is now documented explicitly so future authors don't re-create the drift.

  Why it's a `minor` and not a `patch`: this is a breaking change for any downstream consumer importing these names from `@skill-map/cli` — but per `AGENTS.md` § Pre-1.0 rules, breaking changes ship as minor bumps while the package stays in `0.Y.Z`.

  No runtime / behavioral change. The function names and constants that share the conceptual root (`parseLogLevel`, `isLogLevel`, `logLevelRank`, `LOG_LEVELS`, `IResolveLogLevelOptions`, `extractLogLevelFlag`, `resolveLogLevel`) keep their identifiers — they reference the conceptual "log level", not the type identifier.

- e17ff6a: Per-user favorites. The UI gains a subtle heart button on every node card (stacked under the chevron in the actions cluster) plus a "Favorites only" toggle in the filter-bar that hides while the user has zero favorites. State persists across `sm scan` and `sm db reset` because favorites live in a new `state_node_favorites` table (zone `state_`).

  **Spec.** New table in `spec/db-schema.md`: `state_node_favorites(node_path PRIMARY KEY, favorited_at INTEGER NOT NULL)`. Listed in the rename heuristic's FK migration set so renaming a favorited file preserves the mark. New optional `Node.isFavorite: boolean` field in `spec/schemas/node.schema.json` — decorated by the BFF on every `/api/nodes` and `/api/nodes/:pathB64` response; consumers that don't recognise it MUST ignore it.

  **BFF.** Two new endpoints, both idempotent:

  - `PUT /api/favorites/:pathB64` — 204 on success, 404 when the path is not in the persisted scan.
  - `DELETE /api/favorites/:pathB64` — 204 always (un-favoriting an already-unmarked path is a no-op).

  The `/api/nodes` route loads the favorites set once per request via a tiny `SELECT node_path FROM state_node_favorites` query and decorates each emitted node with `isFavorite` by `Set` membership in memory — no SQL JOIN against `scan_nodes`. Cost is `O(favorites)` per request (typical projects pin a handful of nodes).

  **Storage.** New `port.favorites.{ set, unset, listPaths }` namespace on `StoragePort`. `migrateNodeFks` (rename heuristic) updates `state_node_favorites.node_path` alongside the other `state_*` tables; `findStrandedStateOrphans` scans it too. New `IMigrateNodeFksReport.nodeFavorites` counter; `sm orphans reconcile` summary line includes the count.

  **Migration `005_node_favorites.sql`** creates the table. No backfill — fresh installs and existing scopes alike start with zero favorites.

  **UI.** New `<sm-node-card>` `[isFavorite]` input + `(favoriteToggle)` output (path + new value). The graph view wires the output to `CollectionLoaderService.toggleFavorite(path, value)` which (a) flips the local store optimistically, (b) fires the BFF call, (c) rolls back on failure. The filter-bar's "Favorites only" toggle is gated by a `hasAnyFavorites` computed signal so the row stays uncluttered for first-time users; the toggle stays visible if the filter is currently active so the user can disable it after un-favoriting the last node.

  **Out of scope (deliberate).**

  - No CLI verb (`sm fav`). Favoriting is a visual / personal preference; the CLI surface stays focused on lifecycle verbs.
  - No WebSocket broadcast on favorite toggle. Multi-tab sync (`favorite.set` / `favorite.unset` events) can land later if the use case surfaces.
  - Demo (`StaticDataSource`) rejects favorite mutations with `code: 'demo-readonly'` — the optimistic flip rolls back, surfacing the read-only stance to the user.

  Tests: `src/test/favorites-storage.test.ts` (CRUD + rename heuristic + collision report — 6 cases), `src/test/server-favorites-endpoint.test.ts` (PUT/DELETE happy paths, 404, idempotency, isFavorite decoration on the list and single-node routes — 9 cases). UI: 5 new cases in `node-card.spec.ts` and 4 in `collection-loader.spec.ts`.

- 864e373: Phase 0 of the multi-provider rollout: rename the Claude Provider's fallback kind `note` → `markdown`.

  The fallback kind classifies any markdown file under a Claude scope that does not match a more specific path (`.claude/agents/`, `.claude/commands/`, `.claude/skills/`). The previous name `note` overcommitted to a content role; the file is really just "generic markdown without a specific role". The new name reflects the _format_. Convention going forward: format-named kinds (`markdown`, future `toml`, future `json`) apply ONLY as the generic fallback. A file that IS a specific role (e.g. a Codex agent in TOML) classifies as `agent`, not `toml` — specific roles prevail over format naming.

  This rename is mechanical and pure. No behavior, validation, or persistence change beyond the kind identifier.

  **`@skill-map/spec`**

  - `schemas/extensions/provider.schema.json` description updated (the spec doesn't hardcode kind names; only prose mentions changed).
  - `schemas/node.schema.json` prose updated.
  - `schemas/summaries/note.schema.json` → `schemas/summaries/markdown.schema.json` (renamed file, `$id` updated, `title: SummaryNote` → `SummaryMarkdown`, prose updated).
  - `db-schema.md`, `README.md`, `conformance/coverage.md` — prose updates.
  - `spec/index.json` regenerated (new file path + hash, old entry removed).

  **`@skill-map/cli`**

  - `built-in-plugins/providers/claude/index.ts` — `kinds.note` → `kinds.markdown`. `defaultRefreshAction` `claude/summarize-note` → `claude/summarize-markdown`. `ui.label: 'Notes'` → `'Markdown'`. Color and icon unchanged. `classify()` fallback `'note'` → `'markdown'`.
  - `built-in-plugins/providers/claude/schemas/note.schema.json` → `markdown.schema.json` (renamed file, `$id` updated, `title: FrontmatterNote` → `FrontmatterMarkdown`).
  - `kernel/types.ts` — `NodeKind` union: `'note'` → `'markdown'`.
  - `built-in-plugins/formatters/ascii/index.ts` and `cli/commands/export.ts` — `KIND_ORDER` updated.
  - All hardcoded `'note'` test fixtures and assertions across `src/test/`, `src/built-in-plugins/`, and the Claude conformance suite (`basic-scan.json`, `coverage.md`) flipped to `'markdown'`.
  - Conformance fixture `spec/conformance/fixtures/plugin-missing-ui/.skill-map/plugins/bad-provider/provider.js` (the negative-test fixture mirroring Claude shape) renamed alongside.

  **UI (`ui/`, private workspace, no version bump per AGENTS.md `ui/` policy)**

  - `models/node.ts` — `ISummaryNote` → `ISummaryMarkdown` with `kind: 'markdown'`. Union member updated.
  - `node-card.ts/.html`, `graph-layout.ts/.spec.ts`, `collection-loader.ts/.spec.ts`, `static-data-source.spec.ts`, `node-card.spec.ts`, `vendor-frontmatter.spec.ts`, `inspector-view.html` — kind literal + class binding renames.
  - CSS classes `.sm-gnode--note` → `.sm-gnode--markdown`, `.inspector__header--note` → `.inspector__header--markdown`. CSS variables `--sm-kind-note*` → `--sm-kind-markdown*` across `node-card.css`, `kind-palette.css`, `inspector-view.css`. The variables are runtime-injected from the Provider's `ui.color` value, so no static color value changed.
  - i18n comments in `i18n/node-card.texts.ts` updated.

  **Web (public site, `web/`)**

  - `app.js` color map and `STR` label map: `note` → `markdown`.
  - `index.html` demo SVG `data-type="note"` → `"markdown"`. Provider description prose dropped the legacy `hook` mention while we were there (out-of-date since spec 0.17.0; not a Phase 0 goal but cheap to fix in the same prose pass).
  - `i18n.json` key `graph.legend.note` → `graph.legend.markdown` with EN/ES values `Markdown`/`Markdown` (dev-facing audience; the technical kind name reads cleaner than the prose word "Note").

  **No data migration required.** Greenfield (per `feedback_greenfield_no_versioning.md`); existing local DBs rescan to pick up the new kind value. Historical CHANGELOG entries that reference `note` are intentionally left untouched — they document past behavior (precedent: the `.skill-mapignore` rename in spec 0.16.0).

  **Demo data.** `web/demo/data.meta.json` is a generated artifact (regenerates on next demo build); the source changes drive it.

  Breaking but greenfield-permitted per `versioning.md` § Pre-1.0: ships as a minor bump because both `@skill-map/spec` and `@skill-map/cli` are still 0.x and no released consumer mandates the prior kind name. The first 1.0.0 is a deliberate stabilization moment, not a side-effect of this PR.

- 305e75a: Step 9.6 review queue R14 — `loadPluginRuntime` now honours an explicit `runtimeContext` override. The BFF composition root (`server/index.ts:assembleBootBundle`) threads its already-resolved `runtimeContext` through to plugin discovery so a `createServer({ runtimeContext: { cwd: <tempdir>, ... } })` boot actually walks `<tempdir>/.skill-map/plugins/` instead of the real `process.cwd()`. Pre-R14 the option was silently ignored — `loadPluginRuntime` fabricated a fresh `defaultRuntimeContext()` per helper.

  **API addition.** `ILoadPluginRuntimeOptions` grows an optional `runtimeContext?: IRuntimeContext` field. When present, the loader uses it for both `resolveSearchPaths` (project + user plugin dirs) and `buildEnabledResolver` (config + DB plugin overrides). When absent, behaviour is identical to today — `defaultRuntimeContext()` is used. CLI verbs that call `loadPluginRuntime({ scope })` are unchanged.

  **Test cleanup.** `src/test/server-annotations-endpoint.test.ts` no longer needs the `createApp()` bypass that 9.6.6 introduced for the populated catalog. All four cases (empty, populated, envelope-schema validation, mutation guard) now boot through the real composition root against tempdir-rooted plugin fixtures planted under `<tempdir>/.skill-map/plugins/`. The fixture helper plants a single-extractor plugin per id whose `annotationContributions` map drives the catalog assertions.

- 305e75a: Step 9.6.6 (BFF half) — `GET /api/annotations/registered` over the Hono BFF. Read-only catalog of plugin-contributed annotation keys, surfaced so a future UI autocomplete can offer plugin-namespaced and root-exclusive contributions the UI can't otherwise discover at runtime. The endpoint is a pure projection of `kernel.getRegisteredAnnotationKeys()` — populated once by `registerEnabledExtensions` after every plugin loads at server boot, frozen, surfaced unchanged. Built-in catalog keys (from `annotations.schema.json`) are NOT included; the UI knows the built-in set via the bundled spec.

  **Wire contract.** Method + path: `GET /api/annotations/registered`. No query params, no body, no auth (matches `/api/plugins`, `/api/config`). 200 envelope: `{ "schemaVersion": "1", "kind": "annotations.registered", "items": IRegisteredAnnotationKey[], "counts": { "total": <int> } }`. Item shape per `src/kernel/types/annotation-catalog.ts`: `{ pluginId, key, location: 'namespaced' | 'root', ownership: 'exclusive' | 'shared', schema: Record<string, unknown> }` — the inline JSON Schema as declared in the contributing plugin's manifest, not the AJV-compiled validator. Catalog is small (typically 0–50 entries) so no pagination, no filters, no caching headers; mutating the returned `items` array does not affect subsequent calls (kernel view stays frozen).

  **Composition.** `server/index.ts` now instantiates a kernel at boot (`createKernel()`), stamps `pluginRuntime.annotationContributions` onto it via `setRegisteredAnnotationKeys`, and threads the kernel through `IAppDeps.kernel` to the route factory. Routes that need the catalog read it off this kernel via closure — no shared mutable state, no DI container, factory only.

  **Refresh policy.** Same as the rest of the BFF's plugin surface — discovery happens once at `sm serve` boot. An operator that installs a new plugin restarts the server, matching the watcher's documented "loaded ONCE at boot" contract.

  **Spec contract.** Documented in `spec/cli-contract.md` §Sidecar bump → BFF endpoint subsection (sibling of `POST /api/sidecar/bump` from 9.6.5). The new `kind` discriminator (`annotations.registered`) is reserved at 9.6.6 and joins R7 alongside `sidecar.bumped` as the canonical `rest-envelope.schema.json#/properties/kind/enum` gap to close in one batch — same divergence stance as 9.6.5; closing the enum is part of the §Step 9.6 review-queue walk.

  Tests at `src/test/server-annotations-endpoint.test.ts`: empty catalog (real `createServer()` boot with `--no-plugins`), populated catalog with a `namespaced` + a `root + exclusive` contribution surfaced through `createApp` directly (bypasses the loader's `process.cwd()` resolution which `loadPluginRuntime` reads via `defaultRuntimeContext()`), and a mutation guard that asserts the second call still sees the original frozen view. 3 cases pass.

  UI half (autocomplete dropdown wired into the annotation editor) is post-Step-9.6 work and lands once the parent step's review queue walks to ✅.

- 305e75a: Step 9.6.5 (BFF half) — `POST /api/sidecar/bump` over the Hono BFF. The endpoint mirrors the `sm bump <node.path> [--force]` CLI verb 1:1: same built-in `core/bump` Action, same `FilesystemSidecarStore`, same fresh-vs-stale refusal semantics. The only differences from the CLI verb are the invoker label (`'ui'` vs `'cli'`) and the wire shape. Batch (`--pending`) stays CLI-only at 9.6.5 — surfacing it over REST needs a job-style progress channel and lands later.

  **Wire contract.** Request body: `{ "nodePath": <string, required>, "force"?: <boolean>, "reason"?: <string> }`. Successful (200) envelope: `{ "schemaVersion": "1", "kind": "sidecar.bumped", "value": { "nodePath", "version", "status": "fresh" }, "elapsedMs": <int> }`. Refusal (409) on fresh + no force: `{ "ok": false, "error": { "code": "sidecar-fresh", "message": <string>, "details": null } }`. 404 on unknown `nodePath`; 400 on malformed body. Force-on-fresh is a 200 silent no-op (per the Action spec) carrying the existing version, with no on-disk change. The BFF's global `app.onError` gains a new `'sidecar-fresh'` `TErrorCode` mapped from HTTP 409.

  **WS event — `sidecar.bumped`.** After every successful 200 bump that materialises a write, the BFF broadcasts `{ "type": "sidecar.bumped", "nodePath", "version", "status": "fresh" }` over `/ws` so all connected clients refresh in lockstep. Force-on-fresh no-op responses do **not** broadcast (decision: no-op = no event — nothing changed on disk, sending the event would tell every UI to refresh state that has not moved).

  **Spec contract.** Documented in `spec/cli-contract.md` §Sidecar bump → BFF endpoint subsection. Two new review-queue items surfaced in `ROADMAP.md` §Step 9.6: R7 (REST envelope `kind: 'sidecar.bumped'` is not in the canonical `rest-envelope.schema.json#/properties/kind/enum` — close before flipping 9.6.5 ✅) and R8 (force-on-fresh broadcast policy — keep no-op = no event, or always broadcast on a successful 200).

  Tests at `src/test/server-sidecar-endpoint.test.ts`: 200 stale path with broadcaster receipt assertion; 409 refusal with on-disk untouched + no broadcast; 200 force-on-fresh no-op with no broadcast; 404 unknown path; 400 missing `nodePath` / wrong type / malformed JSON; round-trip parity (the on-disk `.sm` after a UI-driven bump is byte-equal to what the CLI verb would produce). 8 cases pass.

  UI half (Angular components, e2e) is the next agent's task and will flip 9.6.5 to ✅.

- 305e75a: Step 9.6.4 — sidecar CLI verbs. Six new verbs split between `sm bump` (top-level, ROADMAP-named per Decision #125) and the `sm sidecar` sub-namespace (administrative helpers; the existing `sm refresh` from Step A.8 — enrichment-layer — stays untouched). Plus `sm hooks install pre-commit-bump` for the opt-in commit-time auto-bump.

  **`sm bump <node-path> [--force]`** — single-node mode. Wraps the built-in deterministic `core/bump` Action: refusal on a fresh node (`{ ok: false, reason: 'fresh' }`, exit 2) unless `--force`; with `--force` on a fresh node the verb is a silent no-op (exit 0, no stdout). On a stale or first-time node increments `annotations.version`, refreshes `for.{bodyHash, frontmatterHash}`, stamps `audit.lastBumpedAt` + `lastBumpedBy: 'cli'` (and `audit.createdAt` + `createdBy: 'cli'` on first creation). `--json` emits the report shape declared by `bump-report.schema.json`.

  **`sm bump --pending [--staged] [--force]`** — batch mode. Walks every node whose sidecar overlay reports drift in `node.path` ASC order. `--json` envelope: `{ bumped, refused, skipped, errors[], elapsedMs }`. `--staged` runs `git add <sidecar-path>` after each successful bump (failures degrade to a stderr warning, batch keeps running); preflight enforces the spec error matrix — not in a git repo (no `.git/` parent) → exit 5; `git` binary missing on PATH → exit 2.

  **`sm sidecar refresh <node-path>`** — hash-only update. Refreshes `for.{bodyHash, frontmatterHash}` to match the live node WITHOUT bumping `annotations.version` and WITHOUT touching the audit block. Useful when a body change is editorial and the user doesn't want to spend a version increment. Distinct from the top-level `sm refresh` (enrichment-layer verb at Step A.8) — different storage, different concept; the sub-namespace prefix prevents the collision.

  **`sm sidecar prune [--dry-run]`** — delete orphan `.sm` files (sidecars whose accompanying `<basename>.md` is missing on disk). Different domain from `sm orphans` (which operates on the node graph via the rename heuristic). `--json` envelope: `{ deleted, wouldDelete, errors, items[], elapsedMs }`.

  **`sm sidecar annotate <node-path> [--force]`** — pure scaffolding. Writes a minimal `.sm` next to the `.md` with the `for:` block populated and `annotations: {}` empty, ready for editing. The `--from-frontmatter` legacy-import helper is deferred (no released consumer demands it).

  **`sm hooks install pre-commit-bump [--dry-run]`** — install (or chain into) a git pre-commit hook running `sm bump --pending --staged` so any staged drift in `.sm` sidecars auto-bumps before the commit lands. Idempotent: re-running detects the embedded skill-map marker and no-ops. When the repo already has a `pre-commit` hook, the verb appends the skill-map block rather than replacing it. `--dry-run` prints the planned content with `--- target: <path> ---` markers and writes nothing. Exit 5 if no `.git/` parent exists; exit 2 on write failures or unknown hook flavours.

  **Spec.** `cli-contract.md` §Actions gains a "Sidecar bump (Step 9.6.4)" subsection documenting all six verbs verbatim, the `--staged` git-error matrix, and the explicit `.sm` round-trip contract: **"`.sm` files are managed artifacts; comments and key order are not preserved on round-trip. Author commentary belongs in the markdown body or in a separate documentation file, not inside `.sm`."** R6 stays open in the Step 9.6 review queue — the UI work in 9.6.5 may force a revisit before closing the whole step.

  **Tests.** New CLI test suites at `src/test/{bump-cli,sidecar-cli,hooks-cli}.test.ts` cover the refusal / first-time-creation / batch (with real git) / staged / dry-run / chained-hook / idempotent-reinstall / scaffold paths. File-based SQLite under `.tmp/<scope>/`, never `:memory:`. CLI reference regenerated.

- 305e75a: Step 9.6.6 — plugin annotation contributions + Tier-1 `unknown-field` rule. Closes the last sub-step of the Step 9.6 annotation system.

  **Manifest extension.** `spec/schemas/extensions/base.schema.json` gains an optional `annotationContributions` map keyed by annotation key. Each entry declares an inline JSON Schema for the value plus two policy fields: `location` (`'namespaced'` default, `'root'` opt-in) and `ownership` (`'shared'` default, `'exclusive'` opt-in). Defaults route a contribution into the plugin's `<plugin-id>:` block at the sidecar root; `location: 'root'` lifts it to a top-level reserved key alongside `for` / `annotations` / `settings` / `audit` and REQUIRES `ownership: 'exclusive'`.

  **Loader validation.** `kernel/adapters/plugin-loader.ts` rejects two single-plugin invariants as `invalid-manifest`: `location: 'root'` with non-`exclusive` ownership, and inline `schema`s that fail to AJV-compile. After every plugin has loaded, the runtime composer (`core/runtime/plugin-runtime.ts:loadPluginRuntime`) walks the aggregated catalog and **hard-fails** when two plugins claim the same `(key, location: 'root', ownership: 'exclusive')` tuple — `loadPluginRuntime` throws a new `AnnotationContributionConflictError` and the kernel does NOT boot. Stricter than the per-plugin `invalid-manifest` path because annotation-namespace conflicts are non-recoverable: annotated `.sm` files would otherwise be non-deterministically routed.

  **Runtime catalog.** `Kernel` gains `getRegisteredAnnotationKeys(): readonly IRegisteredAnnotationKey[]`, populated once by `registerEnabledExtensions` after every plugin loads. Pure read; no side effects. Built-in catalog fields from `annotations.schema.json` are NOT included — this catalog is plugin-only. The BFF endpoint that wraps the catalog for UI autocomplete lands separately.

  **`core/unknown-field` rule.** New built-in Tier-1 typo guard (`severity: warn`). Walks parsed `.sm` sidecars and emits a warning for: (1) keys inside `annotations:` not in the curated catalog, (2) top-level keys outside the four reserved blocks that are not a registered plugin namespace nor a registered root contribution, (3) plugin-namespaced values that fail their contributing plugin's schema. The orchestrator threads parsed sidecar roots into the rule pass via `IAnalyzerContext.sidecarRoots` plus the runtime catalog via `IAnalyzerContext.annotationContributions`.

  **Conformance.** New end-to-end case `sidecar-end-to-end` with fixture `spec/conformance/fixtures/sidecar-end-to-end/`. Flips coverage rows 26 + 27 (`sidecar.schema.json` + `annotations.schema.json`) from 🟡 partial to 🟢 covered. Asserts a populated `Node.sidecar` overlay, `status: stale-*` drift, denormalised `annotations.version`, and both `annotation-stale` + `annotation-orphan` issues from the built-in core rules.

  **Side-fix.** `core/annotation-orphan` now emits `nodeIds: [<expectedMdRelative>]` instead of an empty array, closing the pre-existing `issue.schema.json#/properties/nodeIds/minItems: 1` violation latent until the conformance corpus exercised it.

  **Plugin author guide.** New section `## Annotation contributions` in `spec/plugin-author-guide.md` covers the manifest shape, namespacing default vs root opt-in, ownership rules, hard-fail collision behaviour, the Tier-1 typo guard, and the runtime catalog accessor with worked examples. The full guide rewrite for agent-first readability is deferred to a post-Step-9.6 follow-up.

- 305e75a: Step 9.6.2 — kernel sidecar reader + drift detection. The walker now reads `<basename>.sm` next to every `<basename>.md` it finds, validates against `spec/schemas/sidecar.schema.json` + `spec/schemas/annotations.schema.json` via the kernel AJV stack, and computes drift versus the live body / canonical-frontmatter hashes. Stale state surfaces through a new built-in Rule `core/annotation-stale` (`warn` severity); orphan `.sm` files (no matching `.md`) surface through `core/annotation-orphan` (`warn`). Schema-invalid or YAML-malformed sidecars produce an `invalid-sidecar` warning and the scan continues — drift detection is soft-mode, never blocking.

  **Storage extension.** Migration `002_sidecar_columns.sql` extends `scan_nodes` with three new columns: `sidecar_present` (INTEGER 0/1, default 0), `sidecar_status` (TEXT, NULL when absent or unparseable; one of `fresh` / `stale-body` / `stale-frontmatter` / `stale-both` otherwise), and `annotations_json` (TEXT, JSON-encoded `annotations:` block, NULL when absent or empty). The `Node` domain type gains a `sidecar` overlay that round-trips through `node.schema.json`; clients consume it as authoritative for the snapshot but never persist it across scans.

  **Breaking change — `Node.version` type flip.** The denormalised version column was a `TEXT` semver string sourced from `frontmatter.metadata.version`; it is now an `INTEGER` monotonic counter sourced from sidecar `annotations.version` (Decision #125 — single integer, orthogonal to `stability`, no major-bump concept). Pre-9.6.2 rows reset to NULL on migration — greenfield, no automatic semver→integer conversion. `node.schema.json#/properties/version` updated accordingly.

  **Source-of-truth shift for stability / version / author.** The three Node columns previously sourced from `frontmatter.metadata.*` / `frontmatter.author` now source from sidecar `annotations.{stability, version, author}`. Hard cut — the fallback through `pickMetadata` for these three fields is removed in `orchestrator.ts`. Other consumers of `metadata.*` (e.g. broken-ref's `metadata.related`) keep working; their migration lands in Step 9.6.4.

  Coverage matrix rows 26 + 27 (sidecar + annotations schemas) flip from 🟠 deferred to 🟡 partial — kernel reader is covered; full bump-end-to-end (scan → annotation queryable → drift detection → bump) still lands in Step 9.6.6. New tests under `src/test/sidecar-reader.test.ts` cover fresh / stale-body / stale-frontmatter / orphan / malformed-YAML / schema-invalid / unknown-key paths and a persistence round-trip through `scan_nodes`.

- 687823d: R15 closure (Step 9.6 review queue): extend `Node.sidecar` overlay with the full parsed `.sm` root.

  **Spec.** `spec/schemas/node.schema.json#/$defs/sidecarOverlay` gains an optional `root` property (`type: ['object', 'null']`, `additionalProperties: true`). It carries the entire parsed YAML payload of the matching `.sm` sidecar — every reserved block (`for`, `annotations`, `settings`, `audit`) plus any opt-in `<plugin-id>:` namespace. NULL when no sidecar accompanies the node, or when the sidecar exists but failed to parse / validate. The existing top-level `annotations` field stays — `root.annotations` duplicates it by design so pre-R15 consumers reading `sidecar.annotations` keep working unchanged. `spec/index.json` regenerated.

  **Kernel.** `ISidecarOverlay` (in `src/kernel/types.ts`) gains `root?: Record<string, unknown> | null`. The orchestrator's `resolveAndApplySidecar` site stamps `root: result.parsed.raw` (the full root that `parseSidecar()` already builds for the rule pass — no extra YAML reads). On parse failure the overlay ships `{ present: true, status: null, annotations: null, root: null }`; on absent sidecar `{ present: false }` (root absent).

  **Persistence.** Additive sibling column `scan_nodes.sidecar_root_json` (migration `004_sidecar_root_json.sql`) stores the JSON-encoded root alongside the existing `annotations_json`. Option (b) per the R15 brief — no rewrite of the existing `annotations_json` read path. `scan-persistence.ts` writes the column; `scan-load.ts` rehydrates `sidecar.root` from it.

  **BFF.** No route changes: `/api/nodes`, `/api/nodes/:pathB64`, and `/api/graph` are pass-through serializers — the new field flows through automatically once the kernel populates it.

  **UI wire model.** `ISidecarOverlayApi` (in `ui/src/models/api.ts`) gains `root?: Record<string, unknown> | null`. The internal `ISidecarOverlay` (in `ui/src/models/node.ts`) declared the field forward-compat-ready since the inspector-tiering pass; the `projectNode` mapper spreads `api.sidecar` as-is so the field propagates into `INodeView.sidecar.root` unchanged. The WS `sidecar.bumped` patcher (`CollectionLoaderService.patchSidecarFromBump`) preserves `root` across the bump-driven re-render so the inspector audit / debug / plugin-contributions panels stay populated after a bump.

  **Tests.** `src/test/sidecar-reader.test.ts`: fresh-sidecar case asserts `sidecar.root.for.{path,bodyHash}` and `sidecar.root.annotations.{stability,version}`; absent-sidecar case asserts `sidecar.root` is null/absent; persistence round-trip case adds the new `sidecar_root_json` column to the selected projection and asserts the persisted JSON rehydrates correctly. `src/test/server-endpoints.test.ts`: fixture now plants a `.sm` co-located with `architect.md` (pinned to baseline hashes for `status: fresh`); new test case `R15 — surfaces sidecar.root with the full parsed .sm payload` asserts `item.sidecar.root.for.path === target` and `item.sidecar.root.audit.lastBumpedBy === 'cli'` on the `/api/nodes/:pathB64` response.

  **Backward compatibility.** Pre-R15 consumers reading `sidecar.annotations` keep working unchanged — the field is preserved, just duplicates `root.annotations`. New consumers reading structured sub-fields (`root.for.*`, `root.audit.*`, plugin namespaces) light up automatically once their BFF / persistence layer ships this minor.

- 305e75a: Step 9.6.5 (UI half) — sidecar surface in the SPA. Closes 9.6.5 alongside the BFF half that landed earlier on the same date. The `ui/` workspace stays private (per project policy); user-visible UI changes ship bundled inside `@skill-map/cli`.

  **Card stale badge.** `<sm-node-card>` (graph node body) renders an orange `pi-clock` badge in the footer status cluster when `node.sidecar.status ∈ {'stale-body', 'stale-frontmatter', 'stale-both'}`. The tooltip spells out which side drifted (body, frontmatter, or both). Hidden for `fresh`, `present: false`, or absent overlays. `data-testid="node-card-stale-badge"`.

  **Inspector annotations panel.** New reusable `<sm-annotations-panel>` component renders the sidecar `annotations:` block as categorised read-only sections — Lifecycle (`version` / `stability` / `created` / `updated` / `released`), Supersession (`supersedes` / `supersededBy` / `requires` / `conflictsWith` / `provides` / `related`), Provenance (`type` / `author` / `authors` / `license` / `source` / `sourceVersion`), Taxonomy (`tags` / `category` / `keywords`), Display (`icon` / `color` / `priority` / `hidden`), Docs (`docsUrl`). Empty sections collapse; path-typed fields render as clickable `p-chip`s routed through an `(openPath)` output; `source` / `docsUrl` open in `target=_blank rel=noopener`; `stability` renders as a coloured `p-tag`. Inspector view embeds the panel inside a new `inspector-card-annotations` card, gated on `node.sidecar?.present`.

  **Bump button.** "Bump version" button in the inspector header action cluster, disabled when `node.sidecar.status === 'fresh'` (with tooltip explaining why) and enabled otherwise — including when no sidecar exists, since the BFF treats that as first-time creation. Click invokes `SidecarService.bump(path)`, which `POST`s `{ nodePath }` to `/api/sidecar/bump` via Angular's `HttpClient` (no new deps). Errors surface in an inline dismissable banner with code-aware copy: `sidecar-fresh` / `not-found` get bespoke messages; everything else falls back to a generic prefix + the BFF envelope's `message`.

  **WS subscription.** `SidecarService` subscribes once at construction to the existing WS event stream and patches the in-memory node store via a new `CollectionLoaderService.patchSidecarFromBump` mutator on every `sidecar.bumped` frame. The card stale badge clears, the annotations panel re-renders the new version, and the inspector's `canBump` flips to false — all reactive via Angular signals, no graph refetch. The BFF emits `sidecar.bumped` as a flat `{ type, nodePath, version, status }` shape (no `timestamp` / `data` envelope); the SPA's `isWsEvent` guard now accepts that shape explicitly and a new `isSidecarBumpedEvent` validates the flat siblings.

  **Stale-only list filter.** `FilterStoreService` gains a `staleOnly` signal mirrored to the URL by `FilterUrlSyncService` as `?staleOnly=true`. The filter bar gets a `Stale only` toggle button (`pi-clock` icon, `data-testid="filter-stale-only"`). When active, `apply()` filters in only nodes whose sidecar overlay falls in the stale set.

  **Tests.** Unit tests added for the card badge gating (`node-card.spec.ts`), the annotations panel sectioning + chip emissions (`annotations-panel.spec.ts`), the SidecarService HTTP + WS surface (`sidecar.spec.ts`), and 9 new cases in `inspector-view.spec.ts` covering the bump-button enable matrix, click → service invocation, and the error-banner paths. UI suite: 236 tests pass. e2e suite (`e2e/smoke/sidecar.spec.ts`) adds 4 demo-bundle cases — `Stale only` filter visibility + URL flag round-trip, bump button rendering on a selected node, annotations card hidden for nodes without a sidecar overlay. Happy-path bump-and-clear stays in unit tests because the e2e harness is demo-only (no live BFF); a follow-up that wires Playwright against `sm serve` is out of scope for 9.6.5.

  **Decisions surfaced.** (a) The BFF's flat WS event shape diverged from the `IWsEvent` envelope contract — handled by relaxing the SPA's runtime guard, flagged for the review queue alongside R7 (REST envelope kind enum). (b) `INodeApi` / `INodeView` now publicly carry `sidecar`; consistent with R1's current bias of keeping the overlay public. No new dependencies.

- 305e75a: Step 9.6.7 — wire-shape cleanup. Closes two §Step 9.6 review-queue items in one batch (R7 + R9) so the BFF's REST and WS surfaces match the canonical contracts every other route already follows.

  **R7 — REST envelope `kind` enum gap (`sidecar.bumped` + `annotations.registered`).** `spec/schemas/api/rest-envelope.schema.json` grew from four `oneOf` variants to six. `'sidecar.bumped'` (action-result variant: `value` + `elapsedMs`, no `filters` / `counts` / `kindRegistry`) covers `POST /api/sidecar/bump`. `'annotations.registered'` (catalog variant: `items` + `counts.total` only, no `filters` / `kindRegistry` / `returned`) covers `GET /api/annotations/registered`. The list variant re-imposes `counts.required: ['total', 'returned']` via per-variant override so its tally shape stays strict. `elapsedMs` is now a top-level optional integer property, present only on action-result envelopes.

  **R9 — WS event shape asymmetry.** `src/server/routes/sidecar.ts` now wraps the `sidecar.bumped` payload in the canonical `IWsEventEnvelope` shape `{ type, timestamp, data: { nodePath, version, status } }` (matches every kernel→broadcaster bridge — `scan.*`, `watcher.*`). `timestamp` serialises as an ISO 8601 string via `new Date().toISOString()`, matching the kernel orchestrator's `makeEvent`. The prior flat shape (`{ type, nodePath, version, status }`) forced the UI to accept two shapes in `isWsEvent`; that relaxation is now obsolete (the UI half lands in a follow-up `ui/` PR).

  **Tests.** `src/test/server-sidecar-endpoint.test.ts` and `src/test/server-annotations-endpoint.test.ts` each gain an AJV-compile + validate pass against `rest-envelope.schema.json` over the live 200 responses, so any future drift in the route or in the schema fails immediately. The sidecar test's broadcaster-receipt assertion now checks the canonical envelope (timestamp ISO regex, `data.{nodePath,version,status}`, no flat siblings).

  **Spec doc.** `spec/cli-contract.md` BFF subsections (`POST /api/sidecar/bump`, `GET /api/annotations/registered`) updated — both `kind` values are now part of the canonical enum, the WS event documents the wrapped envelope. `spec/index.json` regenerated.

  No new dependencies; AJV is already on the path (`Ajv2020` from `ajv/dist/2020.js`, used by the unknown-field rule). No CLI-verb surface changes.

- 1019d5f: Pluggable kernel walker + parser registry. Provider manifests gain a declarative `read: { extensions, parser }` field; the kernel owns the file walker and a closed registry of built-in parsers. The Claude Provider drops its hand-rolled `walk()` (~70 lines of fs walking + frontmatter parsing) and becomes pure metadata + classification.

  Cross-provider kind sharing via a restructured `kindRegistry`: when two Providers declare the same kind name (e.g. `agent` for both Claude and a future Gemini Provider), every contribution is kept. Per-node painting can pick the matching Provider's color — the data shape supports it without forcing a kernel-side rename of every shared kind.

  **`@skill-map/spec`**

  - `extensions/provider.schema.json` — new optional `read` field. Validates `extensions: string[]` (each starting with a dot, matching `^\.[a-z0-9]+$`) and `parser: string`. Defaults at the call site (`{ extensions: ['.md'], parser: 'frontmatter-yaml' }`); not silently injected at manifest load. Precedence: when a Provider also declares the runtime `walk()` field, `walk()` wins and `read` is ignored — the runtime field is the escape hatch for non-standard discovery.
  - `api/rest-envelope.schema.json` — `kindRegistry.additionalProperties` restructured. Old shape `{ providerId, label, color, ... }` becomes `{ primaryProviderId, providers: { <providerId>: { label, color, colorDark, emoji, icon } } }`. The primary drives the kind's visible label / color / icon and the `--sm-kind-<kind>` CSS var; secondary contributors live under `providers` so per-node painting can pick the matching Provider's contribution.
  - `index.json` regenerated.

  **`@skill-map/cli` — kernel walker + parser registry**

  - New `src/kernel/scan/walk-content.ts` — `walkContent(roots, options)` async generator. Owns the audit-cleared defences (M7 symlink skip, TOCTOU stat re-check, ignore filter integration, bundled-defaults fallback) so every Provider that uses `read` inherits them.
  - New `src/kernel/scan/parsers/{types,frontmatter-yaml,plain,index}.ts` — closed registry. Built-ins: `frontmatter-yaml` (YAML frontmatter inside `--- … ---` fences, prototype-pollution-safe, `js-yaml` `JSON_SCHEMA` pinned), `plain` (entire body, empty frontmatter — for files carrying no frontmatter convention). `getParser(id)` resolves by id; `registerParser` is kernel-internal (not re-exported from `src/kernel/index.ts`) and rejects collisions with frozen built-in ids.
  - `IProvider` extended: optional `read?: IProviderReadConfig`, `walk` becomes optional. `resolveProviderWalk(provider)` returns `provider.walk` when defined, else closes over `walkContent` with `provider.read ?? defaults`. The orchestrator at `kernel/orchestrator.ts:1035` flips to `resolveProviderWalk(provider)(...)` — single-line edit.
  - `built-in-plugins/providers/claude/index.ts` migrates to declarative form. Drops `walk()`, `walkMarkdown`, `splitFrontmatter`, `FRONTMATTER_RE`, `FORBIDDEN_FRONTMATTER_KEYS`, plus the `fs/promises`, `path`, `js-yaml`, and `IIgnoreFilter` imports. Adds `read: { extensions: ['.md'], parser: 'frontmatter-yaml' }`. File shrinks from 270 to 158 lines. Behaviour identical (the audit-cleared defences live in the kernel walker / parser).
  - Tests for `frontmatter-yaml.test.ts`, `plain.test.ts`, `parsers/index.test.ts`, `walk-content.test.ts` — 28 new cases covering happy paths, malformed input, prototype-pollution strip, registry resolution + freeze semantics, M7 symlink skip, TOCTOU re-check, custom extensions, default-applied path. Existing `claude.test.ts` and `pollution-defence.test.ts` migrate to `resolveProviderWalk(claudeProvider)(...)`.

  **`@skill-map/cli` — kindRegistry refactor**

  - `src/server/kind-registry.ts` rewrites `buildKindRegistry`: per kind, first Provider in iteration order populates `primaryProviderId` and seeds `providers`; later Providers append to `providers[provider.id]` without overwriting the primary. The kernel separately surfaces `provider-ambiguous` issues for files matched by multiple Providers; the registry stays coherent during the conflict window.
  - `src/server/envelope.ts` types updated to match the wire shape (`IKindRegistryEntry` carries `primaryProviderId` + `providers`; new `IKindRegistryProviderUi` for the per-Provider sub-entry).
  - New `src/server/kind-registry.test.ts` — 4 cases covering single-provider entries, cross-provider sharing, ordering, and the empty case. The `test:ci` glob picks up `server/**/*.test.ts` going forward (was kernel + built-in-plugins + test/ only).

  **UI (`ui/`, private workspace)**

  - `models/api.ts` adds `IKindRegistryProviderUiApi` and reshapes `IKindRegistryEntryApi` to match the new wire shape.
  - `services/kind-registry.ts` — ingest now flattens the primary Provider's visuals onto the entry so existing `lookup` / `labelOf` / `colorOf` / `iconOf` keep working unchanged. New `providersOf(name)` returns the full per-Provider map for surfaces that paint per-Provider. `applyCssVars` keeps emitting `--sm-kind-<kind>` from the primary — every static CSS reference (`node-card.css`, `kind-palette.css`, `inspector-view.css`) survives without changes.
  - 3 spec files updated to construct the new wire shape in fixtures (`kind-registry.spec.ts`, `graph-view.spec.ts`, `list-view.spec.ts`, `filter-url-sync.spec.ts`); `kind-registry.spec.ts` adds 2 new cases for cross-provider sharing and CSS-var derivation.

  **Demo dataset (`web/scripts/build-demo-dataset.js`)**

  - The hardcoded `DEMO_KIND_REGISTRY` is updated to the new shape and regenerated as part of `web:build`. The legacy `hook` entry (already obsolete since spec 0.17.0) is dropped to keep the demo aligned with the active built-in catalog.

  **Known limitation (deferred to Phase B).** With shared kind names possible, a node sourced from a non-primary Provider currently renders in the primary's color — the data shape (`entry.providers[node.provider]`) supports per-Provider painting, but the consumer-side fix (node-card / inspector reading `node.provider` to pick the matching color) ships in Phase B alongside the new Providers, when shared kind names are actually produced. During this release window no Provider produces shared kind names, so the tradeoff has zero user-visible impact.

  **Backward compatibility.** Greenfield (`feedback_greenfield_no_versioning.md`): no released consumer holds the prior `kindRegistry` shape or relies on a Provider's hand-rolled `walk()`. Stays minor pre-1.0 per `versioning.md` § Pre-1.0.

### Patch Changes

- 79dfdea: Step 9.6 catalog curation. The annotation surface settled in Steps 9.6.1 → 9.6.7 went through a UX review on 2026-05-07; 16 fields with no clear value or that duplicated other surfaces were dropped from the curated catalog, and the per-bump rationale field `audit.bumpReason` was rolled back together with its CLI / BFF inputs.

  **Annotations dropped (16).** `spec/schemas/annotations.schema.json` no longer documents `provides`, `type`, `author`, `created`, `updated`, `category`, `keywords`, `icon`, `color`, `priority`, `readme`, `examplesUrl`, `github`, `homepage`, `linkedin`, `twitter`. The schema stays `additionalProperties: true`, so legacy / opaque keys still ride through; the built-in `unknown-field` rule warns on any of them as a typo. Greenfield, no migration: no released consumer depended on these in `annotations.*`.

  **Annotations kept (15).** `version`, `stability`, `supersedes`, `supersededBy`, `requires`, `conflictsWith`, `related`, `authors`, `license`, `source`, `sourceVersion`, `released`, `tags`, `hidden`, `docsUrl`. The load-bearing versioning + supersession block is unchanged.

  **`audit.bumpReason` rolled back.** Removed from `spec/schemas/sidecar.schema.json#/$defs/audit/properties`. CLI: `--reason` flag dropped from `sm bump`; `IBumpInput.reason` removed; `buildAudit` no longer emits the field. BFF: `reason` removed from the `POST /api/sidecar/bump` JSON body schema. Tests assert the audit block surfaces `lastBumpedAt` / `lastBumpedBy` only on a bump-without-reason path. The audit block stays `additionalProperties: true` so the field can ride opaquely if a legacy sidecar carries it; the schema just doesn't curate it anymore. R6's mitigation set drops the bumpReason reference — the contract is now "bump rewrites the file; narrative goes in the `.md` body, which is never touched".

  **deepMerge null-as-delete primitive retained.** The kernel's `FilesystemSidecarStore.deepMerge` still treats a `null` patch value as a delete sentinel. No current caller after the bumpReason rollback, but the primitive is architecturally sound for future Actions that need per-write erase semantics. JSDoc updated to flag this; the unit tests stay (renamed the example field name from `bumpReason` to a neutral placeholder).

  **Fixtures + conformance.** All `.sm` files in `fixtures/local-scope/` and `fixtures/demo-scope/` trimmed to the curated set; the kitchen-sink reference fixture trimmed to 15 annotations + the load-bearing supersession block (kept the `example-plugin:` namespace). Conformance fixture `spec/conformance/fixtures/sidecar-end-to-end/agents/stale.sm` trimmed (removed `type` + `author`) so the `unknown-field` rule's expected warning count matches the case file's `issuesCount: 2` assertion. Structural sample at `spec/conformance/fixtures/sidecar-example/agent-example.sm` trimmed to the curated catalog.

  **Spec docs.** `spec/architecture.md` `## Annotation system` section: catalog list updated, `audit.bumpReason` line dropped, bump-field-set stability clause rewritten to enumerate the four current audit fields with `additionalProperties: true` documented. `spec/cli-contract.md`: `--reason` removed from the two `sm bump` rows; the worked `.sm` round-trip example trailing line replaced; `POST /api/sidecar/bump` body shape no longer carries `reason`. `spec/conformance/coverage.md` row 27 updated. `spec/index.json` regenerated.

  **ROADMAP.md.** §Step 9.6 carries a `Catalog curation 2026-05-07` note enumerating the dropped + kept sets; R6's mitigation list drops the bumpReason mention; the abridged decisions and §Frontmatter standard catalog descriptors updated.

  **Out of scope.** UI display tiering (4-tier vendor/plugin layout, inspector sections) is a separate task delegated to app-agent later. Kernel `Node.author` denormalization stays untouched — `author` rides on `additionalProperties: true` for users who want to keep writing it informally; the read path persists the value but the field is no longer curated.

- 71aab31: Internal cleanup across `src/`. No public API or CLI surface change. Absorbs the M2, M3, M5, M7, M8 findings from the latest `cli-architect` review on `src/` (C1, C2, M1 already shipped in the previous commit).

  M3 — plugin runtime cached at BFF boot. Previously every request to `/api/graph`, `/api/plugins`, and `/api/scan?fresh=1` re-walked `.skill-map/plugins/`, opened/closed SQLite, recompiled AJV validators, and re-logged warnings. `assembleKindRegistry` is renamed `assembleBootBundle` and now returns `{ pluginRuntime, kindRegistry }` from a single discovery pass; `IAppDeps` and `IRouteDeps` carry the new `pluginRuntime: IPluginRuntimeBundle`. `routes/graph.ts` and `routes/plugins.ts` drop their per-request `loadPluginRuntime` / `emptyPluginRuntime` / sanitization plumbing and consume `deps.pluginRuntime` directly. `routes/scan.ts` (`?fresh=1`) threads the cached bundle into the runner via the new `IScanRunOpts.pluginRuntime?` override — when present, `preparePluginRuntime` returns it as-is and skips the warning emission (already logged at boot). Plugin warnings now log exactly once per `sm serve` lifetime; under load the read-side routes are pure in-memory lookups. Trade-off documented inline: installing a new plugin requires `sm serve` restart, matching the watcher contract.

  M2 — non-negative integer parser consolidated to a single primitive. Four near-identical implementations (`serve.ts: parsePort` / `parseDebounce`, `watch.ts: parseBreakerLimit`, `db.ts` inline) collapsed onto a new `tryParseNonNegativeInt(raw): number | null` in `cli/util/option-validators.ts` (pure, no side effects). The existing `parsePositiveIntegerOption` is refactored to reuse the same primitive. Each call site keeps its verb-scoped error message (i18n stays per-verb) — the primitive itself never writes to stderr; the call sites do. Acceptance rules and user-facing messages are byte-identical.

  M5 — fix stale debounce default in `server/options.ts:101-105` (said "default 250ms"; canonical is 300ms per `config/defaults.json:14` and `spec/cli-contract.md` § Watch). One-liner with the two source-of-truth references.

  M7 — watcher CLI adapter no longer loads config twice at boot. `cli/commands/watch.ts` previously parsed `loadConfig` just to print the "starting on N root(s), debounce Xms" preview line, then `start()` re-loaded the same config inside the runtime. New `onConfigLoaded({ debounceMs })` event in `IWatcherEvents`, fired synchronously inside `start()` as soon as `loadEffectiveConfig()` resolves; the CLI subscribes and prints the preview from the runtime's load. Single source of truth, one config load. The redundant `loadConfig` import and call are gone.

  M8 — scan-runner printer becomes mandatory. The fallback `createPrinter({ stdout: opts.stderr, stderr: opts.stderr })` inside `runScanForCommand` was a footgun: any future `printer.data()` call would silently route to stderr, making the CLI (data → stdout) and BFF (data → stderr) diverge undetected. `IScanRunOpts.printer` flips from optional to required; the import of `createPrinter` from the runner is dropped (only `type IPrinter` remains). The BFF builds a purpose-built `bffScanRunnerPrinter` in `routes/scan.ts` that discards `data` (the response body is the `ScanResult` JSON) and routes `warn` / `info` / `error` to `log.warn`. CLI verb call sites already passed the printer from `SmCommand` — no change there.

  Net: 13 files modified, 0 new. +196 / −111. `npm run validate` in `src/` (typecheck + lint + build + 963 tests + reference:check) is green.

- 9d64507: Internal cleanup across `src/`. No public API or CLI surface change. Closes the M4 + M6 themes plus the residual minors (m2–m9), the n1 nit, and the H1 hypothesis from the latest `cli-architect` review on `src/`.

  M4 — `IPrinter` adoption across `cli/commands/**`. Pre-M4: 183 direct writes to `this.context.std{out,err}.write` spread over 20 verb files. Post-M4: zero. Mapping rules applied verbatim — `stdout.write(...)` → `printer.data(...)` (response payload), `stderr.write(...)` for banners / progress / status → `printer.info(...)` (silenced under `--quiet`), `stderr.write(...)` preceding an error exit → `printer.error(...)`, plugin-level advisories that don't fail the verb → `printer.warn(...)`. Migrated: `init`, `version`, `list`, `check`, `plugins`, `conformance`, `jobs`, `db`, `graph`, `config`, `show`, `history`, `refresh`, `serve`, `tutorial`, `scan`, `scan-compare`, `watch`, `export`, `orphans`. `help.ts` is exempt because `HelpCommand` / `RootHelpCommand` extend Clipanion's `Command` directly (not `SmCommand`) — the help renderer has no `printer` to route through and `--json` / `-g` / `--quiet` don't apply to the help surface anyway. New `eslint.config.js` block on `cli/commands/**/*.ts` (with `help.ts` in `ignores`) raises a `no-restricted-syntax` error against `this.context.std{out,err}.write` so the next regression fails lint instead of slipping through review.

  M6 — stubs inherit `SmCommand`. `stubs.ts` previously extended `Command` directly, which made `sm <stub> --json` fail with "Unknown option" because the global flag parser was never wired in. New `StubCommand extends SmCommand` base sets `emitElapsed = false` (planned verbs don't earn timing telemetry), declares an abstract `verbName: string`, and centralises `run()` — every stub now drops to a minimal subclass declaring `paths` + `usage` + verb-specific Options + `verbName`. `JobSubmitCommand`'s `--run` field is renamed internally to `runFlag` so it doesn't shadow the inherited `run()` method (the user-facing `--run` flag is preserved unchanged). `context/cli-reference.md` is regenerated because every stub now exposes the global flag set in its `--help`.

  Minors (cli-architect review): m2 — `IShowDocument` in `cli/commands/show.ts` becomes `Pick<INodeBundle, 'node' | 'linksOut' | 'linksIn' | 'issues'>`, so a future kernel rename surfaces as a TS error instead of silent CLI/BFF drift. m3 — `kernel/util/skill-map-paths.ts: KERNEL_SKILL_MAP_DIR` re-exports `SKILL_MAP_DIR` from `core/paths/db-path.ts` instead of duplicating the `'.skill-map'` literal; the historic name is preserved for callers. m4 — the one-liner re-export shim `cli/util/error-reporter.ts` is deleted; eight callers (`config`, `db`, `serve`, `tutorial`, `scan-compare`, `conformance`, `jobs`, `refresh`) now import `formatErrorMessage` directly from `kernel/util/format-error.js`. m5 — the inline `RUNTIME_TEXTS` const in `core/watcher/runtime.ts` moves to a sibling i18n file at `core/watcher/i18n/runtime.texts.ts` (parity with `core/runtime/i18n/{plugin-runtime,scan-runner,progress-emitter}.texts.ts`). m7 — `server/routes/scan.ts` forwards `noBuiltIns` / `noPlugins` from the gated options bag instead of hardcoding `false`; the early HTTP 400 already rejects truthy combinations, so passing the values through preserves intent without leaving cosmetic-driven drift if a third pipeline flag ever lands. m8 — `cli/commands/db.ts` adopts `pluginRuntime.emitWarnings(printer)` (parity with the rest of the read-side verbs) instead of its own `for (const w of warnings)` loop. m9 — the watcher runtime closes chokidar handles via `closeQuietly()` _before_ `requestStop()` on the breaker-tripped and `maxBatches` terminal paths, so callers no longer need a defensive `await handle.stop()` after `await whenStopped`; the CLI's redundant double-stop is gone, replaced by a comment that documents the contract.

  H1 (latent runtime bug fix): when `runInitial` rejects with `failOnInitialError === true`, the watcher runtime now flips `stopped = true; requestStop();` _before_ propagating the error, so a caller doing the natural `await start(); await whenStopped` gets a resolved `whenStopped` instead of hanging forever. The CLI today returns early after the catch and so the bug never surfaced in production, but the abstraction was brittle. Inline comment cites audit H1.

  n1 — the `cli/util/db-path.ts` header no longer duplicates the `-g/--global` and `--db <path>` contract; that lives canonically on `cli/util/sm-command.ts` (where the Clipanion options are declared). Replaced with a one-line pointer to the source of truth.

  Net: 27 files modified (including `context/cli-reference.md`), 1 new (`core/watcher/i18n/runtime.texts.ts`), 1 deleted (`cli/util/error-reporter.ts`). `npm run validate` in `src/` (typecheck + lint + build + 963 tests + reference:check) is green.

- 9c4680f: Internal cleanup across `src/cli/`, `src/kernel/`, `src/server/`, `src/conformance/`. No public API changes. Folds 22 hand-rolled `(err as Error).message` / `err instanceof Error ? err.message : String(err)` sites onto a kernel-level `formatErrorMessage` helper (`src/kernel/util/format-error.ts`). Kills inline `'.skill-map'` literals outside the path-helper modules — kernel callers now route through `src/kernel/util/skill-map-paths.ts`, CLI callers through the existing `defaultSettingsPath` / `defaultIgnoreFilePath` helpers. Wires the `IPrinter` channel surface into `SmCommand`: status banners (`Initialised`, `Running first scan…`, `Updated .gitignore`, dry-run plan, `sm job prune` retention rows) now route through `printer.info` to stderr (consistent with the M1 review), with the public-facing payload still reserved for stdout. New `pluginRuntime.emitWarnings(printer)` consolidates six identical for-loops; new `registerEnabledExtensions(kernel, pluginRuntime)` consolidates the five-site built-ins-+-plugins manifest registration dance. Adds `WATCH_TEXTS.maxConsecutiveFailuresInvalid`, `DB_TEXTS.dumpFailure`, `SERVE_TEXTS.uiDistInvalid` for previously-inline English; `requireDbOrExit(path, stderr)` collapses the 14-site `if (!assertDbExists(...)) return ExitCode.NotFound` boilerplate; `THealthDbState` narrows to `'present' | 'missing'` (the `'error'` state was reserved but never produced — widening the union later is non-breaking). New BFF query helper `src/server/util/parse-query.ts` (`parseCsv`, `parsePagination`, `parseBooleanFlag`) replaces hand-rolled equivalents in `routes/nodes.ts`, `routes/issues.ts`, `routes/links.ts`, `routes/scan.ts`. New kernel-level `matchesAnalyzerFilter` (`src/kernel/util/analyzer-filter.ts`) replaces the inline copy in `cli/commands/check.ts` and `server/routes/issues.ts`. Per-route plugin-warnings forwarding (`routes/plugins.ts`, `routes/graph.ts`, `routes/config.ts`) now flows through `log.warn(sanitizeForTerminal(warn))` instead of `process.stderr.write` directly. Behaviour-visible change: `sm init` and `sm init --dry-run` print their status banners to stderr now (so a future `--json` mode can keep stdout clean); test suite updated accordingly.
- 1132e69: Internal architectural cleanup across `src/`. No public API or CLI surface change. Absorbs the C1, C2, M1 findings from the `cli-architect` review on `src/`. C1 — eliminates the residual `core/ → cli/` boundary leak the v0.6 audit could not surface structurally: `IPrinter` + `createPrinter` move to `core/runtime/printer.ts` (was `cli/util/printer.ts`); `truncateHead` / `truncateTail` move to `kernel/util/text.ts` (was `cli/util/text.ts`); `createCliProgressEmitter` is renamed `createStderrProgressEmitter` (the helper is stream-based, never was CLI-specific) and lifted to `core/runtime/progress-emitter.ts` with its catalogue at `core/runtime/i18n/progress-emitter.texts.ts`; the two strings the runtime itself emitted (`changedNoPriorWarning`, `priorSchemaValidationFailed`) move from `cli/i18n/scan.texts.ts` to a new `core/runtime/i18n/scan-runner.texts.ts`. Historic `cli/util/{printer,text,cli-progress-emitter}.ts` and `cli/i18n/cli-progress-emitter.texts.ts` stay as thin re-export shims so every CLI / test import keeps working unchanged. C2 — adds a third `core/**` block to `src/eslint.config.js`, peer of the existing `kernel/**` block: `no-restricted-imports` blocks `../cli/*` at every depth (8 patterns); `no-restricted-syntax` blocks `process.cwd()` and `process.env` reads with messages that point to the correct fix (inject through `IRuntimeContext` or resolve in the CLI / BFF adapter). One narrow exception: `core/runtime/runtime-context.ts:32` carries `eslint-disable-next-line no-restricted-syntax` over the single `process.cwd()` read — this is the factory that lifts the live process context into the typed `IRuntimeContext` bag every other `core/` module consumes. M1 — `composeScanExtensions` no longer reads `process.env`. New exported type `IConformanceKillSwitches` (in `core/runtime/plugin-runtime.ts`) and new helper `cli/util/conformance-env.ts: readConformanceKillSwitches(env?)` reads the three kill-switch env vars (`SKILL_MAP_DISABLE_ALL_{PROVIDERS,EXTRACTORS,RULES}`) at the CLI boundary, treating only the literal `'1'` as truthy so a stray developer-shell export cannot silently disable production scans. Five CLI verbs wire the bag through options (`scan.ts`, `check.ts`, `refresh.ts`, `scan-compare.ts`, `watch.ts`); `core/watcher/runtime.ts` accepts `killSwitches` per call and threads it to the composer per-batch; `core/runtime/scan-runner.ts` adds `killSwitches?` to `IScanRunOpts`. The BFF intentionally does not honour the env vars (production caller). Tests: `plugin-runtime-branches.test.ts` is reorganised — composer behaviour is tested with `killSwitches` injected directly (4 cases), and the env-var contract is tested at the helper (3 cases including the `'1'`-literal enforcement). The existing `conformance-disable-flags.test.ts` integration suite still passes intact (sub-process injects env, the verb reads at the boundary). Drive-by: drops a stale `eslint-disable-next-line complexity` in `cli/commands/check.ts` whose function no longer triggers the rule. Net: 16 modified, 6 new, +246/-279.
- d529e47: Internal architectural cleanup across `src/`. No public API or CLI surface change. Extracts a new `src/core/` boundary (`runtime/`, `sqlite/`, `paths/`, `watcher/`) so the BFF (`src/server/`) no longer reaches into `src/cli/util/` for shared machinery — the two grep gates (`from '../../cli/util'` and `from '../cli/util'` under `src/server/`) now both return zero. Physically moves `runScanForCommand` / `composeScanExtensions` / `loadPluginRuntime` / `emptyPluginRuntime` / `defaultRuntimeContext` (plus their i18n texts), `tryWithSqlite` / `withSqlite`, and `defaultProjectPluginsDir` plus sibling pure path helpers into `core/`; the old `cli/util/{runtime-context,with-sqlite,plugin-runtime,scan-runner,db-path}.ts` modules become thin re-export shims so historic CLI/test imports keep working. CLI-only helpers (`assertDbExists`, `requireDbOrExit`, ExitCode-aware paths) stayed in `cli/util/db-path.ts`. The BFF now imports `formatErrorMessage` directly from `kernel/util/format-error.ts` instead of going through the `cli/util/error-reporter.ts` shim. Watcher consolidation: new `src/core/watcher/runtime.ts` exports `createWatcherRuntime(opts): IWatcherRuntimeHandle` with pure machinery (config + ignore filter, plugin-runtime load, primary + meta-file chokidar wiring, debounced batch dispatch, prior-snapshot strict validation, persist branch, circuit breaker, `maxBatches` test hook) and an events bag (`onBatch`, `onWatcherError`, `onPluginWarning`, `onReady`, `onBreakerTripped`); `subscribeBeforeInitial` knob preserves both adapters' historic ordering. `cli/commands/watch.ts` shrank 465→322 lines, `server/watcher.ts` shrank 468→178 lines — each is now just the Clipanion / Hono adapter. `cli/commands/init.ts` drops its inline pipeline composition and reuses `runScanForCommand` with `noPlugins: true` / `allowEmpty: true`, mapping the discriminated outcome to `INIT_TEXTS.*` framing. `server/health.ts` memoises `resolveSpecVersion()` via a module-level cached promise (`??=`), so the dynamic import only runs once per process. Net: 21 files modified, 7 new files under `src/core/`, 1 file deleted, ~−1555 lines.
- 529c106: Internal refactor of the frontmatter extractor in `src/built-in-plugins/extractors/frontmatter/index.ts`. No behavior change — same emission rules, same dedup, same comment about the inverse-direction `supersededBy` edge. The duplicated body that processed each annotations-shaped block (sidecar `annotations:` and legacy `metadata:` frontmatter) is extracted into a new `processBlock(block, sourcePath, emit)` helper at module scope, plus a small `EmitFn` type alias. `extract` now does only: build the `seen` dedup set + `emit` closure, then call `processBlock` once per source. Drops cyclomatic complexity from 15 to under the project's max of 8 so the file no longer needs a per-function ESLint disable. Lint, typecheck, and the extractor test suite (30/30) are green.
- faaa813: Fix Step 9.6 migration gap in the `frontmatter` extractor. The extractor was emitting structured links (`supersedes`, `supersededBy`, `requires`, `related`, `conflictsWith`) by reading the legacy `metadata:` block in markdown frontmatter; Step 9.6.2 hard-cut the column denormalisation (`stability` / `version` / `author`) but never migrated this link-emission path. Result: any node whose annotations migrated to the new `.sm` sidecar lost its structured links from the graph (visible as a sudden link gap in the UI after the fixture migration).

  Now the extractor reads the sidecar `annotations:` block first (the canonical Step 9.6 home) and falls back to legacy `metadata:` for unmigrated nodes. Both sources contribute; edges are deduplicated by `(source, target, kind)` so a node that lives on both shapes during the transition does not produce duplicate links. Adds support for `annotations.conflictsWith` (new annotation field, emits as `references` to stay within the existing `emitsLinkKinds`).

  The kitchen-sink reference fixture in `fixtures/local-scope/.claude/agents/` and `fixtures/demo-scope/.claude/agents/` plus the demo / local fixture migration (legacy `metadata:` → `.sm` sidecars) ride along with this changeset since they exercise the new extractor path end-to-end. The local-scope and demo-scope graphs now show 15 links each (versus 5 with only body-extracted at-directive / slash links).

- ead5cab: Internal refactor: move BFF error message literals (catch-all 404 envelopes, sidecar bump refusals, body-parse failures, missing-invoke envelope) into `src/server/i18n/server.texts.ts` so every operator-facing string lives in one catalog. The route bodies now reference `SERVER_TEXTS.*` keys (interpolated through `tx()` for the path-bearing 404s) instead of inlining the literals.

  No wire / behavior change: the rendered messages are byte-identical to what the routes emitted before, including the load-bearing `sidecar-fresh:` prefix on the 409 refusal that the UI pattern-matches against. The local `REFUSAL_MESSAGE` constant in `routes/sidecar.ts` is dropped — its sole consumer reads the catalog now.

  Why: the i18n catalog already owned every other operator-facing string (boot banners, watcher errors, broadcaster diagnostics); these eight remained inlined and were the last drift surface for "where do server error messages live". Future locale work / log-grep affinity benefits from the single source.

- Updated dependencies [305e75a]
- Updated dependencies [79dfdea]
- Updated dependencies [79dfdea]
- Updated dependencies [670eaa4]
- Updated dependencies [d12f7d2]
- Updated dependencies [e17ff6a]
- Updated dependencies [864e373]
- Updated dependencies [c47c131]
- Updated dependencies [305e75a]
- Updated dependencies [305e75a]
- Updated dependencies [305e75a]
- Updated dependencies [305e75a]
- Updated dependencies [305e75a]
- Updated dependencies [305e75a]
- Updated dependencies [687823d]
- Updated dependencies [305e75a]
- Updated dependencies [1019d5f]
  - @skill-map/spec@0.18.0

## 0.17.0

### Minor Changes

- bd5e360: Absorb Anthropic Claude's documented frontmatter verbatim into the Claude Provider's per-kind schemas, drop the obsolete `hook` node kind.

  - `agent.schema.json` declares all 14 vendor-specific fields from https://code.claude.com/docs/en/agents.md (`tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `effort`, `isolation`, `color`, `initialPrompt`). camelCase preserved.
  - New `skill-base.schema.json` carries the 13 shared fields from https://code.claude.com/docs/en/skills.md (Anthropic merged custom commands into skills): `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `allowed-tools`, `model`, `effort`, `context`, `agent`, `hooks`, `paths`, `shell`. Naming reproduced verbatim — mix of kebab-case, snake_case, and camelCase. `skill.schema.json` and `command.schema.json` are thin `allOf` extensions of the new base; kept SPLIT (not aliased) because the registry differentiates them in `IProviderKind.ui` and the qualified `defaultRefreshAction`. No kind-only fields today; ready for divergence.
  - `hook.schema.json` deleted. `.claude/hooks/*.md` is NOT an Anthropic convention — hooks live in `settings.json` or as sub-objects of agent / skill frontmatter (https://code.claude.com/docs/en/hooks.md). Files at the old path now classify as `note` via the Provider's fallback. `NodeKind` shrinks from `'skill' | 'agent' | 'command' | 'hook' | 'note'` to `'skill' | 'agent' | 'command' | 'note'`.
  - New runtime field `IProvider.schemas?: unknown[]` lets a Provider declare auxiliary JSON Schemas its per-kind schemas `$ref` by `$id`. `buildProviderFrontmatterValidator` registers them via `addSchema` BEFORE compiling per-kind schemas, so cross-file `$ref` resolution succeeds. Used by the Claude Provider to register `skill-base.schema.json`. Runtime-only — does NOT appear in spec's `provider.schema.json` manifest.
  - Conformance: `minimal-claude/hooks/` deleted; `basic-scan` now asserts 4 nodes (one per kind: agent, command, skill, note) instead of 5; `coverage.md` updated.

  UI alignment ships in a follow-up PR — `ui/src/models/node.ts` carries an `ISummaryHook` shape and a `kind: 'hook'` literal that belong to a separate scope. Today's UI bundle still compiles and tests pass because the UI's `TNodeKind = string` (open) and never imported the kernel's narrowed `NodeKind`.

  Breaking but greenfield-permitted per `versioning.md` § Pre-1.0: ships as a minor bump because `@skill-map/cli` is still 0.x and the only released consumers (the demo scope, the e2e fixtures) all carry `name`+`description` and no longer-required `metadata` keys (those flow through via `additionalProperties: true`). The frontmatter contract stays compatible at the consumer edge for every node that already validated. Stays minor; the first 1.0.0 is a deliberate stabilization moment, not a side-effect of this PR.

- 77579b3: Add a `sm db browser` sub-command that opens the project's SQLite DB in DB Browser for SQLite (sqlitebrowser GUI). Read-only by default; pass `--rw` to enable writes. Replaces the previous `scripts/open-sqlite-browser.js` standalone script.

  The root `npm run sqlite` shortcut now invokes the project-built CLI binary (`node src/bin/sm.js db browser`) instead of the standalone script. This guarantees the locally compiled CLI is used, not whichever `sm` resolves on PATH (a globally installed `@skill-map/cli` would otherwise shadow the in-development version).

  Spec: `cli-contract.md` documents the new sub-command in the verb table and the §Database section.

- 84c3f07: `npm run start` now opens Windows Terminal with two side-by-side panes that run `bff:dev` (the BFF watcher with the Hono API + the Angular dev-mode placeholder) and `ui:dev` (the Angular dev server with HMR). Replaces the previous `start` which was a thin alias to `ng serve` that booted the SPA without a backing BFF.

  WSL2 + Windows Terminal only — the script aborts with a clear hint when `wt.exe` isn't on PATH. No cross-platform fallback by design; the workflow is meant for the local dev environment, not portable across collaborators.

### Patch Changes

- f706e57: Improve the `sm db browser` error message when `sqlitebrowser` is not installed: multi-line block, aligned columns, three OS variants (Debian/Ubuntu, macOS, Windows), softer framing ("if you want a GUI…" rather than imperative). The Windows hint links to the official downloads page. The shortcut at root `npm run sqlite` is moved up to sit next to `start` so the daily-use entry points are grouped at the top of the scripts block.
- 696008a: Add a `--no-ui` flag to `sm serve`. With it, the BFF stops serving the Angular bundle (stale or otherwise) and the root `/` renders an inline dev-mode placeholder pointing the user at `npm run ui:dev` + `http://localhost:4200/`. Used by the root `bff:dev` shortcut so iterating on the BFF alongside the Angular dev server doesn't surface a stale UI by accident.

  Mutually exclusive with `--ui-dist <path>` (rejected with exit 2). Combining `--no-ui` with the default `--open` emits a non-fatal stderr warning suggesting `--no-open` (the auto-opened tab would land on the placeholder rather than the live UI). `/api/*` and `/ws` remain fully functional; only the static SPA is suppressed.

  Spec impact: `spec/cli-contract.md` documents the new flag in the `sm serve` signature and the §Server flags table, including the mutual-exclusion + warning rules.

- Updated dependencies [77579b3]
- Updated dependencies [696008a]
- Updated dependencies [bd5e360]
  - @skill-map/spec@0.17.0

## 0.16.6

### Patch Changes

- 508c96a: Two coordinated landings on the landing footer plus a whitespace cleanup:

  1. **`web/app.js`** — fix the runtime CLI version fetch. The `/latest` endpoint at `https://registry.npmjs.org/@skill-map/cli/latest` is unreliable for scoped packages — the request fired but the footer tag stayed at the `cli v—` placeholder. Switched to the package metadata endpoint (`https://registry.npmjs.org/@skill-map/cli`) and read `dist-tags.latest`. Added three diagnostic `console.warn` lines so a future failure surfaces the cause (registry status, missing dist-tags, fetch exception) instead of failing silently.
  2. **`web/index.html`** — reorder the three footer version tags from `spec → web → cli` to `cli → spec → web`. The CLI is the primary product surface, spec is the contract behind it, web is metadata about the site itself.

  The `@skill-map/cli` `patch` bump covers a whitespace-only cleanup in `src/kernel/index.ts` (one redundant blank line removed between the `Kernel` interface and the `createKernel()` factory). No runtime behavior change; bumped per the workspace-touch changeset policy.

## 0.16.5

### Patch Changes

- b1a59e8: Graph view: place newly-detected nodes around the existing layout instead of on top of it.

  Follow-up to the previous "persist all node positions" change. The reconcile effect was reading the new node's coordinate out of a fresh full d3-force simulation, but that simulation didn't see the actual on-screen positions of the existing pinned nodes — they were taken from storage. Result: the new node landed wherever the fresh sim happened to put it, which often overlapped existing cards.

  New behaviour:

  - **Cold start** (no stored positions yet) — reuses the cached full simulation as before. Single batch.
  - **Incremental** (some nodes already pinned, one or more new) — runs a smaller d3-force pass with every existing entry held fixed via `fx` / `fy`, and only the missing nodes free to move. The new ones settle into a non-overlapping spot that respects the existing cards.

  The new helper lives in `graph-layout.ts` (`computeIncrementalPositions`); 200 ticks is enough because the bulk of the system is already at equilibrium.

## 0.16.4

### Patch Changes

- 383ce0b: Graph view: persist every node's position, not just the manually-dragged ones.

  Until now `localStorage` only tracked the override map (nodes the user had dragged); auto-layout positions were re-derived on every load. That meant a freshly created node (via WS scan refresh) could land in a different spot the next time the user opened the UI, even with no drags involved.

  A new reconcile effect on `GraphView` keeps `nodePositions` in lockstep with `loader.nodes()`:

  - New node detected → seed its position from the auto-layout and persist immediately.
  - Node removed (file deleted upstream) → drop its entry from storage.
  - Reset layout → clears the map; the same effect repopulates from the current auto-layout on the next tick and writes the whole batch back, giving the "delete → re-arrange → save" loop the button label has always promised.

  Single localStorage write per reconcile cycle (gated by a `dirty` check, mirrors the existing `expandedNodeIds` GC pattern). The early-return in `resetLayout()` ("if nothing's overridden, just fit") is gone — under the new model the map is never empty after the first seed, so the early return was dead code.

  Also: tutorial deep-dive duration claim trimmed from `~30-40 min` to `~20-30 min` across the SKILL and the three READMEs (root EN/ES + the package's `src/README.md`).

- 07cd144: `sm tutorial` success message now surfaces the bilingual trigger phrase as the most visible part of the output, and reminds the tester that the first message they write to Claude sets the tutorial language for the rest of the session.

  Before:

  ```
  Done. sm-tutorial.md created at /path. Open Claude Code here and tell it "run @sm-tutorial.md" to start the interactive tutorial.
  ```

  After:

  ```
  Done. sm-tutorial.md created at /path

  Open Claude Code here. Write to it in the language you want the tutorial in — the first message sets the language for the rest of the session:

      English:  run @sm-tutorial.md
      Español:  ejecutá @sm-tutorial.md
  ```

- 37bde96: `sm-tutorial` SKILL: heads-up before scaffolding the scenario.

  The skill used to start writing files (`demo-agent.md`, `findings.md`, `tutorial-state.yml`, then `.skill-map/` once `sm init` runs) without telling the tester. Now it emits one short, single-sentence FYI at the start of pre-flight Step 3, just signalling that files are about to land. The announcement is non-interactive — the agent does NOT wait for a confirmation, does NOT enumerate the files (details come later when they're relevant), it just gives the heads-up and proceeds straight to the writes.

  Also catches a few residual `reveal` mentions in fixture descriptions that the previous vocabulary unification pass missed (the rule of thumb stays "step / sub-step", never "reveal" or "stage" in tester-facing copy or fixture frontmatter).

## 0.16.3

### Patch Changes

- bf7c434: Tutorial audit pass:

  - Inviolable rule #7 dropped the contradictory "Argentine Spanish" claim and now points at the §Tone bullet (neutral Spanish, `tú` form, no rioplatense).
  - Beat B blockquote rewritten in English (was Spanish + voseo with English inline comments — violated the bilingual ban). The agent translates the whole block at runtime when the tester speaks Spanish.
  - L1 (deep-dive) no longer promises an orphan reveal that L4 doesn't deliver — L4 plants a broken-ref, which is a different rule scope.
  - "Start over" in resume mode is now safer: refuses to wipe when `tutorial-state.yml`'s saved `cwd` doesn't match `pwd`; lists the exact paths it will delete; requires a literal `yes, wipe` confirmation; never recursively deletes `.claude/` or `notes/` as directories.
  - Side-by-side intro trimmed (no longer re-explains the chat terminal already covered by the two-terminals block).
  - Demo time estimate bumped from ~7 min to ~10 min (more realistic for a non-technical tester walking through 5 sub-steps with confirmations).
  - Reveal 3's `frontmatter` gloss removed (already glossed in Reveal 1, per the once-per-session rule).
  - Port-in-use edge case clarifies bare `sm` doesn't accept flags — the tester switches to `sm serve --port 4243`.
  - Resume detection order is explicit: check raw `ls -A` for `tutorial-state.yml` first, only then apply the ignored-items filter.

  Vocabulary unification — the SKILL now uses one word ("step") with hierarchical numbering instead of three different terms:

  - Stage L1..L5 → Step 4..8 (continuous numbering, no L prefix).
  - Reveal 1..5 (Step 2 internals) → Step 2.1..2.5.
  - Beat A/B/C (Step 2.5 internals) → Step 2.5.1..2.5.3.
  - `tutorial-state.yml`: `long_stages` → `long_steps`, IDs lose the L prefix (`L4-orphans` → `7-issues`).
  - Resume copy off-by-one fixed (was "step N of 4", demo has 3 steps).

## 0.16.2

### Patch Changes

- 8b55382: Watcher fix + tutorial polish:

  - **`.skillmapignore` first-save now applies cleanly.** Before this patch, the BFF (`sm serve`) and `sm watch` rebuilt the ignore filter as soon as chokidar fired `change`, which lands on the editor's first save motion (truncate or rename). The naive sync read could see an empty/partial file, rebuild a filter without the new pattern, and the user had to save again to get the actual effect. The meta-file `onBatch` now calls a new `readIgnoreFileTextStable(cwd)` helper (in `kernel/scan/ignore.ts`) that retries reads at 50 ms intervals until two consecutive reads agree (or a 500 ms cap). The first save dispatches the rebuild against settled content.
  - **Tutorial (`sm-tutorial` SKILL.md)**: dropped Step 1 (`sm version`) from the demo since it only narrated a backstage check the tester does not need to see; renumbered 1-init / 2-ui-live / 3-handoff. Pre-flight `sm version` is now silent on success. Inserted a new Reveal 3 ("your first edit") where the tester edits the agent's frontmatter `description` and watches the card refresh — gives them muscle memory before Reveal 5's `.skillmapignore` flow. Reveal 5 ships the folder tree without `.skill-map/` children (cleaner mental map). Tone rules tightened: neutral Spanish (tú-form, NOT rioplatense), explain technical terms (`frontmatter`, `findings`, `glob`) in parentheses on first mention, translate product vocab into Spanish (`kind` → `tipo`, `connector` → `conector`, etc.) instead of leaving English loanwords, stay silent during backstage work (no `"Voy a verificar primero que..."`-style narration), config files split into backstage-setup (agent edits) vs teach-moment (tester edits) modes.

## 0.16.1

### Patch Changes

- f5db61e: Tutorial polish + UI fix:

  - `expandedNodeIds` GC: brand-new nodes no longer render with the chevron pre-expanded when their path was previously persisted in localStorage. The graph-view now filters the persisted set against the current `loader.nodes()` on every change, dropping orphan ids before they can affect a freshly created node.
  - Tutorial Reveal 3 inserted: the tester takes the keyboard for the first time before the connector reveal, edits the `description:` frontmatter of `demo-agent.md` and watches the card refresh live. Closes the "passive observer" gap in the demo and gives the tester muscle memory for the `.skillmapignore` flow that lands in Reveal 5.
  - Tutorial copy passes: dropped the bilingual `Spanish / English` pairs from the blockquotes (the `Tone` rule already says the agent translates whole-cloth; the pairs were inducing mid-paragraph spanglish), dropped the obsolete "zoom out if a node lands off-screen" hint (auto-fit on add/remove makes it irrelevant), removed the broken-ref aside from the demo (planted in Stage L4 instead so the lesson is active), config files (`.skillmapignore`, `.skill-map/settings.json`, `.gitignore`) are now off-limits to the agent's `Edit` tool — the tester always edits those, fixture content follows the tester's language while identifiers / paths / code stay English, side-by-side viewing instruction before Reveal 1 so the tester sees browser + chat together.

## 0.16.0

### Minor Changes

- c981430: Rename the project ignore file from `.skill-mapignore` to `.skillmapignore` (no dash).

  Rationale: drop the dash for consistency with `.gitignore` / `.npmignore` / `.dockerignore` and friends — those tools use a contiguous lowercase token, and adopting the same shape removes the visual stutter when listing dotfiles. The rename also avoids confusion between the public artifact and the package id `@skill-map/*` which uses a dash by convention.

  Breaking change pre-1.0:

  - `sm init` now scaffolds `.skillmapignore` instead of `.skill-mapignore`. Existing projects must `mv .skill-mapignore .skillmapignore` manually — no compat reader (greenfield rule, see `feedback_greenfield_no_versioning.md`).
  - The bundled defaults asset moved from `src/config/defaults/skill-mapignore` to `src/config/defaults/skillmapignore`.
  - `sm serve` and `sm watch` now watch `.skillmapignore` (not `.skill-mapignore`) for live filter rebuilds.
  - Spec and JSON Schema (`spec/cli-contract.md` § `sm init`, `spec/schemas/project-config.schema.json` § `ignore`) updated; `spec/index.json` regenerated.
  - All in-repo fixtures, docs (ROADMAP, context/\*, AGENTS.md, web/app.js), tests, and skills (sm-tutorial, foblex-flow indirectly) updated in the same commit.

  Historical CHANGELOG entries that reference `.skill-mapignore` are intentionally left untouched — they document past behaviour.

- 15f2b4e: `sm serve` and `sm watch` now react in-flight to edits of `.skillmapignore` and `.skill-map/settings.json`. Previously, both verbs loaded the ignore filter once at startup and required a restart for new patterns to take effect — invisible to the user except via stale results. After this change, a secondary chokidar watcher monitors both meta-files; on change, the watcher rebuilds the filter from disk, re-reads `config.ignore` / `scan.tokenize` / `scan.strict` from settings, and dispatches a fresh scan so the DB and `/ws scan.completed` reflect the new state.

  Kernel API is additively extended: `createChokidarWatcher`'s `ignoreFilter` option now accepts either an `IIgnoreFilter` (captured by reference at construction, the historical shape) or a `() => IIgnoreFilter | undefined` getter that is re-evaluated per chokidar event. The getter form is what enables the BFF / CLI watch to swap the filter at runtime without tearing chokidar down. Static callers continue to pass an `IIgnoreFilter` literal and behave exactly as before.

  Note: `scan.watch.debounceMs` itself is captured at boot — changing the debounce window in settings.json still requires restarting the watcher.

### Patch Changes

- Updated dependencies [c981430]
  - @skill-map/spec@0.16.0

## 0.15.0

### Minor Changes

- d7e8dd9: Rename the tester onboarding verb and its companion Claude Code skill from `sm-guide` to `sm-tutorial` across spec, CLI, bundled materialised payload, runtime state file, and report file. Breaking change to the public CLI surface (`sm guide` is gone — no compat shim); pre-1.0 so it ships as a minor bump per the project's pre-1.0 policy (no major while a workspace stays in `0.Y.Z`).

  Spec: `spec/cli-contract.md` — the `sm guide` verb section is renamed to `sm tutorial`. Same shape, same exit codes, same `--force` semantics — only the identifier flips. Materialised file becomes `<cwd>/sm-tutorial.md`; integrity block in `spec/index.json` regenerated.

  CLI (`@skill-map/cli`): `sm guide` → `sm tutorial`; `src/cli/commands/guide.ts` → `tutorial.ts` (`GuideCommand` → `TutorialCommand`, `SM_GUIDE_FILENAME` → `SM_TUTORIAL_FILENAME`); `src/cli/i18n/guide.texts.ts` → `tutorial.texts.ts` (`GUIDE_TEXTS` → `TUTORIAL_TEXTS`, all string templates updated to mention `sm-tutorial.md` and `@sm-tutorial.md`); `src/tsup.config.ts` build step `copyGuideSkill()` → `copyTutorialSkill()` writing the bundled payload to `dist/cli/tutorial/sm-tutorial.md` instead of `dist/cli/guide/sm-guide.md`. Test file `src/test/guide-cli.test.ts` → `tutorial-cli.test.ts` with updated regex assertions and SKILL.md byte-match anchor pointing at `.claude/skills/sm-tutorial/SKILL.md`.

  Skill: `.claude/skills/sm-guide/` → `.claude/skills/sm-tutorial/`. Frontmatter `name: sm-guide` → `sm-tutorial`. Triggers list updated (`"tutorial", "sm-tutorial", "tutorial me", "start the tutorial"`). Internal whitelist updated (`sm-tutorial.md`, `tutorial-state.yml`, `sm-tutorial-report.md`). Runtime state file renamed `guide-state.yml` → `tutorial-state.yml` (top-level YAML key `guide:` → `tutorial:`). Report file renamed `sm-guide-report.md` → `sm-tutorial-report.md`. Colloquial Spanish "guía" inside tester-facing prose stays where it reads naturally — only identifiers (path names, command names, frontmatter, technical references) flip to `tutorial`.

  ROADMAP: setup-and-state verb table updated to `sm tutorial [--force]`.

  No backwards-compat alias is shipped: the tester base for this verb is tiny and a clean break is safer than maintaining two names.

### Patch Changes

- 89a3e59: `sm-guide` tester-feedback iteration plus a handful of CLI/UI polish fixes that ride along.

  The bundled `.claude/skills/sm-guide/SKILL.md` is the bulk of the change. Behavioural fixes driven by the first round of tester feedback: every fixture file now passes the live frontmatter schemas (`metadata.version` added across the five demo files; `demo-agent.md` switched from CSV `tools: Read, Bash` to YAML array `tools: [Read, Bash]`; `notes/todo.md` switched `title:` to `name:`) so the demo no longer self-reports as broken at scan time. Stage L4 was rewritten end-to-end: it pivoted away from `sm orphans --kind broken-link` (a flag combination that doesn't exist — `--kind` accepts auto-rename confidence levels, not issue kinds) onto `sm check` / `sm check --rules broken-ref`, with a sidebar explaining the `sm check` vs `sm orphans` scope split. Stage L5 (Plugins) now demos against `core/external-url-counter` (smallest blast radius, reversible), with a paragraph clarifying that the `kind:` prefix and `@version` shown in `plugins list` must be stripped when toggling, and that bundle-granularity bundles (`claude`) only accept the bundle id. Pedagogical structure: Step 3 (Live UI) reorganised into three reveals (1 lone agent → 5 unconnected nodes → connectors light up); pre-flight only seeds the agent. Five fixture kinds now (skill / agent / command / hook / note), with `command` added as a fifth. Server-up handling at Stage L1: the agent checks first instead of blindly telling the tester to "start it again". Stages eliminated as low-value or risky: Conformance, Database operations, Destructive, Delta + history; remaining stages renumbered to L1–L5. The "destructive stages need backup" footnote is gone with them. Conventions: blockquote rule clarified (prose addressed to the tester goes in blockquotes; code blocks stay outside); the agent now mirrors the tester's language (Spanish argentino if the tester arrived in Spanish, English otherwise) instead of being Spanish-only. `.skill-mapignore` template extended with `export.*` and `dump.sql` so guide-generated artefacts don't pollute the live graph.

  `sm guide` verb strings (`cli/i18n/guide.texts.ts`) flipped from Spanish to English to match the new mirror-the-tester convention; the test suite was updated to match.

  `sm serve` initial scan-on-boot (`src/server/watcher.ts`): on boot, the watcher now fires one eager batch right after chokidar's `ready` resolves, so the UI reflects the current filesystem from the very first connection instead of serving whatever the previous run persisted. The eager-batch logic was extracted into a top-level `runInitialBatch` helper to keep `start()` under the project's complexity budget; the swallow-and-log shape mirrors `onBatch` so a transient FS error here can't kill the broadcaster.

  `sm plugins list` formatting (`cli/commands/plugins.ts` + `i18n/plugins.texts.ts`): bundle-granularity rows (e.g. `claude`) now render one extension per line at the same indent column as extension-granularity rows (e.g. `core`), instead of a single comma-separated `kinds:` blob. Visual symmetry between the two granularity modes; bundle rows still omit the per-extension `ok` because individual extensions in a bundle aren't toggle-able.

  `sm serve` startup banner (`cli/util/serve-banner.ts`): the figlet logo is now a single violet block instead of split violet-top / green-bottom; the green is reserved for the underlined URL so the visual focal point is the address the tester needs to click. Banner test updated.

  UI theme toggle (`ui/src/app/app.{html,ts}` + `i18n/theme.texts.ts`): the theme button now carries a PrimeNG tooltip naming the CURRENT theme (auto / light / dark), in addition to the existing aria-label that names the NEXT state. Sighted users get explicit feedback on what's active — important for `auto`, whose desktop/monitor icon is not self-evident.

- Updated dependencies [d7e8dd9]
  - @skill-map/spec@0.15.0

## 0.14.1

### Patch Changes

- b1f6018: `sm serve` shows a figlet-style ASCII-art startup banner; non-TTY output is unchanged.

  When stderr is a TTY, `sm serve` now emits a hardcoded figlet "Skill Map" block split into a violet upper half and a green lower half, followed by a dim version line right-aligned under the logo and the existing data block (server URL, scope, cwd-relative DB path, browser hint). The URL value is rendered green-underlined to tie back to the lower-logo palette. ANSI styling (256-color violet `\x1b[38;5;141m`, 256-color green `\x1b[38;5;42m`, dim, underline) is gated behind the standard `NO_COLOR` / `--no-color` / `FORCE_COLOR` toggles.

  When stderr is a pipe / redirect (e.g. `sm serve | tee log.txt`, CI capture), the banner is suppressed entirely and the verb falls back to the two-line legacy format (`sm serve: listening on …` plus the browser hint) byte-for-byte — existing tooling that scrapes those lines keeps working.

  Spec change in `spec/cli-contract.md` § Server documents the boot output, the TTY / non-TTY split, and the color env-var precedence.

- e02eab9: `sm guide` UX polish: clearer trigger phrase + richer bundled walkthrough.

  The verb message and docstring now tell the tester to type `ejecutá @sm-guide.md` (the natural way to load a loose `SKILL.md` in the cwd as a Claude Code skill) instead of the previous "guíame". The bundled `.claude/skills/sm-guide/SKILL.md` got eight pedagogical fixes that ship together: the empty-directory whitelist is now an internal step (the agent reports "Listo, el directorio está limpio" without enumerating ignored items); the invented "4. Event log" UI view is removed (only Grafo / Lista / Inspector exist); a "si no lo ves, hacé zoom" hint was added at the live-edit step; "arista" is replaced by "conector" throughout; the fixture is diversified into a skill (`.claude/skills/demo-skill/SKILL.md`), an agent (`.claude/agents/demo-agent.md`), a hook (`.claude/hooks/demo-hook.md`) and a note (`notes/todo.md`), each with realistic frontmatter so the graph shows the four kinds; a `.skill-map-ignore` is dropped so the scanner ignores the guide's own scratch files; the closing flow offers to write a `sm-guide-report.md` for the tester to send to Pusher (renamed from Crystian); and the live-edit step is rewritten against the new fixture.

## 0.14.0

### Minor Changes

- 17a908c: Add a new built-in `markdown-link` extractor that catches `[text](path)` markdown links and emits one `references` link per resolved file path. Closes the gap surfaced by the slash-regex fix: even after that bug stopped generating false positives, sm had no extractor that mapped relative markdown links to real edges in the graph — the dominant cross-reference shape in real knowledge bases was invisible. The new extractor:

  - resolves POSIX paths against the source node's directory (`docs/overview.md` + `./api.md` → `docs/api.md`)
  - strips `#anchor` and `?query` before resolving
  - skips image syntax `![alt](path)`, URL schemes (`http`, `mailto`, `tel`, `data`, …), fragment-only links, and absolute paths starting with `/`
  - emits `kind: 'references'` at `confidence: 'high'` (the syntax is unambiguous authorial intent, not a heuristic)
  - registers under the `core` bundle as `core/markdown-link` — opt-out via `sm plugins disable core/markdown-link`

- c486f74: Add a new `sm guide` verb that materializes the interactive tester guide as `sm-guide.md` in the current working directory. Companion to the `sm-guide` Claude Code skill: a tester drops into an empty directory, runs `sm guide` to seed the canonical SKILL.md content, then opens Claude Code there and triggers the skill ("guíame") to start the interactive walkthrough. The verb:

  - Writes top-level only (`<cwd>/sm-guide.md`, no subdirectory).
  - Does NOT require an initialized `.skill-map/` project — runs in any directory, including empty ones.
  - Refuses to clobber an existing `sm-guide.md` unless `--force` is passed (exit 2 otherwise).
  - Embeds the SKILL.md source-of-truth (`.claude/skills/sm-guide/SKILL.md` at the repo root) at build time via tsup, copying it to `dist/cli/guide/sm-guide.md` for the published tarball; the runtime resolver walks both layouts so dev iteration and the shipped binary read the same content.

### Patch Changes

- b4fceb7: Two UX improvements to the CLI error surface, addressing tester friction:

  - `sm export --format md` (and any verb with required positionals) now reports `missing required positional argument(s) <query>` with the positional name extracted from Clipanion's USAGE hint, instead of the bare "Not enough positional arguments" that left users guessing what was missing. The redundant Clipanion usage line is stripped — `sm help <verb>` is the single point of truth.

  - `sm config get scan.tokenizr` now suggests the closest valid key (`Did you mean 'scan.tokenize'?`) for typos within 3 edits. Powered by a bounded Levenshtein walk over every leaf in the merged config tree, so suggestions stay aligned with what `sm config list` would print. Cap is intentionally tight to avoid noise; far-off keys (e.g. `scan.includes` when the real path is `roots`) get the bare unknown-key error and no suggestion.

  Both diagnostics share a new `src/cli/util/edit-distance.ts` helper extracted from the existing `parse-error.ts` Levenshtein implementation.

- c99b972: Two small CLI improvements driven by tour findings:

  - `sm export` no longer requires the `<query>` positional. Calling it with just `--format md` (or any format flag, or no flags at all) exports the whole graph — equivalent to the existing `sm export "" --format md`. The empty query already meant match-all in the parser; this just stops Clipanion from rejecting the bare invocation. Examples in `sm help export` updated to lead with the no-query shape.
  - `parseJsonArray` in the SQLite scan loader now tolerates `null` and `undefined` columns, returning `[]` instead of crashing `JSON.parse("undefined")`. Triggered when reading from a stale-schema DB where a column added by a later migration is absent — the verb now degrades to "empty array for that field" rather than the cryptic SyntaxError that drowned the actionable message.

- 0ecf2af: `sm db dump` no longer requires the external `sqlite3` binary. Reimplemented on top of `node:sqlite` (already a dep via the storage adapter), so the verb works on any host that can run sm without an extra install step. The output format mirrors sqlite3's `.dump` closely enough to round-trip into a fresh DB via either `node:sqlite` or the system `sqlite3` if present (`PRAGMA foreign_keys=OFF;` + `BEGIN TRANSACTION;` + schema objects in `rootpage` order + per-table `INSERT INTO …` + `COMMIT;`).

  Fixes a tester-reported `SQLITE_CANTOPEN (14)` from the spawned sqlite3 binary in environments where the binary's read-only mode could not co-exist with the kernel's WAL setup. The `sm db shell` verb still requires the external `sqlite3` binary because it spawns an interactive REPL — that escape hatch stays unchanged.

- 34d57db: Doc-only fix to remove a misleading reading of "built-in kinds" in the Node schema and one test, plus a small batch of internal CLI refactors and tightened null checks. No external surface change.

  Spec / docs:

  - `spec/schemas/node.schema.json` — the top-level `description` previously read "built-in kinds today are skill, agent, command, hook, note", which suggested those kinds were a kernel-level concept. They are not — the kernel treats `kind` as an open string, and the five names are emitted by the **built-in Claude Provider**. Re-worded to attribute the catalog to the Claude Provider, matching the wording already used on the `kind` field, in `spec/README.md`, in `src/kernel/types.ts`, and in `src/kernel/adapters/sqlite/schema.ts`.
  - `src/test/extractor-applicable-kinds.test.ts` — three comments tightened from "built-in kind" to "built-in Claude Provider kind" for consistency.

  Internal CLI refactors (no behaviour change):

  - `src/cli/commands/config.ts` — extracted an `isPlainObject` predicate (replaces the duplicated `!!v && typeof v === 'object' && !Array.isArray(v)` check inside `enumerateConfigPaths`) and a `safeGetAtPath` helper that wraps `getAtPath` + `ForbiddenSegmentError` handling so each read verb's `run()` no longer repeats the try/catch + instanceof shape.
  - `src/cli/commands/db.ts` — pulled the SQL number serialiser into `formatSqlNumber` (NaN / ±Infinity collapse to NULL) so `formatSqlValue` reads as a flat dispatcher.
  - `src/cli/util/parse-error.ts` — moved the verb-scoped error formatting (incl. the missing-positionals special case) into a `formatVerbScopedError` helper so the top-level dispatcher in `formatParseError` stays flat. Removed the now-stale "dispatcher pattern" eslint-disable comment.
  - `src/kernel/adapters/sqlite/scan-load.ts` — tightened `parseJsonObject` / `parseJsonArray` null checks from `s == null` to `s === null || s === undefined` to remove the implicit-coercion pattern flagged by lint.

  No contract change (no field/type/required edits). `spec/index.json` regenerated.

- 17a908c: Fix the slash extractor's regex so markdown relative links `[label](./foo.md)` no longer trigger false-positive `broken-ref` issues. URLs (`https://...`), Windows drive letters (`c:/...`), and dotted paths (`domain.com/api`) were also affected — same root cause in the previous-char guard. Switched from a character-class guard to a negative lookbehind that explicitly excludes `.`, `:`, `?`, `#` in addition to the original word / `/` exclusions.
- 53d39d8: Pin `@skill-map/spec` to an exact version instead of the wildcard `"*"`. The wildcard let `npm install -g @skill-map/cli@X.Y` resolve the spec dep to whatever was newest in the registry at install time — not necessarily the version the CLI was tested against. End users could end up running an `X.Y` CLI binary against a spec it had never seen, producing the "code is one version, spec is OTA" symptom (renamed config keys rejected, documented flags missing, conformance suite drifting).

  The pin is now exact and is automatically retagged to the current spec version on every `chore: version packages` PR via a new `scripts/sync-spec-pin.js` step wired into `changeset:version`. CI runs `--check` mode in `validate:all` so a drifted pin fails the pipeline.

  Local dev is unaffected — npm prefers workspace symlinks to registry resolutions when a workspace match exists, so `npm install` in the monorepo continues to link `node_modules/@skill-map/spec` to `spec/` regardless of the exact version string.

- Updated dependencies [34d57db]
  - @skill-map/spec@0.14.1

## 0.13.0

### Minor Changes

- 34768b2: Replace Clipanion's full-catalog error dump with a concise diagnostic on argv parse errors.

  Clipanion's default `UnknownSyntaxError` / `AmbiguousSyntaxError` handler prints the USAGE block of every registered command (~50 verbs for skill-map) to **stdout** and exits with code `1`. Three problems in one: it floods the screen for what is almost always a typo, it pollutes stdout (breaking `sm <verb> | jq` pipelines when an upstream typo trips the parser), and it uses the wrong exit code (per `spec/cli-contract.md` §Exit codes, "unknown flag" is operational error → `2`, not result-issue → `1`).

  `src/cli/entry.ts` now pre-parses argv via `cli.process()` inside try/catch before delegating to `cli.run()`. On a parse error, `src/cli/util/parse-error.ts` formats a single-screen diagnostic (headline + at most one suggestion + `sm help` footer), writes it to **stderr**, and exits `ExitCode.Error` (2). Detection is duck-typed on `name` + `input` shape so a Clipanion version bump that re-exports the class can't silently flip the handler off.

  Suggestion branches:

  - Single-dash long flag (`sm -version`) → suggest the `--` form (`'--version'`).
  - Unknown flag scoped to a known verb (`sm scan --foo`) → headline as `scan: unknown option '--foo'` + `Run 'sm help scan' for usage.`
  - Incomplete namespace (`sm db`) → list up to three registered subcommands alphabetically.
  - Unknown verb (`sm sacn`) → Levenshtein-ranked top-3 within 2-3 edits (cap tightened on short inputs to avoid `fooooo` matching `db backup`).

  The exit-code change from `1` → `2` is technically observable for any caller that special-cased Clipanion's old behaviour, but it brings the binary into conformance with the documented contract. Pre-1.0 minor per `spec/versioning.md`.

  Adds `src/test/cli-parse-errors.test.ts` (9 cases) covering each branch and the happy paths (`--version`, `-v`) to guard against regressions.

- e42cb62: Ship the Angular UI bundle inside `@skill-map/cli` and resolve the correct Angular `application`-builder output path so `sm serve` actually serves the SPA in installed mode.

  Three layered bugs landed at once: (1) `src/server/paths.ts` looked for `ui/dist/browser/`, but Angular CLI v17+'s default `application` builder emits to `<project>/dist/<project-name>/browser/` — for this repo that's `ui/dist/ui/browser/`. The resolver had been pointed at the wrong directory all along; it just stayed silent because `serveStatic` falls back to an inline placeholder instead of erroring. (2) `resolveDefaultUiDist` only walked upwards from `cwd`, so when the package was installed at `node_modules/@skill-map/cli/`, walking up from a consumer project never found a UI bundle. (3) `tsup`'s `onSuccess` copied `migrations/` and `config/defaults/` but not the SPA, and the `release.yml` workflow built the CLI without ever building UI first — the published tarball shipped without any UI at all.

  The resolver in `src/server/paths.ts` is now three-branch and ordered: explicit `--ui-dist` → package-bundled `<package>/dist/ui/` (installed mode, located via `import.meta.url`) → upward walk for `ui/dist/ui/browser/` (dev / monorepo). The package-bundled branch comes BEFORE the upward walk so a developer running an installed `@skill-map/cli` from inside a fork still gets the package's own version-matched bundle instead of accidentally picking up a stale local build higher up the tree. `src/tsup.config.ts` gains a `copyUiBundle()` post-build step that copies `../ui/dist/ui/browser/` → `dist/ui/`, soft-failing with a stderr warning when the source is missing so dev iteration on TS doesn't require an Angular rebuild every time. `.github/workflows/release.yml` now builds UI before CLI so the changesets-published tarball always carries the SPA. The placeholder copy in `src/server/static.ts` is updated to distinguish installed-mode (packaging bug, please report) from monorepo-dev mode (run `npm run build --workspace=ui`).

  Adds `src/test/server-paths.test.ts` (11 cases) covering `isUiBundleDir`, `resolveExplicitUiDist`, the new `resolvePackageBundledUiFrom` testable inner (synthesizes fake package layouts in tmp without depending on the live `src/dist/ui/`), and a `resolveDefaultUiDist` integration smoke. Behaviour is observable to end users (the published tarball now contains the UI; the resolver accepts a different path layout), so this ships as a pre-1.0 minor per `spec/versioning.md`.

## 0.12.0

### Minor Changes

- 8f2a66d: Bare `sm` defaults to `sm serve` instead of printing help

  `sm` invoked with no arguments now starts the Web UI server when a
  `.skill-map/` project exists in the current working directory
  (equivalent to `sm serve`). When no project is found, it prints a
  one-line hint pointing to `sm init` and `sm --help` on stderr and
  exits with code `2`. `sm --help` and `sm -h` continue to print
  top-level help — help is now reserved for explicit flags.

  **Spec change** (`spec/cli-contract.md` §Binary): the prior wording —
  _"`sm`, `sm --help`, `sm -h` MUST all print top-level help"_ — is
  replaced by two separate clauses. Help invocation requires `--help` or
  `-h`; bare invocation routes to the server with the hint-and-exit
  fallback when no project exists.

  **CLI change** (`src/cli/entry.ts`): empty argv is intercepted before
  Clipanion sees it. If `defaultProjectDbPath(cwd)` exists, the args
  are rewritten to `['serve']`. Otherwise the hint is printed via the
  `tx()` i18n shim and the process exits `2`. `RootHelpCommand` no
  longer carries `Command.Default`; it remains the handler for `--help`
  and `-h` only.

  **Why pre-1.0 minor instead of major**: `spec/` and `src/` are both
  in `0.Y.Z`. Per `spec/versioning.md` §Pre-1.0, breaking changes ship
  as minor bumps until the deliberate 1.0 stabilization. The conformance
  suite required no updates (no case asserted bare-sm = help).

### Patch Changes

- Updated dependencies [8f2a66d]
  - @skill-map/spec@0.14.0

## 0.11.1

### Patch Changes

- 103fc1a: Doc revision pass — greenfield framing across READMEs, spec prose, ROADMAP, AGENTS, web, and workspace landing pages.

  Pure documentation changes; no normative schema or code changes.

  `@skill-map/spec`:

  - `architecture.md` — terse rewrite of §Provider · `kinds` catalog (now lists three required fields: `schema`, `defaultRefreshAction`, `ui`); new §Provider · `ui` presentation section documenting the label / color / colorDark / emoji / icon contract; §Stability section updated for the six extension kinds + Hook trigger set.
  - `plugin-author-guide.md` — Provider section gains the `ui` block documentation alongside `schema` and `defaultRefreshAction`; example manifest carries both icon variants (`pi` + `svg`); migration notes stripped under greenfield framing.
  - `cli-contract.md` — §Server documents the `kindRegistry` envelope field on every payload-bearing variant (sentinel envelopes — health/scan/graph — exempt).
  - `conformance/coverage.md` — row 18 (`extensions/provider.schema.json`) flipped 🔴 → 🟡, points at the new `plugin-missing-ui-rejected` case; new §Stability section.
  - `conformance/README.md` — drop "(Phase 5 / A.13 of spec 0.8.0)" historical phase markers.
  - `db-schema.md`, `plugin-author-guide.md` — fix `pisar` typo (Spanish leaked into English) → "are simply overwritten".
  - `CHANGELOG.md` — aggressive sweep: 2114 → 77 lines (96% reduction). Every release gets a 1–3 line greenfield summary. Drops the `Files touched`, `Migration for consumers`, `Out of scope`, `Why`, and per-step decision sub-sections. Drops commit-hash prefixes and `Pre-1.0 minor per versioning.md` boilerplate from every entry. The `[Unreleased]` section preserves the three in-flight Step 14 entries.
  - `conformance/fixtures/plugin-missing-ui/.skill-map/plugins/bad-provider/{plugin.json,provider.js}` — recovered (lost in the merge from `main` due to `.gitignore` masking gitignored-but-tracked files; `git add -f` brings them back into the index).

  `@skill-map/cli`:

  - `src/README.md` — Status section greenfield (terse: pre-1.0, what's next, what's after); usage examples expanded with `sm serve` + monorepo dev scripts.
  - `src/built-in-plugins/README.md` — drop the contradictory "empty on purpose" framing; document the actual built-in inventory (Claude Provider + Extractors + Rules + Formatter + `validate-all`).

  `@skill-map/testkit`:

  - `testkit/README.md` — rewrite end-to-end against the actual exported helper names (`runExtractorOnFixture` instead of the long-renamed `runDetectorOnFixture`); align example with the `extract(ctx) → void` Extractor shape and the `enabled` plugin status enum.

  Plus `ui/` README rewrite, root README + ES mirror Status / badge bumps + `sm serve` mention + Star History embed, AGENTS.md greenfield BFF section, CONTRIBUTING.md refresh, ROADMAP.md greenfield sweep (`Earlier prose` blocks stripped, decision log reframed without rename history, 14.6+ content preserved), web copy revision (How-it-works section), examples/hello-world rewritten to the Extractor model with passing tests, and the spec/index.json regeneration that goes with it.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

- Updated dependencies [103fc1a]
  - @skill-map/spec@0.13.1

## 0.11.0

### Minor Changes

- e0fb57e: Step 14.2 — REST read-side endpoints + DataSource contract

  Fills the `### Server` subsection's endpoint catalogue from the v14.1 stub
  (`/api/health` real, `/api/*` 404) to the eight read-side endpoints the
  Angular SPA at 14.3 will consume. New `spec/schemas/api/rest-envelope.schema.json`
  formalises the list-envelope shape. Test totals 764 → 832 (+68).

  **Files added (server)**

  - `src/server/path-codec.ts` — `encodeNodePath` / `decodeNodePath`. Base64url (RFC 4648 §5, no padding). Mirrored at `ui/src/services/data-source/path-codec.ts` in 14.3.
  - `src/server/envelope.ts` — list / single / value envelope builders. `REST_ENVELOPE_SCHEMA_VERSION = '1'`. Hardcoded to track `spec/schemas/api/rest-envelope.schema.json#/properties/schemaVersion/const`.
  - `src/server/query-adapter.ts` — `urlParamsToExportQuery(params)` lifts URL search params into the kernel's `IExportQuery` via `parseExportQuery` (one grammar, two transports). `filterNodesWithoutIssues` post-filter handles `hasIssues=false` (the one filter the kernel grammar can't express).
  - `src/server/routes/deps.ts` — shared `IRouteDeps` bag (`options`, `runtimeContext`).
  - `src/server/routes/health.ts` — extracted from `app.ts` for symmetry with the other routes (no behavior change).
  - `src/server/routes/scan.ts` — `/api/scan` + `/api/scan?fresh=1`. DB absent → returns the empty `ScanResult` shape (matches the `loadScanResult` synthetic fallback). `?fresh=1` rejects when the server was started with `--no-built-ins` or `--no-plugins`.
  - `src/server/routes/nodes.ts` — `/api/nodes/:pathB64` (single) registered BEFORE `/api/nodes` (list) so the param doesn't shadow the literal prefix. Pagination defaults `offset=0`, `limit=100`; max `limit=1000`.
  - `src/server/routes/links.ts` — `/api/links?kind=&from=&to=`.
  - `src/server/routes/issues.ts` — `/api/issues?severity=&analyzerId=&node=`. `analyzerId` filter mirrors `sm check`'s qualified-or-suffix match.
  - `src/server/routes/graph.ts` — `/api/graph?format=ascii|json|md`. Per-format content-type. Unknown format → `bad-query` 400.
  - `src/server/routes/config.ts` — `/api/config`. Wraps `loadConfig` from the kernel. Layered-loader warnings forwarded to `process.stderr`.
  - `src/server/routes/plugins.ts` — `/api/plugins`. Built-ins (gated by `noBuiltIns`) + drop-ins (gated by `noPlugins`). `source: 'built-in' | 'project' | 'global'` derived from the plugin's filesystem path against `defaultProjectPluginsDir`.

  **Files edited (server)**

  - `src/server/app.ts` — `IAppDeps` gains `runtimeContext` (mandatory). Routes registered via the new `routes/*` registrars BEFORE the `/api/*` 404 catch-all. `app.onError` extended to map `ExportQueryError` → 400 `bad-query` (alongside the existing HTTPException + uncaught-Error branches).
  - `src/server/index.ts` — `createServer(options, extra?)` accepts an optional `extra.runtimeContext` so tests can drive against a tempdir scope; production callers (the `sm serve` verb) leave it undefined and the composition root falls back to `defaultRuntimeContext()`.
  - `src/server/i18n/server.texts.ts` — adds error message templates: `dbMissingHint`, `freshScanRequiresPipeline`, `graphUnknownFormat`, `paginationLimitTooLarge`, `paginationInvalidInteger`, `nodeNotFound`, `pathB64Malformed`.

  **Tests added (68)**

  - `src/test/server-endpoints.test.ts` (24) — happy + error path per endpoint. Uses real `runScan` + `persistScanResult` against a `mkdtempSync` fixture (no `:memory:` per `feedback_sqlite_in_memory_workaround.md`).
  - `src/test/server-pagination.test.ts` (10) — default page caps at 100, `?limit=1000` accepted, `?limit=1001` rejected, offset/limit boundaries, `?offset=-1` and `?offset=foo` rejected, offset past total returns empty + preserves total.
  - `src/test/server-errors.test.ts` (8) — every `code` value maps to the documented HTTP status; canonical envelope shape on every error response.
  - `src/test/server-query-adapter.test.ts` (16) — URL-param → IExportQuery matrix; `filterNodesWithoutIssues` post-filter behaviour.
  - `src/test/server-path-codec.test.ts` (10) — round-trip on POSIX / unicode / spaces / very long paths; rejection of empty, non-alphabet, single-char inputs; uniqueness for distinct inputs.

  **Spec**

  - `spec/schemas/api/rest-envelope.schema.json` — new schema. `$id: https://skill-map.dev/spec/v0/api/rest-envelope.schema.json`. `oneOf` enforces that an envelope carries exactly one of `items` / `item` / `value` per kind (with sentinel kinds `health` / `scan` / `graph` reserved for routes that don't use the envelope).
  - `spec/cli-contract.md` `### Server` — endpoint table expanded from 4 rows (v14.1 surface) to 12 rows (v14.2 surface) with full filters / status / shape per row. Error code source enumeration added (`not-found` / `bad-query` / `internal` / reserved `db-missing`). Stability stays `experimental — locks at v0.6.0`.
  - `spec/CHANGELOG.md` `[Unreleased]` `### Minor` — entry for BFF endpoints + envelope schema.
  - `spec/conformance/coverage.md` — row 25 added for `api/rest-envelope.schema.json` (status: 🔴 missing — implementation-side coverage exists in `src/test/server-endpoints.test.ts`; a kernel-agnostic conformance case is still required before v1.0.0 ships).
  - `spec/index.json` — regenerated (40 → 41 files hashed).

  **Decisions during implementation (flag for orchestrator)**

  - The `db-missing` error code is kept in the documented enum but no v14.2 route currently emits it — `/api/scan` returns the empty `ScanResult` when the DB is absent, list routes return zero items, and `/api/health` already advertises `db: 'missing'`. Documented in the spec as "reserved for future endpoints (post-v0.6.0 mutations) where degradation is not safe". Removing the code would be a breaking change to the envelope contract; keeping it costs nothing.
  - `ExportQueryError` from `parseExportQuery` is funneled to `bad-query` 400 via a new branch in `app.onError`. The brief listed it as a route-level concern; centralising in the global handler means future routes that go through the kernel grammar (e.g. a future `/api/export?q=...`) inherit the same envelope mapping for free.
  - `urlParamsToExportQuery` builds a canonical raw query string and re-parses it through `parseExportQuery` instead of constructing `IExportQuery` directly. The extra parse is microseconds and guarantees the BFF and `sm export` can never drift on what counts as a valid filter token. When the grammar grows (e.g. `has=findings` post-Step 11), only `parseExportQuery` changes.
  - `/api/scan?fresh=1` rejection on `--no-built-ins` / `--no-plugins` matches Decision §14.1's intent: the BFF surface should not silently produce empty results that look indistinguishable from "your project has no nodes". The `bad-query` envelope tells the operator they're holding a knife by the blade.
  - Tests use `noPlugins: true` by default to keep them deterministic against `process.cwd()` — `loadPluginRuntime` walks the live cwd's plugins dir, which would surface ambient plugins from the test runner's host (none in CI today, but a developer running tests locally with their own plugins installed would see flake).
  - The route registration order in `app.ts` is documented in the file's header comment. `/api/nodes/:pathB64` MUST register before `/api/nodes` (Hono matches in declaration order; the literal prefix wins otherwise).

- d5488bf: Step 14.4.a — BFF WS broadcaster + chokidar wiring + scan event emission

  First half of Step 14.4 lands. The BFF's `/ws` endpoint flips from
  "upgrade-only stub" to a real broadcaster fed by a chokidar
  filesystem watcher: every debounced batch runs the same
  `runScanWithRenames` + persistence pipeline `sm watch` uses, and the
  kernel's `ProgressEmitterPort` is bridged directly to the broadcaster
  so `scan.*` / `extractor.completed` / `rule.completed` / `extension.error`
  events reach every connected client verbatim — no envelope
  construction in the BFF for the routine cases. Tests 832 → 854 (+22).

  The UI-side consumer (`WsEventStreamService`) ships separately as
  14.4.b.

  **Files added (server)**

  - `src/server/broadcaster.ts` — `WsBroadcaster` class. Owns the
    connected-clients Set, fans `JSON.stringify(envelope)` once across
    every open socket, evicts on backpressure (`bufferedAmount > 4 MiB`
    → close 1009 + unregister), drains every client with code 1001 +
    reason `'server shutdown'` on `shutdown()`. `IBroadcasterClient`
    interface is structural so unit tests inject fakes without a real
    `WebSocket`.
  - `src/server/watcher.ts` — `createWatcherService(deps)` factory.
    Wraps `createChokidarWatcher` with `scan.watch.debounceMs` from
    config (override via `--watcher-debounce-ms`), runs the kernel scan
    pipeline per debounced batch, persists via `withSqlite(...).scans.persist(...)`.
    The per-batch `ProgressEmitterPort` bridges every event the kernel
    orchestrator emits during the scan to `broadcaster.broadcast(envelope)`.
    Per-batch failures log + continue (transient FS errors must not
    kill the broadcaster); chokidar instance errors broadcast a
    `watcher.error` advisory.
  - `src/server/events.ts` — envelope helpers (`IWsEventEnvelope` shape,
    `buildWatcherStartedEvent`, `buildWatcherErrorEvent`). The
    `watcher.*` events are BFF-internal advisories — non-normative,
    prefixed with `watcher.` to flag their non-spec status. Spec-mandated
    shapes (`scan.*`, `extractor.completed`, `rule.completed`) are
    forwarded verbatim from the kernel emitter, so this file does not
    build them.

  **Files added (tests)**

  - `src/test/server-ws-broadcaster.test.ts` (15 tests) — broadcaster
    unit tests against fake `IBroadcasterClient` instances. Coverage:
    register/unregister/clientCount accounting, broadcast fan-out + JSON
    stringify, readyState filter (skip closing/closed), per-client
    `send()` failure isolation, backpressure eviction at the documented
    threshold (`WS_BACKPRESSURE_BYTES = 4 MiB`), shutdown idempotency
    - close-code/reason assertions, post-shutdown register immediate
      close, post-shutdown broadcast no-op, circular-envelope serialization
      failure handling.
  - `src/test/server-ws-integration.test.ts` (7 tests) — end-to-end
    against a real server. Boots `createServer({...})` with
    `noWatcher: false`, watches a `mkdtempSync` cwd via the
    `runtimeContext` override (production callers' cwd would point at the
    test runner's repo root). Exercises: initial-batch `scan.completed`
    observed by a connected client; multi-client fan-out (one batch fires
    to two open clients); `clientCount` decrement on disconnect;
    `handle.close()` shuts the watcher cleanly under 2s;
    `validateServerOptions` rejects `--no-built-ins + watcher on`;
    `--no-watcher` confirms no `scan.*` events fire.

  **Files edited (server)**

  - `src/server/ws.ts` — `noopWebSocketRoute(app)` deleted, replaced
    with `attachBroadcasterRoute(app, broadcaster)`. Pulls the underlying
    `ws` library `WebSocket` off `WSContext.raw` and registers it on
    `onOpen`; unregisters on `onClose` / `onError`. Server-push only —
    `onMessage` intentionally not registered at v14.4.a.
  - `src/server/index.ts` — `createServer` composition root grows the
    broadcaster + watcher lifecycle: instantiate `WsBroadcaster` →
    build app (broadcaster threaded into `IAppDeps`) → bind listener →
    start watcher (unless `--no-watcher`); `handle.close()` shuts in
    order: `watcherService.stop()` → `broadcaster.shutdown()` → http
    close → `wss.close()`. `ServerHandle` exposes the `broadcaster`
    field for tests asserting `clientCount`.
  - `src/server/app.ts` — `IAppDeps.attachWs: TWsRegistrar` removed;
    replaced with `IAppDeps.broadcaster: WsBroadcaster`. The BFF wires
    `attachBroadcasterRoute` directly inside `createApp` now (route
    registrar pattern was the v14.1 scaffolding to allow swap-in at
    v14.4 — that work is done, no need for the indirection).
  - `src/server/options.ts` — adds `noWatcher: boolean` (default `false`
    per Decision #121: a server with stale DB is a footgun) and
    `watcherDebounceMs?: number` (override the config value).
    Validator gains `watcher-requires-pipeline` (rejects
    `--no-built-ins + watcher on` — would persist empty scans on every
    batch) and `watcher-debounce-invalid` (non-integer / negative).
  - `src/server/i18n/server.texts.ts` — eight new keys for watcher /
    broadcaster lifecycle log lines.

  **Files edited (CLI)**

  - `src/cli/commands/serve.ts` — plumbs `--no-watcher` (documented) +
    hidden `--watcher-debounce-ms` flag through to `IServerOptionsInput`.
  - `src/cli/i18n/serve.texts.ts` — two new keys
    (`watcherRequiresPipeline`, `watcherDebounceInvalid`).

  **Files edited (tests)**

  - `src/test/server-boot.test.ts` — the no-broadcaster-yet
    close-1000-on-`onOpen` assertion is replaced with a "connection
    stays open + registers" assertion. Default options grow
    `noWatcher: true` (the watcher is exercised in the dedicated
    integration file).
  - `src/test/server-{db-missing,endpoints,errors,pagination}.test.ts`
    — default options grow `noWatcher: true` so chokidar doesn't
    subscribe to the test runner's cwd. No behavior change for these
    tests; they exercise the REST surface, not the watcher.

  **Spec**

  - `spec/cli-contract.md` `### Server` — new **WebSocket protocol**
    subsection. Documents the wire envelope (delegated to
    `job-events.md` §Common envelope), the v14.4.a event catalog
    (`scan.started` / `scan.progress` / `scan.completed` plus the
    side-effect events `extractor.completed` / `rule.completed` /
    `extension.error`, plus the BFF-internal advisories
    `watcher.started` / `watcher.error`), the connection lifecycle
    (no state push on connect; client polls `/api/scan` to seed; close
    codes 1000 / 1001 / 1009), the backpressure rule, and the
    loopback-only assumption (no per-connection auth through v0.6.0
    per Decision #119). The endpoint table flips `GET /ws` from
    `upgrade-only` to `implemented (v14.4.a)`. The `sm serve` flag
    table grows `--no-watcher`. The verb-catalog row for `sm serve`
    mirrors the new flag.
  - `spec/CHANGELOG.md` `[Unreleased]` `### Minor` entry.
  - `spec/index.json` — regenerated (41 files hashed; no schema added).

  **ROADMAP.md** — bumped `Last updated`, marked Step 14.4.a landed
  (14.4 carries an explicit (a/b) split now), 14.4.b still owes the
  UI-side consumer. Earlier 14.3 prose pushed to "Earlier prose".

  **Decisions taken inline (flag for orchestrator)**

  - `issue.added` / `issue.resolved` (per `spec/job-events.md` §Issue
    events line 446) **deferred to a follow-up**. The diff requires
    comparing the new `ScanResult.issues` set against the prior
    persisted snapshot; the watcher already loads the prior for the
    rename heuristic, so the data is at hand, but the diff plumbing
    (key derivation, set comparison, two emit calls per delta) is
    enough material that it deserves its own brief. The 14.4.a surface
    fans out exactly what the kernel emitter already produces.
  - `scan.failed` **deferred to a follow-up**. The shape is not yet
    locked in `spec/job-events.md` and would need a normative
    addition. For 14.4.a, per-batch failures log via the kernel logger
    and the watcher loop continues — same behavior as `sm watch`'s
    `WATCH_TEXTS.batchFailed`.
  - `scan.progress` **emitted, not throttled**. The kernel
    orchestrator emits one event per node walked; on a small workspace
    this is a handful of events per batch, on a large workspace it's
    hundreds. The brief flagged throttling as optional at 14.4.a; the
    bridge forwards verbatim today. The integration test observed 13
    `scan.progress` events for a 4-file fixture, which is fine. A
    throttle (250ms aggregation) is the obvious 14.6 polish if the
    bundle / perf pass shows the fan-out swamping the channel.
  - `watcher.started` / `watcher.error` BFF-internal advisories
    **emitted** rather than silent. They give the SPA event-log a
    clear "armed" signal and a surface for chokidar errors that don't
    fit the spec's `scan.*` shape. Prefix marks them as non-normative;
    consumers that follow the spec's "ignore unknown event types"
    rule will not break.
  - `IHealthResponse.watcher: 'on' | 'off'` **NOT added**. Keeping
    the v14.2 health response shape stable was preferable to adding
    one field for what tests / `--no-watcher` already cover. The
    broadcaster's `clientCount` is exposed on `ServerHandle.broadcaster`
    for test introspection without polluting the public health surface.
  - The validator rejects `--no-built-ins + watcher on` because the
    watcher would persist empty scans on every batch, silently wiping
    the DB. `--no-plugins + watcher on` is OK (the built-in pipeline
    is still complete on its own).
  - `attachBroadcasterRoute` does NOT register `onMessage`. v14.4.a
    is server-push only. A future client-initiated heartbeat / filter
    request lands at 14.4.b or later.
  - `WsBroadcaster` is a class (not a factory) per AGENTS.md
    §Adapter wiring rule 5: factories scope to "adapters consumed via
    ports", and the broadcaster is a plain BFF helper with no kernel
    port to satisfy. The class is grandfathered no-`I*`-prefix per
    §Type naming convention category 4.

  **Smoke (live BFF, one-shot per AGENTS.md)**

  The integration tests cover the live boot + WS upgrade + chokidar
  batch + broadcast end-to-end against a `mkdtempSync` scope. The
  diagnostic line `ws events received: scan.started, scan.progress
× 13, extractor.completed × 4, rule.completed × 5, scan.completed`
  confirms the full event sequence reaches a connected client during
  a real scan against a 4-file fixture.

- 4ff3f38: Step 14.5.d — Provider-driven kind presentation + envelope kindRegistry

  Pre-1.0 minor breaking per `versioning.md` § Pre-1.0.

  The Provider extension surface gains the required `kinds[*].ui` field
  so each kind a Provider declares carries the presentation metadata the
  UI needs to render it (label, base color, optional dark-theme color,
  optional emoji, optional icon). The icon is a discriminated union —
  `{ kind: 'pi'; id: 'pi-…' }` for PrimeIcons or `{ kind: 'svg'; path:
'…' }` for raw SVG path data. The UI derives `bg` / `fg` tints from
  `color` per theme via a deterministic helper, so the Provider declares
  one base color per theme rather than four hex values.

  The REST envelope shape (`spec/schemas/api/rest-envelope.schema.json`)
  gains a new required `kindRegistry` field on every payload-bearing
  variant (`nodes` / `links` / `issues` / `plugins` / `node` / `config`);
  sentinel envelopes (`health` / `scan` / `graph`) stay exempt. The
  registry is keyed by kind name and carries `{ providerId, label,
color, colorDark?, emoji?, icon? }` — the BFF assembles it once at
  boot from every enabled Provider and attaches it to every applicable
  response so the UI can render Provider-declared kinds (built-in and
  user-plugin alike) without hardcoding a closed kind enum. The change
  keeps `schemaVersion` at `'1'` (greenfield — no released consumers
  depend on the prior shape).

  **Files edited (spec)**

  - `spec/schemas/extensions/provider.schema.json` — adds `ui` to the
    required field set on each `kinds[*]` entry, with discriminated
    `oneOf` for `icon`.
  - `spec/schemas/api/rest-envelope.schema.json` — new `kindRegistry`
    definition; required on every payload-bearing variant; sentinel
    variants explicitly forbid the field via `not.anyOf`. Version stays
    at `'1'` (greenfield).
  - `spec/CHANGELOG.md` — `[Unreleased]` `### Minor` entry.

  **Files edited (kernel + built-in)**

  - `src/kernel/extensions/provider.ts` — adds `IProviderKindUi` and
    `IProviderKindIcon`; `ui` becomes required on `IProviderKind`.
  - `src/built-in-plugins/providers/claude/index.ts` — every kind
    (skill / agent / command / hook / note) declares its `ui` block
    reusing the colors / labels / icons previously hardcoded in
    `ui/src/styles.css`, `ui/src/i18n/kinds.texts.ts`, and
    `ui/src/app/components/kind-icon/kind-icon.html`.
  - `src/built-in-plugins/providers/claude/claude.test.ts` — new test
    asserts every kind declares a well-formed `ui` block.
  - `src/test/external-provider-kind.test.ts` — three mock providers
    updated to declare `ui` on their `cursorRule` kinds.
  - `src/test/plugins-cli.test.ts` — `dropMockProvider` helper template
    declares `ui` on the inline mock `note` kind.

  **Files added (conformance)**

  - `spec/conformance/fixtures/plugin-missing-ui/` — drop-in Provider
    fixture whose `kinds[*]` omits `ui` (plus a trivial `notes/example.md`
    for the built-in Claude scan to grab).
  - `spec/conformance/cases/plugin-missing-ui-rejected.json` — locks the
    loader contract: `sm scan --json` exits 0, stderr matches
    `plugin bad-provider:.*invalid.*must have required property 'ui'`,
    the envelope still contains the built-in Claude provider, and the
    one fixture node still gets scanned (one bad plugin does not take
    down the scan).

  **Decisions taken inline (flag for orchestrator)**

  - `ui` is required, not optional — making it optional reintroduces the
    pre-14.5.d trap of silently collapsing unknown kinds to `'note'`.
    The cost (one object per kind in the manifest) is small.
  - Icon is a discriminated union (`oneOf` with `kind` discriminator)
    rather than two optional fields. Keeps the UI dispatch exhaustive
    and AJV validates each variant cleanly.
  - `schemaVersion` stays at `'1'` despite the required-field add.
    Greenfield — no released consumers; a versioned migration buys
    nothing today. Bumps the day a third-party consumer ships against
    the wire.
  - Severity (PrimeNG `<p-tag>` `severity` enum) is NOT declared by the
    Provider. The UI tints kind tags with the registry's `color`
    directly, avoiding a Provider-side dependency on a UI-framework
    enum.
  - BFF + UI sub-steps land in follow-up commits (14.5.d.iii / .iv /
    .v) — the spec + kernel + built-in surface ship first so the
    contract is visible before consumers wire up.

- de20bc2: Step 14.5 (a + b) — Inspector polish: markdown body opt-in + linked-nodes panel + dead-link verify hybrid

  Two sub-steps land together as a single feature unit. The Inspector
  view (UI workspace) gains a real markdown body card, a dedicated
  linked-nodes panel fed by the BFF's `/api/links` endpoint, and a
  hybrid dead-link checker that combines the in-memory heuristic with
  on-demand BFF verification. The spec + server side ships the minimal
  contract the new UI surface depends on: an opt-in `?include=body`
  parameter on `GET /api/nodes/:pathB64`, plus a corrected single-node
  response shape. Tests 854 → 868 (+14 server) and UI 113 → 138 (+25
  inspector / linked-nodes specs).

  **Why on-demand body reads instead of persisting bodies in the DB**:
  the kernel persists `body_hash` only (per `db-schema.md` §scan_nodes)
  — the body itself is human content, not machine state, and
  duplicating it in SQLite would inflate the DB without serving any
  read-side query the kernel cares about. Inspector cards that DO want
  to render the body (markdown preview at Step 14.5) opt into the
  filesystem re-read; the list / graph / kind-palette views never need
  it.

  **Files added (server)**

  - `src/server/node-body.ts` — on-demand body reader. Exports
    `readNodeBody(cwd, relPath)` (returns `string | null`; `null` on
    ENOENT / EACCES / EISDIR / ENOTDIR) and `stripFrontmatter(body)`
    (drops the leading `---\n…\n---\n` block when present, leaves
    fences in mid-document untouched). Path-traversal hardened: refuses
    absolute paths and any relative path that resolves outside `cwd`.
  - `src/test/server-node-body.test.ts` (11 unit cases) — covers
    `stripFrontmatter` edge cases (empty, no frontmatter, missing
    closing fence, fence in mid-document) and `readNodeBody` traversal
    rejection + the four `null`-returning errno branches.

  **Files edited (server)**

  - `src/server/routes/nodes.ts` — `GET /api/nodes/:pathB64` extends
    with `?include=body` opt-in (CSV-tolerant via the new
    `parseIncludes` helper, so `?include=body,future-extension` reads
    cleanly the day a second include lands). Same handler also FIXES a
    long-standing shape bug: was emitting `{ item: { node, linksOut,
linksIn, issues } }` (raw `INodeBundle` pass-through), now emits
    the documented `{ item: Node, links: { incoming, outgoing },
issues }` that the UI's `INodeDetailApi` and `StaticDataSource`
    already expected. No prod consumer ran against the legacy shape
    (the UI was internally branching on the legacy shape before the
    REST adapter landed at 14.3.a), so the corrected shape ships as a
    minor.
  - `src/test/server-endpoints.test.ts` — assertions corrected to the
    documented shape; 2 new cases for `?include=body` (returns body
    on present file, returns `null` when the file is missing).

  **Files added (UI)**

  - `ui/src/app/components/linked-nodes-panel/{ts,html,css,spec.ts}`
    — standalone Angular component. Inputs: `path`. Outputs:
    `openPath`. Internally fires `dataSource.listLinks({from})` +
    `listLinks({to})` in parallel; state machine
    `idle/loading/ready/error`. Subscribes to `events()` filtered on
    `scan.completed` for reactive refresh, plus a manual refresh
    button in the card header. Token guard handles rapid path
    changes. Renders rows with kind tag + clickable path +
    confidence chip + sources. 10 spec cases.
  - `ui/src/i18n/linked-nodes-panel.texts.ts` — i18n catalog.
  - `ui/src/app/views/inspector-view/inspector-view.spec.ts` (15
    cases) — first inspector-view spec. Covers empty / loading /
    body-card states, stale-fetch token guard, kind-card smoke,
    dead-link verify icon flow (heuristic-dead renders icon,
    click → 404 confirms, click → 200 flips to live).

  **Files edited (UI)**

  - `ui/src/models/api.ts` — `INodeApi.body?: string | null` added.
  - `ui/src/services/data-source/data-source.port.ts` —
    `IDataSourcePort.getNode(path, opts?: {includeBody?: boolean})`.
  - `ui/src/services/data-source/rest-data-source.ts` — propagates
    `includeBody` to `?include=body`.
  - `ui/src/services/data-source/static-data-source.ts` — ignores
    the flag (demo bundle ships bodies inline; see
    `scripts/build-demo-dataset.js` below).
  - `ui/src/services/collection-loader.ts` — minor signature touch
    for the `getNode` opts pass-through.
  - `ui/src/models/node.ts` — `INodeView` loses three fields:
    `body`, `raw`, `mockSummary`. The "Summary" mock card is
    retired (description already lives in `inspector__desc`).
  - `ui/src/app/views/inspector-view/inspector-view.ts` — body card
    switches from `<pre>{{ n.body }}</pre>` to a `@switch` over a
    `bodyState` signal (idle / loading / empty / unavailable /
    error / ready) with token-guarded fetch via `effect()` keyed on
    `path()`; markdown rendered via `MarkdownRenderer` and
    `[innerHTML]`. Mounts `<sm-linked-nodes-panel>` as a separate
    card between Relations and Body. Dead-link verify hybrid: the
    Relations card chips (`supersededBy` / `supersedes` / `requires`
    / `related`) keep the in-memory heuristic but now carry a verify
    icon (`pi-question-circle`) that fires `getNode(path)` against
    the BFF; three visual states `live` / `dead-confirmed` (404 → red
    dashed border + `pi-times-circle`) / `dead-heuristic` (not in
    scope, not yet verified). Per-node signals
    `verifiedAlive` / `verifiedDead` / `verifyInFlight` reset on
    `path()` change. Template refactor consolidates 4 inline
    duplicated chip blocks into a single `<ng-template #pathChip>`
    shared via `*ngTemplateOutlet`.
  - `ui/src/app/views/inspector-view/inspector-view.{html,css}` —
    templates + styles for the new body / verify states.
  - `ui/src/i18n/inspector-view.texts.ts` — drops `summary*`, adds
    `body.*` (loading / empty / unavailable / renderError),
    `relations.verifyHint`, `relations.deadConfirmed`. `body: 'Body'`
    (was `'Body (raw markdown)'`).

  **Files edited (build pipeline)**

  - `scripts/build-demo-dataset.js` — new `embedBodies(scan,
fixtureDir)` post-processor reads each fixture's body from disk,
    strips frontmatter, attaches to the demo `data.json` so the
    demo experience matches the live BFF (~40 KB extra for 21
    fixtures; bodies-on-bundle is the explicit demo-mode tradeoff).

  **Spec**

  - `spec/cli-contract.md` `### Server` — `/api/nodes/:pathB64` row
    flips its shape column from the legacy bundle to the documented
    `{ item, links: { incoming, outgoing }, issues }` and gains the
    `?include=body` filter column.
  - `spec/CHANGELOG.md` `[Unreleased]` `### Minor` — entry covering
    the `?include=body` opt-in, the corrected response shape, and
    the path-traversal defense.
  - `spec/index.json` — regenerated (41 files hashed; no schema
    added).

  **ROADMAP** — `Last updated` bumped, "YOU ARE HERE" updated,
  completeness marker now lists 14.5.a + 14.5.b as complete; "Next"
  points at 14.5.c.

  **Decisions taken inline (flag for orchestrator)**

  - The corrected single-node shape ships as a minor (additive on
    the contract surface) rather than a major. Rationale: no public
    consumer ran against the legacy shape; the UI was decoding the
    legacy shape internally before the REST adapter at 14.3.a
    introduced the documented shape; and the spec table already
    documented the new shape (the bug was in the implementation,
    not the spec). Keeping the bump minor avoids burning a major
    on a never-shipped wire format.
  - `parseIncludes` is CSV-tolerant from day one (`?include=body`
    and `?include=body,foo` both parse) so the second include can
    land without a parser refactor. Unknown include values are
    silently ignored — the BFF surface mirrors the spec's
    "ignore unknown event types" rule for forward compatibility.
  - Bodies are fetched per-node on inspector open, not pre-fetched
    in the list endpoint. Keeps the list `/api/nodes` response
    small (the list view never renders bodies) and matches the
    read-side hot path: most nodes are listed but few are inspected.
  - The dead-link verify is opt-in per chip click, not auto-fired
    on inspector open. Heuristic-dead nodes are common in scoped
    scans (a workspace that scans `docs/` but references `src/`);
    auto-firing would burn one BFF round-trip per such reference.
  - Per-node verification signals reset on `path()` change to avoid
    stale state bleeding between inspector navigations. The signals
    are scoped to the component instance; no global cache (the
    cost is one BFF call per re-verify on revisit, which the user
    triggers intentionally by clicking the icon).

### Patch Changes

- Updated dependencies [e0fb57e]
- Updated dependencies [d5488bf]
- Updated dependencies [4ff3f38]
- Updated dependencies [de20bc2]
  - @skill-map/spec@0.13.0

## 0.10.0

### Minor Changes

- 9b55981: cli-architect review follow-up — `SmCommand` base class wires every spec § Global flag (`-q/--quiet`, `-v/--verbose`, `--no-color`, env vars), every read-side verb now emits `done in <…>` per spec § Elapsed time, watch grows a circuit breaker, scan extracts the runner, and two invariant tests gate future regressions.

  **HIGH — spec § Global flags / Elapsed time gaps**

  Audit found the CLI honoured only a subset of the spec's global flags and emitted `done in <…>` from a handful of verbs ad-hoc. Closed structurally:

  - New `cli/util/sm-command.ts` — abstract `SmCommand extends Command`. Declares `-g/--global`, `--json`, `-q/--quiet`, `--no-color`, `-v/--verbose`, `--db` once. Subclasses implement `protected run()` instead of `execute()`; the base wraps it with `applyEnvOverrides()` (promotes `SKILL_MAP_SCOPE=global`, `SKILL_MAP_JSON=1`, `NO_COLOR`, `SKILL_MAP_DB=<path>` to flags when the CLI flag is at default — spec precedence: CLI > env > config) + `startElapsed()` + a `finally` that emits `done in <…>` (suppressed by `--quiet`). Verbs opt out via `protected emitElapsed = false` (today: `sm version`, `sm watch`, `sm db shell`, `sm config list/get/show`).
  - `-v` / `-vv` / `-vvv` reconfigures the kernel logger to `info` / `debug` / `trace` respectively; `--log-level` from `entry.ts` stays as the legacy escape hatch.
  - 24 verb classes migrated: `init`, `scan`, `check`, `list`, `show`, `export`, `refresh`, `history`, `history stats`, `db backup/restore/reset/shell/dump/migrate`, `plugins list/show/doctor/enable/disable`, `orphans/orphans reconcile/orphans undo-rename`, `graph`, `scan-compare`, `version`, `conformance run`, `config list/get/show/set/reset`, `jobs prune`, `watch`. Each drops its locally-declared globals (`global`, `db`, `json`, `quiet`) and renames `execute()` → `run()`.

  **MEDIUM — watch circuit breaker**

  `runWatchLoop` previously caught every per-batch error, logged one line, and continued forever. A permanent failure (write-protected DB, schema corruption discovered post-init) repeated indefinitely with no exit signal. New `--max-consecutive-failures=N` flag (default 5; 0 disables) shuts the watcher down with exit 2 after N back-to-back failures. A successful batch resets the counter so transient errors never trip the breaker. Also removes the inner try/catch in `runOnePass` that was duplicating the per-batch error path — failures now propagate to `onBatch` so the breaker can count them.

  **MEDIUM — `cli/util/scan-runner.ts` extraction**

  `ScanCommand.execute` was 340 LOC inside one allowed `eslint-disable complexity`. The wiring chain (plugin runtime, config + ignore filter, prior-snapshot load, single-`withSqlite` open for persist, dry-run / non-persist branch) moved to `runScanForCommand(opts: IScanRunOpts): IScanRunResult` — a kernel-thin runner the verb consumes via `parse flags → runScanForCommand → render → exit code`. Mirrors `runWatchLoop`'s shape for `sm watch`.

  **MEDIUM — quick wins**

  - `cli/util/fs.ts` — lifts the `pathExists` / `statOrNull` helpers that were duplicated in `cli/commands/db.ts` and `cli/commands/init.ts`. ENOENT remains the only swallowed errno; every other code propagates so the caller sees the real reason.
  - `cli/util/db-path.ts` — adds `defaultDbPath(scopeRoot)`, `defaultSettingsPath`, `defaultLocalSettingsPath`, `defaultIgnoreFilePath`, and a frozen `GITIGNORE_ENTRIES` constant. `cli/commands/init.ts` consumes them; the spirit of "no hardcoded `.skill-map/...` literals" now applies to settings / ignore paths the same way it already applied to the DB path.
  - `kernel/util/ajv-interop.ts` — single `applyAjvFormats(ajv)` helper. The `ajv-formats as unknown as ...` ESM/CJS workaround that used to live in both `plugin-loader.ts` and `schema-validators.ts` is now in one place.
  - `cli/commands/plugins.ts` — every `tx(PLUGINS_TEXTS.*, { ... })` interpolation that splices a user-supplied `id` / `bundleId` / `extId` (CLI flag input, untrusted) wraps the value in `sanitizeForTerminal()`. Closes the audit's note that `plugins.ts:304` and the surrounding `resolveToggleTarget` call sites were the one remaining gap in CLI output sanitization.
  - `cli/commands/db.ts` — `db migrate` declares `-n,--dry-run` (was `--dry-run` only); aligns with `db reset` and the rest of the verb family.
  - `cli/commands/show.ts` — drops the speculative `findings: never[]` / `summary: null` reserved slots. The spec § `sm show --json` shape is `{ node, linksOut, linksIn, issues }` until Step 10 (findings) and Step 11 (summary) ship; the placeholders narrow consumer types in a way the eventual `unknown[]` / `unknown | null` widen could not be additive over. Test updated to assert the fields are absent.

  **Invariant tests (catch future regressions)**

  - `test/elapsed-invariant.test.ts` (10 tests) — for every read-side verb in spec § Elapsed time scope (`check`, `list`, `show`, `export`, `history`, `history stats`, `db migrate --status`, `plugins list`, `plugins doctor`), captures stderr and asserts `/^done in (\d+ms|\d+\.\d+s|\d+m \d+s)\n?$/m`. Plus one negative test that `--quiet` suppresses the line.
  - `test/render-sanitize-invariant.test.ts` (5 tests) — plants `\x1b[2J` (ANSI clear-screen) and `\x07` (BEL) inside `Node.title` and `Issue.message`, persists them, then runs `check`, `show`, `list`, `export --format md/json` and asserts no C0 / C1 control byte (other than `\n` / `\t`) reaches stdout. Catches any future render path that forgets to wrap a plugin / DB / FS string in `sanitizeForTerminal`.

  **Out of scope (deferred)**

  - `sm export --format mermaid` exit code — currently `2` (operational error). Audit suggested a dedicated "deferred / unsupported" code; that requires a `spec/cli-contract.md` § Exit codes amendment (codes 6–15 are reserved per spec). Not landing in this PR.

  **Audit follow-up tail (low-priority items held back from the main commit — `patch`-level)**

  Tests + comments only; no behavioural or surface change. Folded into this changeset because it ships in the same release window and the reader benefits from one continuous narrative.

  - `cli/commands/scan.ts` + `cli/util/scan-runner.ts` — 6-line comments document the `sm scan --global` gap. Spec § Global flags lists `-g/--global` as universal but the per-verb § Scan table omits it, and "scan global" semantics (which dirs? which ignore filter?) are undefined. `ScanCommand` accepts `-g` (inherited from `SmCommand`) but the runner hardcodes `scope: 'project'`. Comments mark both sites so the wiring lands in one motion once spec defines the contract.
  - `test/conformance.test.ts` — 2 new integration tests (audit finding 6.4) plant a hostile case JSON with `fixture: '../../../../../../etc/passwd'` and another with `fixture: '/etc/passwd'`, invoke `runConformanceCase(...)` directly, and assert the runner refuses both before any I/O against the planted path. Reinforces the unit-level guard at `conformance/index.ts:assertContained` end-to-end.
  - `test/dry-run-invariant.test.ts` (new file, 7 tests — refactor 8.3) — cross-cutting gate for spec § Dry-run's "no observable side effects" contract. Snapshots the scope dir's file content via `sha256` (excluding SQLite WAL/SHM sidecars — those rewrite even on read-only opens) before / after a `--dry-run` invocation and asserts byte-equality. Covers `db reset`, `db reset --hard`, `db restore <source>`, `db migrate`, `sm scan` (over a fresh cwd with no `.skill-map/`), and `sm init`. Plus a negative control test that runs `db reset --hard` for real and asserts the file set DOES change — proves the snapshot machinery has teeth.

  **Tests**

  749/749 pass (+24 vs prior 725; +9 vs the main follow-up commit's 740). Lint clean, build clean. No spec change; `spec/index.json` not regenerated.

- 68c5e28: Step 14.1 — `sm serve` + Hono BFF skeleton

  Adds `src/server/` Hono workspace with single-port wiring (`/api/health` real,
  `/api/*` 404 stubs, `/ws` no-op upgrade, `serveStatic` + SPA fallback). Real
  `ServeCommand` extracted from stub at `cli/commands/stubs.ts` to dedicated
  `cli/commands/serve.ts` extending `SmCommand`. Loopback-only through v0.6.0
  (Decision #119). Boot resilient to missing DB — `/api/health` reports
  `db: 'missing'`. Spec `cli-contract.md` `sm serve` row updated to full flag
  set; new `### Server` subsection (skeleton — endpoints fill at 14.2).

  **Files added (server)**

  - `src/server/index.ts` — `createServer(opts)` factory returning `ServerHandle` (`{ address, close }`); resolves spec version, builds the Hono app, instantiates a `WebSocketServer({ noServer: true })`, hands both to `@hono/node-server`'s `serve({ websocket: { server: wss } })`. Closing the http server tears down the WSS automatically (node-server registers the `'close'` hook internally); `close()` calls `wss.close()` defensively for forward-compatibility.
  - `src/server/app.ts` — Hono app construction. Routes registered in single-port order: `GET /api/health` → real, `ALL /api/*` → structured 404, `GET /ws` via the injected `attachWs` registrar, static handler + SPA fallback. Global `app.onError` formats every uncaught throw into the error envelope.
  - `src/server/options.ts` — `IServerOptions` + `validateServerOptions(input)`. Loopback-only check for `--dev-cors`; port range check `[0, 65535]`; scope validation.
  - `src/server/paths.ts` — `resolveDefaultUiDist(ctx)` walks upwards from cwd looking for `ui/dist/browser/index.html`; `resolveExplicitUiDist(ctx, raw)` honours absolute paths for `--ui-dist`.
  - `src/server/static.ts` — wraps `@hono/node-server`'s `serveStatic` middleware with the SPA-fallback layer (`serveStatic` does not do SPA fallback — it `next()`s on miss, which is exactly the seam we hook into). Absolute `root` paths work on POSIX in node-server@2.0.1 (verified runtime probe — implementation is `path.join(root, filename)`); the `.d.ts` "Absolute paths are not supported" string is stale (upstream issue honojs/node-server#187 still open). When the bundle is missing (`uiDist === null`), a tiny placeholder middleware serves the boot-without-bundle hint at `/`.
  - `src/server/ws.ts` — `noopWebSocketRoute(app)` registers `GET /ws` via the official `upgradeWebSocket` re-exported from `@hono/node-server@2.x`. The 14.1 handler closes the connection in `onOpen` with code 1000 + reason `'no broadcaster yet'`. 14.4 swaps this registrar for the chokidar-fed broadcaster — one-line change in `index.ts`, `app.ts` untouched.
  - `src/server/health.ts` — `buildHealth(deps)` synchronous; `resolveSpecVersion()` async, called once at boot.
  - `src/server/i18n/server.texts.ts` — `SERVER_TEXTS` catalog.

  **Files added (CLI)**

  - `src/cli/commands/serve.ts` — `ServeCommand extends SmCommand`. Parses flags, validates, calls `createServer`, registers SIGINT/SIGTERM handlers, awaits shutdown. `protected emitElapsed = false` (long-running daemon).
  - `src/cli/i18n/serve.texts.ts` — `SERVE_TEXTS` catalog.

  **Tests added (15)**

  - `src/test/server-boot.test.ts` (7) — boot/listen/health JSON, custom port, db state present/missing, structured 404, /ws upgrade closes with code 1000 + reason 'no broadcaster yet' (uses real `WebSocket` client from `ws`), shutdown < 1s + idempotent close, inline placeholder when uiDist null.
  - `src/test/server-flags.test.ts` (6) — host non-loopback + dev-cors rejection, port out-of-range, port non-numeric, scope invalid, ui-dist missing, ui-dist with valid bundle.
  - `src/test/server-db-missing.test.ts` (2) — `--db <missing>` exits 5, default boots cleanly with db:missing.

  **Files edited**

  - `src/cli/commands/stubs.ts` — `ServeCommand` removed; replaced with a comment pointer.
  - `src/cli/entry.ts` — registers the new `ServeCommand`.
  - `src/package.json` — adds `hono@4.12.16`, `@hono/node-server@2.0.1`, `ws@8.20.0` (deps); `@types/ws@8.18.1` (dev). All exact-pinned per AGENTS.md.
  - `spec/cli-contract.md` — `sm serve` row replaced with the full 14.1 flag set; new `#### Server` subsection (stability: experimental).
  - `spec/CHANGELOG.md` — `[Unreleased]` `### Minor` entry for the spec change.
  - `spec/index.json` — regenerated (40 files hashed; previous head was 215 lines).

  **Decisions during implementation (flag for orchestrator)**

  - WebSocket support uses `@hono/node-server@2.x`'s built-in `upgradeWebSocket` plus the canonical `ws@8.20.0` Node WebSocket library, per the official README pattern. The previously-published `@hono/node-ws` adapter was deprecated when node-server@2.0 absorbed WebSocket support natively (PR honojs/node-server#328). The 14.4 broadcaster will replace `noopWebSocketRoute` with its own one-line registrar — no API churn between 14.1 and 14.4.
  - The `/api/*` catch-all is wired with `app.all('/api/*', ...)` BEFORE the `/ws` registrar and the static handler so neither a `serveStatic` filesystem hit nor the SPA fallback can shadow API endpoints. `/ws` is registered BEFORE the static handler so a literal `/ws` path on disk inside `uiDist` cannot accidentally shadow the upgrade route.
  - `serveStatic` from `@hono/node-server/serve-static` accepts absolute root paths at runtime on POSIX (its implementation is `path.join(root, filename)`); the `.d.ts` string saying otherwise is documentation drift, not a runtime contract. Verified with a runtime probe and cross-referenced against the open upstream issue (honojs/node-server#187). Documented in `src/server/static.ts` so future contributors don't re-investigate.

### Patch Changes

- Updated dependencies [68c5e28]
  - @skill-map/spec@0.12.0

## 0.9.0

### Minor Changes

- 67fb4ae: refactor: cli-architect audit sweep — boundary hygiene, i18n discipline, enum hardening, IAction stub

  Closes the findings from the `minions:cli-architect` review of `src/`. No spec changes, no behaviour change in command output bytes (every promoted renderer was rerun against its existing tests). One internal port-shape change (`StoragePort.jobs.listOrphanFiles → listReferencedFilePaths`) — `@skill-map/cli` is still `private: true`, but pre-1.0 minor anyway because the change is structural and the new `IAction` contract is part of the public extension surface.

  **Boundary hygiene (C1, C2, H1)**

  - Lifted every storage-port type from the SQLite adapter modules into `kernel/types/storage.ts`: `IPruneResult`, `IListExecutionsFilter`, `IHistoryStatsRange`, `THistoryStatsPeriod`, `IMigrateNodeFksReport`, `IPluginConfigRow`, `IApplyOptions/Result`, `IMigrationFile/Plan/Record`, `IPluginApplyOptions/Result`, `IPluginMigrationFile/Plan/Record`. The port and the SQLite adapter modules now both import from one source; a second adapter (Postgres, in-memory test harness) inherits no SQLite-specific types.
  - `StoragePort` re-exports the lifted types so the CLI consumes the abstract contract end-to-end. `cli/commands/orphans.ts` and `cli/commands/history.ts` no longer reach into `kernel/adapters/sqlite/*` for type imports.
  - `kernel/adapters/sqlite/jobs.ts` no longer touches the FS — the docstring was already promising "we do NOT touch the FS from the storage layer", but `listOrphanJobFiles` was importing `node:fs`. New helper `kernel/jobs/orphan-files.ts:findOrphanJobFiles(jobsDir, referenced)` performs the directory walk; the storage helper renames to `selectReferencedJobFilePaths(db)` and the port surface flips from `jobs.listOrphanFiles(jobsDir): IOrphanFilesResult` to `jobs.listReferencedFilePaths(): Promise<Set<string>>`. `sm job prune --orphan-files` orchestrates the two pieces in the CLI command.

  **IAction extension contract + exhaustive switches (C3, H4)**

  - New `kernel/extensions/action.ts:IAction` + `IActionPrecondition`, mirroring `spec/schemas/extensions/action.schema.json`. Manifest-only — runtime invocation (deterministic in-process call vs probabilistic runner dispatch) lands with the job subsystem (Decision #114); the contract carries the manifest fields so the AJV validator and `sm actions show` already have a typed shape to anchor against.
  - `IBuiltIns` gains an `actions: IAction[]` bucket. `bucketBuiltIn` (`built-in-plugins/built-ins.ts`) and `bucketLoaded` (`cli/util/plugin-runtime.ts`) both grow exhaustive `default: never` arms — silent fall-through on a future kind addition turns into a compile error. `accumulateBuiltInScanExtensions` similarly explicit.
  - `extensions/index.ts` docstring no longer claims "six kinds" while shipping five.

  **Runtime enum hardening at the row→domain boundary (H5)**

  - New `kernel/util/enum-parsers.ts` with type guards (`isStability`, `isLinkKind`, `isConfidence`, `isSeverity`, …) and parsers (`parseStability(s, ctx)`, `parseLinkKind(s, ctx)`, …). Parsers throw with a clear diagnostic naming the offending value, the allowed set, and the caller's row context.
  - `kernel/adapters/sqlite/scan-load.ts:rowToNode/rowToLink/rowToIssue` now use the parsers instead of raw `as Stability/LinkKind/Confidence/Severity` casts. `Node.kind` stays open string per spec — the parsers cover only the closed-enum fields.

  **i18n discipline sweep (H2, H3)**

  CLI catalog additions (`cli/i18n/*.texts.ts`):

  - `CHECK_TEXTS.issueRow` — `[severity] analyzerId: message — nodeIds`.
  - `SHOW_TEXTS.groupedLinkHead/Dup/Sources` — split the in/out link bullet so the `(×N)` and ` sources: …` segments stay greppable.
  - `ORPHANS_TEXTS.activeIssuesHeader/activeIssueRow/noNodePlaceholder` — `renderOrphans` no longer composes English inline.
  - `EXPORT_TEXTS.md*` — every line of `renderMarkdown` (title, query echo, counts, per-kind sections, link bullets, issue bullets) routes through `tx`.
  - `HISTORY_TEXTS.statusWithReason` — `<status> (<failureReason>)` cell composition.

  Kernel catalog (`kernel/i18n/storage.texts.ts`, new):

  - `STORAGE_TEXTS.scanPersistInvalidScannedAt` — `kernel/adapters/sqlite/scan-persistence.ts`.
  - `STORAGE_TEXTS.findNodesInvalidSortBy/Limit` — `kernel/adapters/sqlite/storage-adapter.ts`.
  - `QUERY_TEXTS.exportQuery*` — `kernel/scan/query.ts` (every `ExportQueryError` thrown by `parseExportQuery`).

  **Cleanup (H6, H7, M2, M3, L4, L5)**

  - Dropped dead `FRONTMATTER_BY_KIND` map + `void` suppress in `built-in-plugins/rules/validate-all/index.ts` (unused per-kind frontmatter routing scaffolding).
  - Dropped unused `NodeKind` import in `kernel/extensions/provider.ts` (referenced only in JSDoc text).
  - Deduplicated `HOOK_TRIGGERS`: `kernel/adapters/plugin-loader.ts` now imports the single source of truth from `kernel/extensions/hook.ts` instead of redeclaring the eight-trigger list.
  - Collapsed `TExtensionKind` and `ExtensionKind` to the canonical declaration in `kernel/registry.ts`. `kernel/adapters/schema-validators.ts` and `kernel/types/plugin.ts` re-import from there.
  - Pruned `kernel/adapters/sqlite/index.ts` re-exports from ~22 schema-internal types to just `IDatabase` (the single type `src/test/storage.test.ts` consumes); CLI consumers go through the port.
  - `cli/commands/scan.ts` consolidates `process.cwd()` calls behind a single `defaultRuntimeContext()` invocation per execution.

- 2ef6b15: refactor: cli-architect follow-up — finish kernel i18n migration, dedupe DB-path helpers, normalize conformance type names, switch `sm db` / `sm init` to async fs

  Bundles a series of cli-architect audit findings (H1, H2, M1–M7, L1, L3). The `minor` bump is required by **M1** — the public type names exported from `src/conformance/index.ts` get an `I*` prefix to align with the kernel's category-4 naming convention; per AGENTS.md pre-1.0 rule, breaking changes ship as a minor while the workspace stays in `0.Y.Z`.

  **H1 — kernel i18n leak in config loader + migrations**

  Two new catalogs land under `src/kernel/i18n/`:

  - `config-loader.texts.ts` — every warning the layered config loader pushes into `ILoadedConfig.warnings` (or throws under `--strict`) now flows through `tx(CONFIG_LOADER_TEXTS.<key>, vars)`.
  - `migrations.texts.ts` — every `Error.message` thrown by `kernel/adapters/sqlite/migrations.ts` (duplicate version, invalid version range, per-file apply failure) goes through `tx(MIGRATIONS_TEXTS.<key>, vars)`.

  These messages surface to the user via `cli/commands/config.ts` (warnings dumped to stderr) and `cli/commands/db.ts` (migration failures rendered with the `{{reason}}` template). They were the last hardcoded-English strings in the kernel surface.

  **H2 — hardcoded `.skill-map/skill-map.db` (and friends) duplicated across six call sites**

  `cli/util/db-path.ts` now exports a single `DEFAULT_DB_REL = '.skill-map/skill-map.db'` plus four typed companion helpers:

  - `defaultProjectDbPath(ctx)` → `<cwd>/.skill-map/skill-map.db`
  - `defaultProjectJobsDir(ctx)` → `<cwd>/.skill-map/jobs`
  - `defaultProjectPluginsDir(ctx)` → `<cwd>/.skill-map/plugins`
  - `defaultUserPluginsDir(ctx)` → `<homedir>/.skill-map/plugins`

  Migrated call sites: `cli/commands/scan.ts`, `cli/commands/refresh.ts`, `cli/commands/watch.ts`, `cli/commands/jobs.ts`, `cli/commands/plugins.ts`, `cli/util/plugin-runtime.ts`. The convention now lives in exactly one file.

  **M1 — conformance public types adopt the `I*` prefix (BREAKING)**

  `src/conformance/index.ts` exports get the kernel-style `I*` prefix:

  - `AssertionResult` → `IAssertionResult`
  - `RunCaseResult` → `IRunCaseResult`
  - `RunCaseOptions` → `IRunCaseOptions`
  - `Assertion` (private) → `IAssertion` (now exported)
  - `AssertionContext` (private) → `IAssertionContext`
  - `ConformanceCase` (private) → `IConformanceCase`

  Consumers inside the repo (`cli/commands/conformance.ts`, `test/conformance*.test.ts`) reference `runConformanceCase` only — none of them import the type names — so the rename is type-only inside the workspace; the breaking impact is for downstream tooling that imports the conformance module directly.

  **M2 — conformance reason strings**

  New `src/conformance/i18n/runner.texts.ts` catalog. Every `reason` string the runner returns (assertion failures, JSONPath dispatch errors, containment violations, the `assertSpecRoot` throw) now flows through `tx(CONFORMANCE_RUNNER_TEXTS.<key>, vars)`.

  **M3 — registry errors**

  New `src/kernel/i18n/registry.texts.ts` catalog. The `DuplicateExtensionError` constructor, the unknown-kind throw, and the missing-`pluginId` throw all use the catalog now.

  **M4 — `sm help --format json` flag description**

  The `--help` global flag's English description in `cli/commands/help.ts` was hardcoded. Moved to `HELP_TEXTS.globalFlagHelpDescription`.

  **M5 — `resolveDbPath` is the canonical entrypoint everywhere**

  Subsumed by H2: the previously-direct `resolve(ctx.cwd, DEFAULT_PROJECT_DB)` constructions in `scan.ts`, `refresh.ts`, `watch.ts` now call `defaultProjectDbPath(ctx)` (a thin wrapper over `resolveDbPath`). `init.ts` keeps its inline path because it owns `--global` semantics that resolve through `SKILL_MAP_DIR` directly.

  **M6 — async fs in `sm db` and `sm init`**

  `cli/commands/db.ts` and `cli/commands/init.ts` switched from `fs`'s sync API (`copyFileSync`, `mkdirSync`, `existsSync`, `rmSync`, `statSync`, `readFileSync`, `writeFileSync`) to `fs/promises`. `existsSync` checks became a small `pathExists()` helper that wraps `stat()` and only swallows `ENOENT`. `DatabaseSync` and `spawnSync('sqlite3')` stay as they were (sync-only by design).

  **M7 — `sm scan compare-with` now forwards layered-loader warnings**

  Mirrors what `cli/commands/config.ts` already did for `sm config show / get / set`: the `ILoadedConfig.warnings` array is iterated to stderr instead of being silently dropped. Without `--strict`, a malformed `settings.json` now produces the same diagnostic line under compare-with that it produces under every other read-side verb.

  **L1 — collapsed duplicate DB-path constants**

  `DEFAULT_PROJECT_DB` and `DEFAULT_GLOBAL_DB` resolved to the same string. Replaced by the single `DEFAULT_DB_REL`.

  **L3 — dropped the unused `LOGGER_FLAG_NAME` export**

  `cli/util/logger.ts` exported both `LOGGER_ENV_VAR` (used by `entry.ts`) and `LOGGER_FLAG_NAME` (no consumers anywhere). Dropped the latter; the internal `FLAG_NAME` constant stays because `extractLogLevelFlag` still uses it.

  **Validation**

  `npm run validate` clean (lint across workspaces). `npm test -w src` 693/693 pass.

- 723c022: cli-architect audit follow-up — output sanitization hardening, `StoragePort.migrations.writeBackup` signature change, atomic config write, and shared helper extraction.

  **BREAKING (pre-1.0, ships as minor per `versioning.md` § Pre-1.0)**

  `StoragePort.migrations.writeBackup(targetVersion: number)` is now `writeBackup(destPath: string)`. The port stays a generic "WAL-checkpoint + atomic file copy" primitive; the per-target naming (`skill-map-pre-migrate-v<N>.db` for the migrations runner; `<timestamp>.db` for `sm db backup`) is the caller's concern. `sm db backup` now routes through the port via `withSqlite` instead of opening `node:sqlite` directly. The on-disk paths and the user-facing CLI surface (`sm db backup [--out <path>]`) are unchanged — verified deliberately. No spec impact.

  **HIGH — output sanitization gaps (defence in depth)**

  Plugin-authored strings persisted in the DB (`Issue.message`, `scan_issues.data_json`, conformance assertion `reason` strings spliced from subprocess stderr, plugin-loader `reason` payloads) reach the user's terminal through several CLI render paths that previously did not pass them through `sanitizeForTerminal`. A hostile or buggy plugin could plant ANSI escape sequences or C0 control bytes in those fields and repaint the user's screen on `sm history`, `sm orphans undo-rename`, `sm conformance run`, or any verb that prints a plugin-warning row.

  - **H1** — `formatWarning` in `cli/util/plugin-runtime.ts` sanitizes + length-caps `id` (200) and `reason` (1000) before interpolation. Closes M8 in the same change. Function exported (with docstring noting test-only consumers) so the new audit unit tests can target it directly.
  - **H2** — `renderStats` in `cli/commands/history.ts` sanitizes `actionId`, `actionVersion`, `nodePath`, and the `failureReason` enum key before interpolating into the top-actions / top-nodes / failures-by-reason rows. Enum value sanitized for symmetry with `renderTable`.
  - **H3** — `cli/commands/orphans.ts` sanitizes `dataFrom` in `undoMediumFromMismatch` (sourced from `scan_issues.data_json` written by the rename heuristic) and `safeFrom` in the confirm-prompt + summary template paths.

  **MEDIUM**

  - **M1** — `cli/commands/conformance.ts` extracts `formatAssertionFailureDetail(type, reason)` that sanitizes + caps `reason` to 1000 chars. The conformance runner splices subprocess stderr verbatim into `runtime-error` reasons; a runaway impl-under-test could emit kilobytes that drown the user's terminal. Helper exported for the audit unit tests.
  - **M2** — see BREAKING above.
  - **M3** — `cli/commands/jobs.ts` swaps `unlinkSync` for `await unlink` from `node:fs/promises` in the prune loop. Aligns with the rest of the verb (already async) and avoids blocking the event loop on slow filesystems.
  - **M4** — extracts shared `bucketByKind` helper at `kernel/util/bucket-by-kind.ts`. `built-in-plugins/built-ins.ts:bucketBuiltIn` and `cli/util/plugin-runtime.ts:bucketLoaded` both consume it; the open-coded six-way `switch (ext.kind)` blocks (each with its own exhaustive-`never` guard) collapse to one centralized dispatch table. The helper still owns the exhaustive switch so adding a new `ExtensionKind` flags every caller through the `never` guard at compile time. The `eslint-disable-next-line complexity` justification (AGENTS.md category 6 — discriminated-union dispatcher) moves to the helper.
  - **M5** — `cli/commands/config.ts` `writeJsonAtomic` replaces `writeFileSync` with stage-to-`<path>.tmp.<pid>` + `renameSync`. POSIX guarantees rename atomicity on the same filesystem, so a crash mid-write leaves `settings.json` either at its prior content or at the new content, never half-written. Best-effort temp-file cleanup on error so we don't leak siblings if the rename target is read-only.

  **LOW**

  - **L4** — extracts shared `parsePositiveIntegerOption(raw, label, stderr)` at `cli/util/option-validators.ts` with new i18n catalog `option-validators.texts.ts`. Three near-duplicate inline checks consolidated: `sm list --limit`, `sm history --limit`, `sm history stats --top`. Each used to ship its own `LIST_TEXTS.invalidLimit` / `HISTORY_TEXTS.limitNotPositiveInt` / `HISTORY_TEXTS.topNotPositiveInt` wording; the three keys are removed and replaced by a single `OPTION_VALIDATORS_TEXTS.notPositiveInt` template scoped by the `{{label}}` placeholder. Acceptance rules stay locked across sites (a permissive `Number.parseInt('12abc', 10)` would otherwise accept `12` — every call site repeats the same trim + signed + non-integer guard).
  - **L8** — `built-in-plugins/formatters/ascii/index.ts` sanitizes `issue.analyzerId` for symmetry with the sibling `issue.message` sanitization. The registry validator already constrains `analyzerId` to `[a-z0-9-]+`, but defence in depth keeps the gate uniform if the validator ever loosens.

  **Tests**

  725/725 pass (+31 vs prior 694). New: `test/bucket-by-kind.test.ts` (M4 dispatch table coverage), `test/option-validators.test.ts` (L4 boundary cases). Modified: `test/plugin-runtime.test.ts` (H1), `test/history-cli.test.ts` (H2 + L4), `test/orphans-cli.test.ts` (H3), `test/conformance-cli.test.ts` (M1), `test/config-cli.test.ts` (M5), `test/storage.test.ts` (M2 port shape), `built-in-plugins/formatters/ascii/ascii.test.ts` (L8).

  No spec changes — `spec/index.json` not regenerated. `npm run lint` clean, `npm run -w src build` clean.

- 147adb8: feat(cli): compact `sm --help` and per-verb help

  Replace Clipanion's default top-level and per-verb help output with a project-styled, compact renderer that fits the rest of the CLI's visual language. The normative `--format json` and `--format md` paths (locked by `spec/cli-contract.md` § Help) are untouched — only the human format changed.

  **Top-level overview (`sm`, `sm --help`, `sm -h`, `sm help` no-verb)**

  New `RootHelpCommand` replaces `Builtins.HelpCommand`. Layout: header tagline → USAGE block → EXAMPLES block → per-category sections (uppercased, alphabetical) → footer pointing at `sm <command> --help`. Per-category column width is computed independently so a single long verb doesn't widen every other section. Stub verbs (those whose description starts with `(planned)`) get a leading `[stub] ` tag in the description column (and in the single-verb header), and the `(planned)` parenthetical is stripped to keep the column flush. Long rows are truncated with a `…` ellipsis at 120 chars.

  **Per-verb help (`sm <verb> --help`, `sm help <verb>`)**

  New `routeHelpArgs(args, cli)` in `cli/entry.ts` (called before `cli.run`) intercepts `sm <verb...> --help|-h` and rewrites it to `sm help <verb...>`, picking the longest registered verb-path prefix. Pure function, lives next to the renderer in `cli/commands/help.ts`. `HelpCommand.verb` switched from `Option.String` to `Option.Rest` so multi-token verbs (`db migrate`, `scan compare-with`, `config get`) work via `sm help <verb>` too. `renderSingle` rewritten with HEAD / USAGE / DESCRIPTION / FLAGS sections matching the overview. The USAGE line now shows real positionals (`<orphanPath>`, `<dump> ...`, etc.) extracted from Clipanion's detailed-usage string — required adding `usage` to `ICliDefinition` because `def.path` is just the verb path; positionals only live in the detailed `def.usage`. FLAGS rows show the first sentence of each flag's description, padded into a column, truncated at 120 chars.

  **Category consolidation** (eliminate one-verb categories)

  `version` moves from `Setup & state` → `Introspection`. The two `actions` stubs move from `Actions` → `Jobs`. `serve` moves from `Server` → `Setup`. Cascades cleanly into `context/cli-reference.md` (regenerated; `npm run cli:check` clean).

  **i18n**

  Every new user-facing string lives in `cli/i18n/help.texts.ts` per the project's `tx(*_TEXTS.*)` discipline — no inline strings in command code.

  **Lint**

  Three new functions tripped the `complexity=8` cap. `extractPositionals` is a legit char-by-char tokenizer (AGENTS.md exception #2 — `eslint-disable-next-line complexity` with the documented justification). `renderSingle` and `routeHelpArgs` were split into helpers cleanly, no disables.

  **Spec stance**

  The human help format is not spec-normative — only `--format json` and `--format md` are locked by `spec/cli-contract.md` § Help, and those paths are untouched. The contract requirement that `sm`, `sm --help`, `sm -h` all print top-level help and exit 0 is still satisfied. No spec change, no `spec/CHANGELOG` entry.

  Classified `minor` (not `major`) per AGENTS.md "Pre-1.0: never bump to a major" — pre-1.0 breaking changes ship as minor bumps.

  **Validation**

  `npm run validate` (lint) clean, `npm test -w src` 693/693 pass, `npm run cli:reference` regenerated, `npm run cli:check` confirms in sync. Manual smoke across `sm`, `sm --help`, `sm -h`, `sm help`, `sm scan --help`, `sm db migrate --help`, `sm orphans reconcile --help`, `sm scan compare-with --help`, `sm config get --help`, `sm help <verb>` for the same set, plus `sm help <verb> --format json|md` (normative formats — unchanged behaviour).

- 256fb70: security: harden CLI/kernel against prototype pollution, ANSI injection, and path-escape attacks (audit findings H1–H3, M1–M6, L1)

  - **H1** — `kernel/config/loader.ts` `deepMerge` now skips `__proto__` / `constructor` / `prototype` keys, closing the lane where a hostile config layer (settings.json, overrides) could mutate the merged config's prototype chain via the `additionalProperties: true` opening inside `plugins[*].config`.
  - **H2** — `cli/commands/config.ts` `getAtPath` / `setAtPath` / `deleteAtPath` reject pollution-class path segments before walking; `sm config set __proto__.x true` exits 2 with a clear message instead of polluting the running process's prototype chain.
  - **H3** — `kernel/orchestrator.ts` `mergeNodeWithEnrichments` filters pollution keys from every source before copying; a malicious extractor can no longer reshape the merged frontmatter's prototype via persisted `enrichments.value`.
  - **L2** (defense-in-depth) — claude provider strips pollution keys from parsed YAML frontmatter at parse time so downstream `Object.assign`-style merges remain safe even without per-callsite filters.
  - **M1** — new `kernel/util/safe-text.ts` (`stripAnsi`, `sanitizeForTerminal`) wired through ASCII formatter, `sm show`, `sm export`, `sm scan-compare`, `sm conformance`. Disk-sourced strings (titles, paths, issue messages, plugin output) are stripped of ANSI/CSI/OSC escapes and dangerous C0 controls before reaching stdout/stderr.
  - **M2 / L1** — `sm db reset` now whitelists + double-quotes table names taken from `sqlite_master`; `sm db dump --tables` rejects non-identifier names with a clean error.
  - **M3** — `kernel/adapters/plugin-loader.ts` rejects `extensions[*]` entries and `storage.schema(s)` paths whose resolved form escapes the plugin directory (closes the cross-plugin reference lane).
  - **M4** — `conformance/index.ts` validates that case-supplied `fixture` and assertion `path` values stay inside `fixturesRoot` / `scope` before any filesystem read or copy.
  - **M5** — `kernel/adapters/sqlite/plugin-migrations-validator.ts` rejects plugin migrations whose string literals contain `--` or `/*`, closing the validator/exec divergence noted in the audit.
  - **M6** — `kernel/adapters/sqlite/migrations.ts` asserts `Number.isInteger` on the migration version before interpolating it into `PRAGMA user_version`.

  No changes to public APIs; behaviour change is limited to rejecting previously-undefined-but-dangerous inputs.

### Patch Changes

- 3c07b8f: refactor: cli-architect audit follow-up — i18n discipline in built-in plugins, scan-compare delta, plugin-runtime warnings, and `IDbLocationOptions` runtime-context unification

  Internal hygiene only. No spec changes, no public CLI surface change, no behavioural change to output bytes — every promoted renderer keeps producing the same text it produced before, only the mechanism (`tx(*_TEXTS.*)`) changed. `cli/util/db-path.ts` is CLI-internal (not exported via `src/index.ts` or `src/kernel/index.ts`), so the helper signature change is a no-op for downstream consumers.

  **F1 — `scan-compare` delta render lifted to the catalog**

  `cli/commands/scan-compare.ts` (lines 217-263) was rendering the human delta with hardcoded English strings (`'Delta vs ...'`, `'## nodes'`, `'## links'`, `'## issues'`, `+`/`-`/`~` row prefixes). The previous i18n sweep had missed it. 11 new keys land in `cli/i18n/scan.texts.ts` (`compareDeltaSummary`, `compareDeltaNoDifferences`, plus header / row catalog entries for nodes / links / issues) and the renderer routes through `tx()` end-to-end.

  **F2 — `built-in-plugins/` joins the `tx()` discipline**

  Every `Issue.message` produced by a built-in rule and every line emitted by the ASCII formatter were inline English templates. `Issue.message` strings persist in `scan_issues.message` and surface through `sm check` / `sm show` / `sm export` — they are user-facing exactly like CLI stdout, so the same i18n rule applies. New directory `src/built-in-plugins/i18n/` ships six catalogs (`broken-ref.texts.ts`, `superseded.texts.ts`, `trigger-collision.texts.ts`, `validate-all.texts.ts`, `link-conflict.texts.ts`, `ascii.texts.ts`) and each built-in migrates to `tx(*_TEXTS.*)`. AGENTS.md gains a bullet under "i18n strategy" extending the rule to `built-in-plugins/`.

  **F3 — `IDbLocationOptions` extends `IRuntimeContext` (closes TODO M3)**

  The TODO left in the previous audit pass (`cli/util/db-path.ts`) is now closed. `IDbLocationOptions` extends `IRuntimeContext`, so `cwd` and `homedir` are mandatory; the helper no longer reads `process.cwd()` / `homedir()` directly. The local duplicate `resolveDbPath` in `cli/commands/plugins.ts` is dropped and that file imports the canonical helper. 21 call sites across 11 commands (`export`, `list`, `show`, `history`, `orphans`, `check`, `graph`, `db`, `version`, `plugins`, plus the related util) thread `{ ...defaultRuntimeContext() }` at the call edge.

  **F4 — `plugin-runtime.formatWarning` catalogued**

  `cli/util/plugin-runtime.ts:formatWarning` was composing `'plugin <id>: <status> — <reason>'` inline. New catalog `cli/i18n/plugin-runtime.texts.ts` ships `PLUGIN_RUNTIME_TEXTS.warningRow` + `warningReasonMissing`; `formatWarning` now routes through `tx()`.

  **F5 — `export.ts` deferred-format reason catalogued**

  The raw English `reason` string `'lands at Step 12 with the mermaid formatter'` interpolated by `cli/commands/export.ts` moves to `EXPORT_TEXTS.formatDeferredReasonMermaid`.

  **F6 — orphan JSDoc cleanup in `init.ts`**

  A JSDoc block documenting `ensureGitignoreEntries` had drifted on top of `previewGitignoreEntries` after a previous refactor. Moved back to its rightful function.

  **F7 — `confirm.ts` yes-pattern catalogued**

  `cli/util/confirm.ts` hardcoded `/^y(es)?$/i`. The regex source moves to `UTIL_TEXTS.confirmYesPatternSource` and the helper compiles it with the `i` flag. Trivial today but pre-wires the day a non-English locale lands (`^(y(es)?|s(í|i)?)$`).

  **F10 — `storage-adapter.ts` header docstring rewording**

  The header of `kernel/adapters/sqlite/storage-adapter.ts` claimed `enrichments` was a top-level property of the adapter class. It is not — `enrichments` lives on `ITransactionalStorage` (handed out via `port.transaction(...)`). Reworded to match.

  **Validation**

  `npm run -w src build` clean, `npm run lint` clean, `npm test -w src` 693/693 pass, `tsc --noEmit` clean.

- 62d3124: refactor: cli-architect audit follow-up — i18n discipline, runtime-context sweep, ExitCode literal cleanup

  Internal hygiene only. No spec changes, no public CLI surface change, no behavioural change to output bytes — every promoted renderer was audited against its existing tests and the regenerated `context/cli-reference.md` is byte-identical to the pre-sweep version under matching CLI / spec versions (the diff in this commit is the legitimate version drift, not an i18n regression).

  **M1 — i18n discipline in `cli/commands/help.ts`**

  Promoted every hardcoded English string in `renderMarkdown` / `renderVerbBlock` / `renderVerbFlags` / `renderVerbExamples` / `renderSingle` to `cli/i18n/help.texts.ts`. 14 new keys: `mdReferenceTitle`, `mdGeneratedNotice`, `mdCliVersionLine`, `mdSpecVersionLine`, `mdHeaderGlobalFlags`, `mdGlobalFlagBullet`, `mdCategoryHeading`, `mdVerbHeading`, `mdLabelFlags`, `mdLabelExamples`, `mdFlagBullet` (+ `mdFlagBulletRequiredFragment` / `mdFlagBulletDescriptionFragment` for the optional trailing slots), `mdExampleBullet`, `humanVerbHeader`, `humanLabelFlags`, `humanFlagRow` (+ `humanFlagRowRequiredFragment`). Markdown structural pieces (code-fence backticks, table pipes) stay inline — they are syntax, not user-facing prose.

  **M2 — `refresh.ts` "read failed for &lt;path&gt;: &lt;err&gt;" sub-detail catalogued**

  `#runDetExtractorsAcrossNodes` was composing the inner error string via TS template inside the `tx(REFRESH_TEXTS.refreshFailed, …)` call. Lifted the inner copy to `REFRESH_TEXTS.readFailedDetail` (`'read failed for {{path}}: {{message}}'`) and the call site now nests a `tx(…)` for the detail inside the outer `refreshFailed`. Same output bytes, but every translatable substring is now in the catalog.

  **M3 — `defaultRuntimeContext()` sweep across `cli/commands/`**

  Replaced direct `process.cwd()` / `homedir()` reads with `defaultRuntimeContext()` in: `init.ts` (and the `runFirstScan` helper now takes `homedir` as a parameter), `jobs.ts`, `refresh.ts`, `scan-compare.ts`, `config.ts` (`ConfigSetCommand` / `ConfigResetCommand`), `plugins.ts` (`resolveSearchPaths`, `resolveDbPath`, `buildResolver`, `loadAll`, `expandHome`, `collectExplorationDirWarnings`, `TogglePluginsBase`), and `cli/util/plugin-runtime.ts` (`resolveSearchPaths`, `dbPathForScope`). The `cli/**` layer is allowed to call Node globals, but funnelling them through one helper keeps the future "drive the CLI from a non-process host" path clean and matches the pattern already established in earlier audit sweeps.

  **M3 deferred — `cli/util/db-path.ts` carries a TODO**

  `resolveDbPath` (and its `IDbLocationOptions` shape) still reads `homedir()` and `process.cwd()` directly. Promoted to a `TODO(cli-architect M3)` block in the file's docstring rather than rewritten inline because flipping the signature touches 18 call sites across 11 commands for a helper that lives in `cli/util/` (not in `kernel/**`, where the no-Node-globals invariant actually bites). The comment names the exact follow-up: extend `IDbLocationOptions` from `IRuntimeContext`, drop the imports, thread `...defaultRuntimeContext()` at every call site.

  **L1 / L2 — `ExitCode.Error` literal cleanup**

  Replaced three remaining `2` integer literals with `ExitCode.Error`: `db.ts:623,655` (plugin-migration failure paths) and `config.ts:202` (config-load failure path). Aligns with the H1 sweep from the prior audit pass that migrated 123 sites.

  **Validation**

  `npm run lint` clean, `npm run typecheck -w src` clean, `npm test -w src` 693/693 pass, `npm run validate` clean, `npm run cli:check` clean (the `context/cli-reference.md` regen in this commit reflects normal CLI / spec version drift since the file was last regenerated; the i18n sweep verified byte-identical render at HEAD's pre-sweep version values).

- 7d14da9: refactor: cli-architect re-audit follow-up — dedupe `dbPathForScope`, share `SKILL_MAP_DIR` const, fold trigger-collision joiner into the i18n template

  Internal hygiene only. No spec changes, no public CLI surface change, no behavioural change to output bytes — every emitted string keeps its previous value (the test suite covers the affected paths and stays green); only the indirection moved.

  **N1 — `dbPathForScope` helper dropped from `cli/util/plugin-runtime.ts`**

  `buildEnabledResolver` was reimplementing the project=cwd vs global=homedir DB-path resolution that already lives in `resolveDbPath` (`cli/util/db-path.ts`). The local helper plus its private `DB_FILENAME` constant are removed; the resolver now calls `resolveDbPath({ global: scope === 'global', db: undefined, ...ctx })` directly. Single source of truth for the canonical `--db > --global > project` precedence.

  **N2 — `SKILL_MAP_DIR` constant shared between `db-path.ts` and `init.ts`**

  `cli/commands/init.ts` was constructing `join(scopeRoot, '.skill-map')` with the literal duplicated from the convention encoded in `cli/util/db-path.ts`. New exported const `SKILL_MAP_DIR = '.skill-map'` lands in `db-path.ts` with a docstring explaining the per-scope layout. `init.ts` imports and uses it; the internal `DEFAULT_PROJECT_DB` / `DEFAULT_GLOBAL_DB` constants now derive from `${SKILL_MAP_DIR}/${DB_FILENAME}` instead of re-typing the literal. Future changes to the directory convention happen in one place.

  **N3 — Trigger-collision joiner moved inside the `tx()` template**

  `built-in-plugins/i18n/trigger-collision.texts.ts` was exposing `partsJoiner: '; and '` as a separate key that the rule code stitched into the message via `parts.join(...)`. The joiner sat outside the template, which means a future `es` locale would need to patch rule code, not just the catalog. Replaced the `(message, partsJoiner)` pair with two templates: `messageOnePart` (`'Trigger "{{normalized}}" has {{part}}.'`) and `messageTwoParts` (`'Trigger "{{normalized}}" has {{first}}; and {{second}}.'`). `analyzeTriggerBucket` picks the template based on `parts.length` and a comment documents that `parts.length ∈ {1, 2}` by construction (advertiser-ambiguous and cross-kind-ambiguous are mutually exclusive — the latter requires `advertiserPaths.length === 1` — so the two-part path is exactly advertiser-ambiguous + invocation-ambiguous). The `'; and '` joiner now lives entirely inside the catalog; a future `'; y '` swap is a single-key edit.

  **Validation**

  `npm run -w src build` clean, `npm run lint` clean, `npm test -w src` 693/693 pass.

- 4080efd: refactor: i18n discipline sweep across CLI renderers + storage-port-promotion follow-up

  Internal tightening only. No spec changes, no public CLI surface change, no behavioural change to output bytes — every promoted renderer was audited against its existing tests (notably the `sm job prune` colon alignment and `renderStats` join semantics).

  **Storage port follow-up (Phase F leftovers)**

  - `StoragePort.migrations` gains `currentSchemaVersion(): number | null`, implemented in `SqliteStorageAdapter` via `withRawDb` + `PRAGMA user_version`. `cli/commands/version.ts` now resolves the DB schema version through the port + `tryWithSqlite` instead of importing `node:sqlite` directly. The `existsSync` short-circuit (no provisioning for an informational read) is preserved by `tryWithSqlite`.
  - Cleaned up Phase D/F residue: dropped `void sql;` + the unused `sql` import in `kernel/adapters/sqlite/plugins.ts`; dropped the empty residual import from `cli/commands/plugins.ts`; dropped the unused `existsSync` import in `cli/commands/scan.ts`; dropped `void join;` + the unused `join` import in `cli/commands/jobs.ts`. Refreshed the `db` getter docstring on `SqliteStorageAdapter` (was tagged "Pre-Phase F" — Phase F is DONE; rewrote it as the documented test-only escape hatch).

  **i18n discipline sweep**

  Promoted hardcoded English strings inside CLI command renderers to their `*_TEXTS` catalogs, per the AGENTS.md i18n strategy ("every CLI command sources its strings from a sibling `cli/i18n/<verb>.texts.ts` via `tx(*_TEXTS.<key>)`"):

  - `sm db migrate` apply / dry-run output (`Nothing to apply`, `Would apply N`, `Already up to date`, `Applied N`, `Applied N · backup: …`) → `DB_TEXTS`.
  - `sm history` validation errors (`--limit` / `--period` / `--top`), the internal schema-validation error, render-table headers, and the entire `renderStats` block (window, totals, error rate, top actions/nodes, failures by reason) → `HISTORY_TEXTS`.
  - `sm job prune` pretty output (tag, retention rows, orphan-files row, verbs, `formatPolicy('never')`) → `JOBS_TEXTS`. Colon alignment for `failed:    policy …` preserved verbatim.
  - `sm list` render-table column headers → `LIST_TEXTS`.
  - `sm orphans undo-rename` no longer concatenates English directly into `scan_issues.message`; routed through `tx(ORPHANS_TEXTS.undoRenameOrphanMessage, …)` (with a docstring noting the ideal layering would be kernel-side).
  - `sm plugins` list / show renderers (`renderBuiltInBundleRow`, `renderPluginRow`, `renderBuiltInDetail`, `renderPluginDetail`, `renderExtensionsList`) → `PLUGINS_TEXTS`.
  - `sm show` human renderer (`renderHuman`, `renderNodeHeader`, `renderIssuesSection`, `renderLinksSection` — section headers, `(none)` placeholder, optional-field rows, weight/tokens/external refs lines, issue rows) → `SHOW_TEXTS`.
  - New `cli/i18n/util.texts.ts` (`UTIL_TEXTS`) for cross-cutting strings: `db-path` `dbNotFound`, `elapsed` `done in <…>`, `confirm` `[y/N]` suffix.

- 33383c9: Security audit fixes (cli-hacker sweep):

  - Sanitize ANSI escape sequences and C0 control bytes in `sm check`, `sm history`, `sm list`, `sm orphans`, `sm plugins` output (defense in depth — values originate from plugin-authored strings persisted in the DB).
  - Upgrade `stripAnsi()` regex in `kernel/util/safe-text.ts` to the strip-ansi v7 pattern so OSC 8 hyperlinks (with `:/?#&=` chars in the URL) strip cleanly instead of leaving the URL fragment behind.
  - Reject `node.path` values that are absolute or escape the repo root in `sm refresh` (defense in depth against tampered DB files); shared helper at `cli/util/path-guard.ts`.
  - Skip symlinks explicitly in the built-in claude `walkMarkdown` (audit M7); document that `scan.followSymlinks` is reserved for a future cycle-aware implementation.
  - Pin `js-yaml` schema to `JSON_SCHEMA` in the claude provider's frontmatter parser.
  - Preserve `0o600` permissions on `sm db restore`.
  - Sanitize `--log-level` raw input before printing the invalid-level warning.
  - Sanitize conformance case id before using it as the `mkdtemp` prefix.
  - Move `truncate(...)` into a shared `cli/util/text.ts` and make it UTF-8 safe (split on code-point boundaries via `Array.from`).
  - Document untrusted-repository plugin auto-loading risk in the CLI README.

  No behavioral changes for trusted inputs; only hardens output rendering and edge-case validation.

- Updated dependencies [f8fca25]
  - @skill-map/spec@0.11.0

## 0.8.0

### Minor Changes

- bb7ff01: Audit cleanup pass — close four mechanical items from the
  `cli-architect` audit in a single sweep. **Pre-1.0 minor bump** per
  `spec/versioning.md` § Pre-1.0; the API changes below are technically
  breaking but ship as a minor while the package stays `0.Y.Z`.

  ## V5 — kernel stops reading Node globals

  `ILoadConfigOptions.cwd` / `.homedir` and `ICreateFsWatcherOptions.cwd`
  are now **mandatory**. Previously they fell back to `process.cwd()` /
  `os.homedir()` inside the kernel — which broke the kernel-isolation
  invariant the linter enforces elsewhere. New helper
  `src/cli/util/runtime-context.ts#defaultRuntimeContext()` wraps
  `{ cwd: process.cwd(), homedir: homedir() }`; the CLI threads it
  through every `loadConfig` / `createChokidarWatcher` call. Eight CLI
  sites migrated (`scan`, `watch`, `jobs`, `scan-compare`, `plugins`,
  `config` × 3, `init`, `plugin-runtime` resolver) plus seven test sites
  in `watcher.test.ts`.

  **Breaking** for any external consumer of `loadConfig` /
  `createChokidarWatcher` that relied on the implicit fallback — they
  now must pass `cwd` (and `homedir` for `loadConfig`) explicitly.

  ## V8 — no more `pluginId` mutation in plugin-runtime

  `ILoadedExtension` gains an `instance: unknown` field alongside
  `module: unknown`. The loader now shallow-clones the runtime instance
  (default export, or the module namespace when none) and injects
  `pluginId` per spec § A.6, exposing the result as `instance`. The CLI
  runtime composer (`bucketLoaded`) consumes `ext.instance` directly —
  the previous post-hoc mutation of `instance['pluginId']` is gone, and
  the obsolete `extractDefault` helper with it.

  The bug this closes: two plugins importing the same file via the ESM
  module cache shared a single mutable object, so the second `pluginId`
  assignment stomped the first. Centralising the clone in the loader
  makes the issue structurally impossible.

  **Additive** at the type level (`instance` is a new field consumers
  read; only the loader produces it).

  ## V9 — `confirm()` accepts streams from the Clipanion context

  `src/cli/util/confirm.ts` now takes
  `confirm(question, { stdin, stderr })` instead of reaching for
  `process.stdin` / `process.stderr`. Every command site
  (`db restore`, `db reset --hard`, `db reset --state`,
  `orphans undo-rename`) passes `this.context.stdin` /
  `this.context.stderr`, so commands become testable with captured
  streams instead of monkey-patching the globals.

  **Breaking** for any external caller of the helper (none expected —
  it lives under `src/cli/util/`).

  ## D7 — extracted `isBundleEntryEnabled` helper

  The toggle-resolution logic
  (`if (granularity === 'bundle') resolveEnabled(bundle.id) else
resolveEnabled(qualifiedExtensionId(...))`) was duplicated between
  `isBuiltInExtensionEnabled` (typed `TBuiltInExtension`) and the inline
  filter inside `filterBuiltInManifests` (raw `IPluginManifest.id`). A
  new private helper `isBundleEntryEnabled(bundle, extId, resolveEnabled)`
  operates on the plain extension id; both call sites delegate to it.
  Pure refactor, no behaviour change.

  ## Out of scope

  The audit's SD4 item (88 references to "Step N / Phase N" in kernel
  docstrings) is deferred to a dedicated docs pass — too large for a
  mechanical sweep.

- d058bf8: Close H1 / M1 / M3 from the cli-architect review.

  - **kernel — `IExtractorContext.store` wiring (spec § A.12)**: `RunScanOptions.pluginStores?: ReadonlyMap<string, IPluginStore>` is threaded through `walkAndExtract → runExtractorsForNode → buildExtractorContext` and surfaced on `ctx.store`. Legacy contract preserved (no entry for a plugin id → `ctx.store` stays `undefined`). The orchestrator never touches the wrapper's persist callback; driving adapters supply it. New public exports on `kernel/index.ts`: `IPluginStore`, `IKvStoreWrapper`, `IDedicatedStoreWrapper`, `IKvStorePersist`, `IDedicatedStorePersist`, `makePluginStore`, `makeKvStoreWrapper`, `makeDedicatedStoreWrapper`, `KV_SCHEMA_KEY`.
  - **cli — `sm version --json`**: emits `{ sm, kernel, spec, dbSchema }` exactly per `spec/cli-contract.md` § `sm version`. The orphan `json = false` field is gone; the option is wired through Clipanion. `runtime` stays in human-only output (spec lists four JSON fields).
  - **cli — `sm orphans reconcile --dry-run` / `sm orphans undo-rename --dry-run`**: previews the FK migration without mutating. Rollback is forced via a sentinel symbol thrown inside the Kysely transaction so the dry-run path runs the same `migrateNodeFks` code as live mode (no count-only divergence). Per spec § Dry-run, `--dry-run` skips the `--force` confirm prompt entirely.
  - **cli — refresh stream discipline (M1)**: mid-action banners (`refreshingStale`, `refreshingNode`) move from stdout to stderr so a future `--json` mode (or any pipe consumer) sees only the payload.
  - **cli — printer abstraction**: new `cli/util/printer.ts` exposing `IPrinter { data, info, warn, error }` with a `quietInfo` flag for `--json` gating. Optional helper for verbs that opt in.
  - **cli — orphans i18n migration**: ten new entries in `cli/i18n/orphans.texts.ts` replacing inline string templates in `reconcile` and `undo-rename`.

  Tests:

  - `test/orchestrator-ctx-store.test.ts` (new, 5 cases): pluginStores absent → `undefined`; pluginStores entry matches `pluginId` → wrapper inyected, persist captures writes; multi-plugin without leakage; plugin without entry stays `undefined`; `runExtractorsForNode` honours the same wiring.
  - `test/orphans-cli.test.ts` (+ 2 cases): `reconcile --dry-run` + `undo-rename --dry-run` both leave `state_executions` and `scan_issues` UNCHANGED.
  - `test/cli.test.ts` (+ 1 case): `sm version --json` emits the four-field shape per spec.
  - `test/node-enrichments.test.ts`: updated to expect `Refreshing enrichments for` on stderr after the M1 banner move.

  What is NOT in this PR (deferred):

  - The CLI side of H1 (Mode A persister against `state_plugin_kvs`, Mode B dedicated-table persister) is out of scope until the first plugin declares `storage`. The kernel seam ships now so any future driver can plug in without an orchestrator change.

- b5a1a1e: Correct misclassified exit codes in `sm export` and `sm graph`.

  Per `spec/cli-contract.md` § Exit codes, exit `5` is reserved for
  "DB missing"; user/argument errors return `2`. The two verbs were
  returning `5` for cases that have nothing to do with a missing DB —
  unsupported `--format`, invalid `--query`, deferred formatters, no
  formatter registered.

  **Sites corrected:**

  - `sm export --format mermaid` (deferred to Step 12) → `2` (was `5`).
  - `sm export --format <unsupported>` → `2` (was `5`).
  - `sm export --query '<invalid>'` → `2` (was `5`).
  - `sm graph --format <no-formatter-registered>` → `2` (was `5`).

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0: this changes a
  user-observable contract (exit code) so it ships as a minor while the
  package is `0.Y.Z`. Header comments on both verbs and three
  test-suite assertions updated.

- 698dd5d: Introduce `LoggerPort` on the kernel and a concrete CLI `Logger`
  adapter, replacing the last direct `console.error` write inside the
  kernel.

  **Why.** The kernel must not write to stdout/stderr directly — that's
  an adapter concern. Until now the orchestrator's probabilistic-hook
  deferral notice was a `console.error` call, which made kernel output
  untestable, unconfigurable, and impossible to silence from an embedded
  host.

  **What.**

  - New `LoggerPort` (`trace` / `debug` / `info` / `warn` / `error`)
    with `LogLevel` (incl. `silent` sentinel), `LogRecord`, and helpers
    (`parseLogLevel`, `logLevelRank`, `isLogLevel`, `LOG_LEVELS`).
  - New `SilentLogger` no-op default — equivalent in spirit to
    `InMemoryProgressEmitter`.
  - New module-level singleton (`log` proxy + `configureLogger` /
    `resetLogger` / `getActiveLogger`). Imports made before bootstrap
    see the new impl on every call — no captured-stale-logger bugs.
  - New CLI `Logger` (level + stream + format), default formatter
    `HH:MM:SS | LEVEL | message [| ctx]` (local time, stderr).
  - `entry.ts` pre-parses `--log-level` (flag wins over
    `SKILL_MAP_LOG_LEVEL` env var, fallback `warn`) before Clipanion
    sees argv, then calls `configureLogger(...)`.
  - Orchestrator's `console.error` → `log.warn(...)` with structured
    `{ hookId, mode }` context; the `logger` knob on `runScan` /
    `makeHookDispatcher` is gone (singleton replaces it).

  Tests that previously monkey-patched `console.error` now install an
  in-test `LoggerPort` via `configureLogger(...)` and restore via
  `resetLogger()` in `finally`.

- 124ccda: Open `Node.kind` and `IProvider.classify` to `string` end-to-end on the TS side (Phases B + C).

  Phase A (spec) shipped the contract; this lands the TypeScript runtime to match. Three layers move:

  - **`Node.kind: string`** (was `NodeKind`). The orchestrator, persistence layer, and every renderer accept whatever an enabled Provider classifies into — built-in Claude catalog kinds (`skill` / `agent` / `command` / `hook` / `note`) plus anything an external Provider declares.
  - **`IProvider.classify(...) → string`** (was `→ NodeKind`). Cursor / Obsidian / Roo Providers can return their own kinds without the `as NodeKind` cast that previously lied to the type system.
  - **`TNodeKind = string`** in `kernel/adapters/sqlite/schema.ts` (was the closed five-value union). The `as NodeKind` cast in `rowToNode` (`scan-load.ts`) is gone.

  `NodeKind` survives as an exported type alias for the **built-in Claude Provider catalog only**, with a docstring clarifying it is no longer the kernel-wide kind type. Code that intentionally narrows on the five claude kinds (the `validate-all` rule's per-kind frontmatter schema map, the `KIND_ORDER` rendering arrays, claude-aware UI cards) keeps using it. Code that handles arbitrary kinds widens to `string`.

  Side effects:

  - **`sm export`'s query parser drops the closed-enum check** for `kind=...` clauses. `kind=widget` is now structurally valid (open-by-design); it matches zero nodes if no Provider classifies into `widget`. Empty values (`kind=`) still error. Matches `node.schema.json#/properties/kind`.
  - **`ascii` formatter and `sm export`'s markdown renderer**: nodes are bucketed by an open string. Built-in Claude catalog renders first in canonical order; external-Provider kinds append after, alphabetically sorted, so output stays deterministic across runs.
  - **`built-in-plugins/rules/trigger-collision`**: `ADVERTISING_KINDS` is now `ReadonlySet<string>` (still containing the same three claude kinds); the rule applies if `node.kind` is in the set, and external Providers can extend the set in a future release without touching the rule.

  Tests: `extractor-applicable-kinds.test`, `self-scan.test`, and `export-cli.test` updated where they pinned `NodeKind`-typed accumulators. The "rejects unknown kind value" parser test became "accepts arbitrary kind tokens" (the parser no longer enforces a closed enum); the "invalid query → exit 2" verb test was rewritten to use `confidence=high` (an actually-unknown key) instead of `kind=widget`.

  What's still pending:

  - **Phase D** — the SQL `CHECK in (<5 values>)` constraints on `scan_nodes.kind` and `state_summaries.kind` are still live in `001_initial.sql`. They run on every existing DB. Pre-1.0 the right move is a fold of the change directly into `001_initial.sql` (no separate migration), mirroring how `002_scan_meta` was folded back; that lands in a follow-up commit.
  - **Phase E** — smoke test with a fake external Provider end-to-end, conformance suite re-run.

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0 (technically breaking for code that imported `NodeKind` and assumed it was the kernel-wide kind type, but pre-1.0 these go as minor).

- 558cf43: Replace the placeholder `PluginLoaderPort` shape with the real
  contract the concrete loader has been exposing since Step 0b, and
  pin the adapter to the port via `implements PluginLoaderPort`.

  **Why.** The port was authored as Step-0b stubs (`discover` / `load` /
  `validateManifest`, plus `PluginManifest` / `PluginStorage` /
  `LoadedExtension` types) and never updated when the real loader
  landed. Two latent risks: callers who imported from the ports barrel
  got a different shape than the actual class; and the concrete adapter
  was free to drift from the port silently. Both eliminated.

  **What.**

  - `PluginLoaderPort` now declares `discoverPaths()`,
    `discoverAndLoadAll()`, `loadOne(path)` — verbatim mirror of
    `kernel/adapters/plugin-loader.ts`.
  - The placeholder DTOs are gone; the port re-exports the real domain
    types (`IPluginManifest`, `ILoadedExtension`, `IDiscoveredPlugin`,
    `IPluginStorageSchema`, `TGranularity`, `TPluginLoadStatus`,
    `TPluginStorage`) from `kernel/types/plugin.ts`.
  - `class PluginLoader implements PluginLoaderPort` — drift is now a
    compile error.
  - New factory `createPluginLoader(opts): PluginLoaderPort`. The CLI
    call sites (`commands/plugins.ts`, `util/plugin-runtime.ts`) use it
    so production callers are pinned to the abstract shape; tests keep
    `new PluginLoader(...)` for legitimate access to internals.
  - Re-exports through `kernel/index.ts` and `kernel/ports/index.ts`
    swapped to the real domain types (already shipped in the previous
    Logger commit alongside the new `LoggerPort` exports).

- 91fea6a: Split the orchestrator's `walkAndExtract` into three named helpers and
  close audit item V4 by reusing the kernel's extractor loop from
  `sm refresh`. **Pre-1.0 minor bump** per `spec/versioning.md` § Pre-1.0;
  the API addition below would warrant a minor on its own, and the
  internal split is non-breaking (no public signature changes).

  ## Why

  `walkAndExtract` was the audit's most-flagged complexity offender
  (cyclomatic 47 — by a wide margin the worst offender in the kernel).
  Three logically distinct concerns lived in the same function:
  extractor-execution wiring, per-(node, extractor) cache decision, and
  the reused-node bundle for full cache hits. Splitting them buys
  readability, isolates the `IExtractorContext` plumbing in one place
  that `refresh.ts` can reuse, and unblocks the next round of audit
  follow-ups.

  Independently, `cli/commands/refresh.ts#runExtractorForEnrichment` was
  hand-duplicating the extract-and-fold dance: it built its own
  `IExtractorContext`, did the scope-aware `body` / `frontmatter`
  gating, folded partials into a single record, and hardcoded
  `isProbabilistic: false`. That was audit item V4, and the hardcode was
  a latent correctness bug — a probabilistic extractor passed to refresh
  persisted with `isProbabilistic: false` while the in-scan path
  correctly read `extractor.mode === 'probabilistic'`.

  ## What

  ### `src/kernel/orchestrator.ts` — three new helpers

  - **`runExtractorsForNode(opts)`** — `export`ed. Runs N extractors
    against a single node and returns
    `{ internalLinks, externalLinks, enrichments }`. Encapsulates the
    `IExtractorContext` build + `emitLink` / `enrichNode` callback
    wiring + per-`(node, extractor)` enrichment folding. Reuses the
    existing private helpers (`buildExtractorContext`, `validateLink`,
    `isExternalUrlLink`).
  - **`computeCacheDecision(opts)`** — internal. Returns
    `{ applicableExtractors, applicableQualifiedIds, cachedQualifiedIds,
missingExtractors, fullCacheHit }` for one node. Handles both the
    fine-grained `priorExtractorRuns` case and the legacy fallback
    (when the caller did not load breadcrumbs — preserves the pre-A.9
    contract).
  - **`reusePriorNode(opts)`** — internal. Builds the reused-node
    bundle for a full cache hit: shallow-clones the prior node, reshapes
    its outbound links per A.9 sources rules
    (`reuseCachedLink(...)`), re-emits prior frontmatter issues with the
    current `strict` severity, and persists `scan_extractor_runs` rows
    for every still-applicable, still-cached pair so the cache survives
    the next `replace-all` persist.

  `walkAndExtract` complexity dropped **47 -> 35** (-12 points). The
  two new private helpers sit at 9 and 10 — just above the lint
  threshold of 8 — so visible debt remains, but the net architectural
  improvement is the worth-having change. Promoting `complexity` to
  `error` is deferred until the next round of splits brings the
  remaining offenders down.

  ### `src/kernel/index.ts` — export `runExtractorsForNode`

  Added to the orchestrator export block. New public kernel API; the
  shape mirrors `walkAndExtract`'s internal call exactly so embedders
  can reproduce a single-node extract pass without going through a full
  scan.

  ### `src/cli/commands/refresh.ts` — close audit V4

  `runExtractorForEnrichment` now delegates to `runExtractorsForNode`
  with a single-element extractor array. Refresh keeps the returned
  `enrichments` and discards the link arrays — link rebuilding is
  `sm scan`'s job and refresh stays scoped to the enrichment layer.
  ~30 lines of duplication eliminated; the `isProbabilistic` field now
  correctly reflects `extractor.mode === 'probabilistic'`. Imports
  trimmed accordingly (`qualifiedExtensionId`, `IExtractorContext`,
  `Link` are no longer needed); `InMemoryProgressEmitter` is added
  as a throwaway emitter to satisfy the new API surface — refresh does
  not expose progress events.

  ### `package.json` (root) — `validate` script also runs tests

  `npm run validate` was lint-only; it now runs `npm run test &&
npm run lint --workspaces --if-present`. Intentional — local
  `validate` becomes a proper pre-push gate. CI's `build-test` workflow
  already runs tests separately, so the "Validate" step now overlaps
  with it; that overlap is acknowledged and left for a follow-up
  decision.

  ## Out of scope

  The remaining `walkAndExtract` complexity (35) is still above the
  threshold; further splits (provider walk, per-node frontmatter
  validation) will follow in the next pass. Bonus correctness fix on
  `isProbabilistic` is documented above but no behaviour test is added
  in this commit — the in-scan path already exercises the field
  correctly, and refresh's caller surface does not currently propagate
  the flag.

- e8cbd19: Storage-port promotion — Phase A (`scans` / `issues` / `enrichments` / `transaction` namespaces).

  Pre-refactor, `StoragePort` modeled only `init` / `close`. All real persistence lived as free functions in `kernel/adapters/sqlite/*.ts` that took `Kysely<IDatabase>` directly, and 8+ CLI commands consumed those free functions plus inline `selectFrom(...)` queries — hexagonal architecture in name only.

  Phase A lands the core scan pipeline:

  - **`kernel/types/storage.ts`** (new) — option bags + result shapes (`INodeFilter`, `INodeBundle`, `INodeCounts`, `IPersistOptions`, `IIssueRow`).
  - **`kernel/ports/storage.ts`** — full namespaced shape declared (full surface, not Phase-A-only). `scans` / `issues` namespaces have method bodies; `transaction(fn)` exposes `ITransactionalStorage` with `scans.persist` / `issues.deleteById,insert` / `enrichments.upsertMany`.
  - **`kernel/adapters/sqlite/storage-adapter.ts`** — implements the namespaces. `scans.persist` delegates to `persistScanResult`, `scans.load` to `loadScanResult`, `findNodes` reproduces `sm list`'s filter logic with a defensive `sortBy` whitelist, `findNode` returns the bundled node + outgoing/incoming links + filtered issues. `transaction(fn)` wraps `Kysely.transaction().execute(...)` and hands the callback a `buildTxSubset(trx)` projection.
  - **9 CLI commands migrated**: `scan`, `list`, `show`, `check`, `orphans`, `refresh`, `export`, `graph`, `watch`. Every `selectFrom('scan_nodes' \| 'scan_issues' \| 'scan_links')`, every `loadScanResult` / `loadExtractorRuns` / `loadNodeEnrichments` / `persistScanResult` direct call, and every `rowToNode` / `rowToLink` / `rowToIssue` import is gone from these files. The two transactional blocks in `orphans.ts` (reconcile + undo-rename) still use `adapter.db.transaction()` directly because they call `migrateNodeFks` (Phase B port surface) — they migrate when Phase B lands.

  Side effect: the CLI no longer needs to know `scan_*` table names or the json_each subquery shape. The free functions in `kernel/adapters/sqlite/scan-load.ts` and `scan-persistence.ts` stay exported for tests and the cross-phase migration; Phase F drops them from `kernel/index.ts`'s public surface.

  Tests: 617/617 pass. `findNodes` carries a defensive sortBy whitelist that mirrors the CLI's own (`list.ts` validates upstream too — defense in depth).

  Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0. Breaking for any caller that imported the kernel-side free functions, but no published consumer exists.

  What's still pending:

  - Phase B — `history` namespace (history.ts + orphans.ts migrateNodeFks).
  - Phase C — `jobs` namespace.
  - Phase D — `pluginConfig` namespace.
  - Phase E — `migrations` + `pluginMigrations` (the `sm db` verb).
  - Phase F — cleanup (drop unused free functions from `kernel/index.ts`, remove residual `import type { Kysely, IDatabase }` in CLI).

- 19fbc08: Storage-port promotion — Phase B (`history` namespace).

  - **Port surface**: `port.history.list(filter)`, `port.history.aggregateStats(range, period, top)` for the read paths; `tx.history.migrateNodeFks(from, to)` (transactional) for the FK-repointing primitive.
  - **Adapter**: `SqliteStorageAdapter.history` delegates to the existing `listExecutions` / `aggregateHistoryStats` / `migrateNodeFks` free functions in `kernel/adapters/sqlite/history.ts`. Bodies stay; the namespace is a thin façade.
  - **CLI migrated**: `cli/commands/history.ts` — `aggregateHistoryStats(adapter.db, ...)` → `adapter.history.aggregateStats(...)`; `listExecutions(adapter.db, ...)` → `adapter.history.list(...)`. `cli/commands/orphans.ts` — both transactional blocks (reconcile + undo-rename) move to `adapter.transaction(tx => tx.history.migrateNodeFks(...))` plus `tx.issues.deleteById` / `tx.issues.insert`. The `runWithOptionalRollback` helper now takes the adapter and a port-subset callback (instead of `Kysely<IDatabase>`); the `--dry-run` rollback-via-sentinel pattern is identical.

  Side effect: the last `adapter.db.transaction()` direct call in CLI is gone. `orphans.ts` no longer imports `migrateNodeFks` directly, no longer touches `Kysely` / `IDatabase`. The free function `migrateNodeFks` stays exported (used by `scan-persistence.ts`); Phase F drops it from `kernel/index.ts`'s public surface if no caller reaches over.

  617/617 tests pass; npm run validate exit 0. Pre-1.0 minor bump.

- 19fbc08: Storage-port promotion — Phase C (`jobs` namespace).

  - **Port**: `port.jobs.pruneTerminal(status, cutoffMs)`, `port.jobs.listTerminalCandidates(status, cutoffMs)` (the dry-run preview surface), `port.jobs.listOrphanFiles(jobsDir)`.
  - **Adapter**: `SqliteStorageAdapter.jobs` delegates to `pruneTerminalJobs` / `listOrphanJobFiles`. The dry-run candidate enumeration moves into the adapter as `listTerminalCandidates(...)` (mirrors the SELECT side of `pruneTerminalJobs` without the DELETE), so the CLI no longer hand-rolls the same query.
  - **CLI migrated**: `cli/commands/jobs.ts` — `pruneTerminalJobs(adapter.db, ...)` → `adapter.jobs.pruneTerminal(...)`; `listOrphanJobFiles(adapter.db, jobsDir)` → `adapter.jobs.listOrphanFiles(jobsDir)`; the inline `selectFrom('state_jobs')` dry-run preview collapses into `adapter.jobs.listTerminalCandidates(...)`. `pruneOrPreview` is now a one-line ternary.

  617/617 tests pass; npm run validate exit 0. Pre-1.0 minor bump.

- 19fbc08: Storage-port promotion — Phase D (`pluginConfig` namespace).

  - **Port**: `port.pluginConfig.set / get / list / delete / loadOverrideMap`. The `set` upserts a per-plugin enabled override into `config_plugins`; `loadOverrideMap` returns the full map for layering over `settings.json` defaults at scan boot.
  - **Adapter**: `SqliteStorageAdapter.pluginConfig` delegates to the existing free functions in `kernel/adapters/sqlite/plugins.ts`.
  - **CLI migrated**: `cli/commands/plugins.ts` (the `enable / disable` toggle and the override-map loader for `sm plugins doctor`); `cli/util/plugin-runtime.ts` (the same loader used by `loadPluginRuntime` to layer DB overrides at boot). Both files no longer import directly from `kernel/adapters/sqlite/plugins.js`. `deletePluginOverride` was used as a `void`-suppressed import to keep it available for a future `sm config reset`; that comment now points at `port.pluginConfig.delete` instead.

  617/617 tests pass; npm run validate exit 0. Pre-1.0 minor bump.

- 19fbc08: Storage-port promotion — Phase E (`migrations` / `pluginMigrations` namespaces) + Phase F (cleanup).

  **Phase E** ports the kernel + per-plugin migration runners through the port:

  - **Port**: `port.migrations.{discover, plan, apply, writeBackup}` and `port.pluginMigrations.{resolveDir, discover, plan, apply}`. The free functions in `kernel/adapters/sqlite/{migrations,plugin-migrations}.ts` stay as-is (synchronous, raw `DatabaseSync`-based, identical body); the namespace methods wrap them.
  - **Adapter**: a small `withRawDb(path, fn)` helper opens / closes a short-lived `DatabaseSync` per port-method call. The verb's per-method invocations are infrequent (one `discover` + zero-to-three `plan` + zero-to-one `apply` + zero-to-N `pluginMigrations.{plan,apply}`), so the open/close overhead is negligible. The adapter's Kysely connection is unused by the migrations namespace; the migrations runner has its own raw lifecycle by design.
  - **CLI migrated**: `cli/commands/db.ts:DbMigrateCommand.execute` no longer opens its own `new DatabaseSync(path)` — it builds a `SqliteStorageAdapter({ databasePath: path, autoMigrate: false })` and calls `adapter.migrations.discover() / plan() / apply()` plus `adapter.pluginMigrations.plan() / apply()`. `runPluginMigrations` takes the adapter instead of a raw db handle. The CLI no longer imports any free function from the migrations modules.

  **Phase F** finishes the cleanup:

  - The CLI surface no longer contains a single `selectFrom` / `insertInto` / `deleteFrom` / `updateTable` call against any `scan_*` / `state_*` / `config_*` table inside command files (verified via grep). The only remaining non-port `DatabaseSync` opens in CLI are the two administrative SQL paths in `db.ts` — `sm db backup` (PRAGMA wal_checkpoint + copy file) and `sm db reset` (drop tables for a clean slate). Both are intentionally raw — they do schema-management on the file rather than queries against application state.
  - `cli/commands/init.ts` migrated the residual `persistScanResult(adapter.db, ...)` to `adapter.scans.persist(result, { renameOps, extractorRuns, enrichments })`.
  - `kernel/index.ts` re-exports `ITransactionalStorage` plus the new domain types from `kernel/types/storage.ts` (`IIssueRow`, `INodeBundle`, `INodeCounts`, `INodeFilter`, `IPersistOptions`) so external consumers reach them through the canonical entry point.
  - The free functions in `kernel/adapters/sqlite/*.ts` stay exported. Tests still construct `SqliteStorageAdapter` and (post-init) call `persistScanResult(adapter.db, ...)` directly in some places; that survives the refactor — they're testing the adapter implementation, not the port. The plan's "drop the adapter free functions from `kernel/index.ts` public surface" is moot here because they were already not re-exported through `kernel/index.ts`.

  End-state: every CLI command that touches persistence does it through `port.<namespace>.<method>` or `port.transaction(tx => tx.<namespace>.<method>)`. Adding a second adapter (HTTP server, in-memory test harness) is now a matter of implementing the same `StoragePort` interface — no command surgery needed.

  617/617 tests pass; npm run validate exit 0. Pre-1.0 minor bump for E (port surface expansion); F is bundled because the cleanup is the natural conclusion of the same refactor.

### Patch Changes

- bf30b67: Update `AGENTS.md` to reflect the post-sweep lint state: every quality rule is now `'error'` (no more `'warn'` tier), and codify the six categories where `eslint-disable-next-line` is the right answer (CLI orchestrators, parsers, multi-accumulator folds, migration runners, pure column mappers, discriminated-union dispatchers). Anything outside those categories should be split, not disabled — pointers to the canonical split commits included.
- 3cc603b: Close audit items D3 (i18n discipline) and D4 (rename `extensions/`) in
  a single sweep. **Patch bump**: pure refactor + docs; zero public API
  changes, no spec change, no behaviour change. The directory rename and
  the i18n migration are both internal to the workspace.

  ## D4 — rename `src/extensions/` → `src/built-in-plugins/`

  The directory was confusingly close in name to `src/kernel/extensions/`,
  which holds the **contracts** (`IProvider`, `IExtractor`, `IAnalyzer`,
  `IFormatter`, `IHook`, …) — not implementations. Renaming the bundled
  implementations to `built-in-plugins/` makes the distinction obvious at
  import sites: "kernel/extensions = what shape; built-in-plugins = what
  code."

  - `mv src/extensions src/built-in-plugins`. Internal layout preserved
    (`built-ins.ts` + `providers/` + `extractors/` + `rules/` +
    `formatters/`).
  - Bulk update of relative imports across 31 files (`from
'../extensions/...'` → `from '../built-in-plugins/...'`, across four
    depth levels). One overshoot caught by hand:
    `kernel/adapters/schema-validators.ts` legitimately imports
    `../extensions/index.js` (the contracts, inside the kernel) — that
    site was restored.
  - `src/tsconfig.json` — `include` updated.
  - `src/package.json` — four test scripts repointed
    (`'extensions/**/*.test.ts'` → `'built-in-plugins/**/*.test.ts'`).
  - `src/cli/util/conformance-scopes.ts` — runtime path resolver and the
    user-facing error message updated to `built-in-plugins/providers/`.
  - `src/test/conformance.test.ts` and
    `src/test/conformance-disable-flags.test.ts` — hardcoded fixture
    paths updated.

  ## D3 — migrate hardcoded CLI strings to the `tx(*_TEXTS.*)` discipline

  Every `cli/commands/*.ts` file that previously emitted user-facing text
  through `this.context.std{out,err}.write('literal string')` now sources
  its strings from a sibling `cli/i18n/<verb>.texts.ts` file. Pattern:
  `tx(<VERB>_TEXTS.<key>, { vars })`.

  - New texts files (8): `show.texts.ts`, `history.texts.ts`,
    `orphans.texts.ts`, `help.texts.ts`, `stubs.texts.ts`,
    `export.texts.ts`, `jobs.texts.ts`, `config.texts.ts`.
  - Extended (2): `check.texts.ts` (+`noIssues`), `db.texts.ts` (+8 keys
    for backup, migrate, status).
  - Migrated sites: `show.ts`, `check.ts`, `history.ts`, `orphans.ts`,
    `help.ts`, `stubs.ts`, `export.ts`, `jobs.ts`, `db.ts`,
    `config.ts`. ~25 hardcoded strings replaced.
  - Pure-passthrough writes (e.g. `this.context.stderr.write(\`${warn}\n\`)`
    relaying an already-formatted plugin warning) were intentionally
    left alone — those carry no locally-authored copy.

  ## AGENTS.md — record both decisions as durable conventions

  Two new sections so future agents do not re-derive these:

  - **"Source layout: built-ins vs extension contracts"** — explains the
    `kernel/extensions/` (contracts) vs `built-in-plugins/`
    (implementations) split with the mnemonic and pointers to where to
    import what.
  - **"i18n strategy: where strings live"** — codifies the rule that CLI
    strings live in `cli/i18n/<verb>.texts.ts` and pass through `tx`.
    Documents the rationale (one greppable catalog, future-locale-ready,
    enforces "no copy-changes hidden in command logic") and the
    passthrough exemption.

  ## Net effect

  - Tests: **602/602 still green**.
  - Build: clean.
  - Lint: still silent (0 errors, 0 warnings).
  - Audit closure: D3 + D4 are the last two `cli-architect` items that
    needed Architect input; only the two big-effort items remain
    (Storage Port refactor and Open Kinds — both scoped in
    `docs/refactors/`).

- 9c5db60: Close L1 / L2 / L3 from the cli-architect review.

  - **L1 — Async FS off the per-node loop**: `cli/commands/refresh.ts` reads each target node's body inside a `for (node of targetNodes)` loop. The read is now `await readFile(...)` from `node:fs/promises` instead of `readFileSync`. The body still serializes today (extractor pass is awaited per node) but routing through `fs/promises` lets the event loop overlap any concurrent kernel work and removes a sync hop that would block on a slow disk. Bootstrap reads (config, settings, schemas, package.json, migration runners) stay sync — those are cold-path or whitelist category 4 in `AGENTS.md`.
  - **L3 — Error reporter helper**: new `cli/util/error-reporter.ts` exporting `formatErrorMessage(err: unknown): string`. Replaces 22 inline duplicates of `err instanceof Error ? err.message : String(err)` across `watch.ts`, `jobs.ts`, `conformance.ts`, `scan.ts`, `db.ts`, `init.ts`, `refresh.ts`, `config.ts`, `scan-compare.ts`. The helper deliberately stays minimal (no `--verbose` stack mode, no JSON envelope) — those grow when a concrete need surfaces.
  - **L2 — `db migrate --to` strict integer parse**: `Number.parseInt` accepted `'123abc'` as `123` and didn't reject negatives, so a typo could silently roll the migration ledger to an unexpected target. Tightened to require `String(parsed) === trimmed && parsed >= 0`; bad input now exits `2` per spec § Exit codes.

  Side effect: the `formatErrorMessage` substitution in `init.ts:runFirstScan` dropped the function below the cyclomatic threshold; removed the no-longer-needed `eslint-disable-next-line complexity`.

  What was a false positive in the original review (no work needed):

  - **L4 — `console.*` mixed with `this.context.std*`**: zero matches in `src/cli/` or `src/kernel/`. The lint rule + existing CLI discipline already enforce this.

- 369213c: Continue the complexity sweep — 5 more functions reduced or disabled with rationale:
  - `splitStatements` — char-by-char SQL state machine; justified inline disable.
  - `plugins.ts:execute` (PluginsListCommand) — extracted `renderBuiltInBundleRow` and `renderPluginRow` per-row helpers.
  - `collectApplicableKindWarnings` — extracted `appendUnknownKindWarnings`.
  - `collectKnownKinds` and `collectExplorationDirWarnings` — extracted shared `forEachProviderInstance` iterator (built-ins + user-plugin Providers in one place).
  - `accumulateExecutionRow` — justified inline disable (5-accumulator fold; per-accumulator helpers wouldn't make the algorithm clearer).
  - `validateAndStrip` — extracted `applyValidationError` per-error helper.
- e9e04c7: Continue the complexity sweep:
  - `refresh.ts:execute` and `scan-compare.ts:execute` — justified `eslint-disable-next-line complexity` with comments. The remaining cyclomatic count comes from CLI ergonomics (multiple try/catch + flag combinatorics) and the inner work already lives in extracted helpers.
  - `kernel/adapters/sqlite/history.ts:aggregateHistoryStats` (18) — extracted `accumulateExecutionRow` for the per-row folding (totals, per-failure-reason, per-action, per-period, per-node). Helper stays at 15 due to the natural multi-accumulator nature of the operation; main function now below threshold.
- aa550a6: Code-quality follow-up to commit `518180d` — final wave of the
  ongoing complexity sweep ("hasta menos de 8") plus a tightening pass
  on the ESLint config so the workspace lint is now fully strict.
  **Patch bump**: zero public API changes (every refactored function
  keeps its exported signature; no new exports); pure internal
  restructuring + dev-tooling.

  ## Why

  The previous round brought the lint baseline to 67 warnings across
  splits + justified disables. This wave closes the remaining offenders
  (splits where naming the steps adds value, disables-with-rationale on
  the orchestrators / parsers / per-row mappers where every branch is
  intrinsic to the contract), then promotes every quality rule from
  `'warn'` to `'error'` so future regressions fail CI instead of
  piling up silently. Net `-67` warnings → **lint is now silent (0
  errors, 0 warnings)**.

  ## What

  ### 1. ESLint config tightening (`src/eslint.config.js`)

  Every quality rule now fails CI instead of warning:

  - `complexity` (max 8)
  - `no-console` (allow `[warn, error, log]`)
  - `@typescript-eslint/no-empty-function`
  - `preserve-caught-error`
  - `no-useless-assignment`

  Plus three hygiene fixes that were latent in the previous config:

  - `no-irregular-whitespace` now uses `{ skipStrings, skipComments,
skipRegExps, skipTemplates }` so legitimate ZWSP / BOM literals
    inside the YAML BOM-detection regex and block-comment escaping in
    docstrings stop firing as errors.
  - `@stylistic/quotes` deprecation closed: `allowTemplateLiterals:
true` → `'always'`.
  - `**/dist/**` added to `ignores` so the workspace's nested `dist/`
    (e.g. `cli/dist/...`) gets skipped, not just the root one.

  ### 2. Render-function splits (the "honest" splits)

  - `cli/commands/init.ts` — `writeDryRunPlan` (was 11): extracted
    `dryRunFileMessage` (overwrite-vs-write phrasing per file).
  - `cli/commands/show.ts` — `renderHuman` (was 10): extracted
    `renderNodeHeader` (id + optional fields + weight + tokens) and
    `renderIssuesSection` (issues block).
  - `cli/commands/export.ts` — `renderNodesByKindSection` (was 11):
    extracted `renderNodeBullet`.
  - `cli/commands/help.ts` — `renderVerbBlock` (was 9): extracted
    `renderVerbFlags` and `renderVerbExamples`.
  - `cli/commands/plugins.ts` — `renderPluginDetail` (was 11):
    extracted `renderExtensionsList`. The remaining body keeps a
    justified `eslint-disable-next-line complexity` because the
    optional-fields-with-fallback row pattern (`?? '?'`,
    `?? '(unknown)'`) genuinely shapes the verb output; further
    extraction would be ceremony.
  - `cli/commands/scan-compare.ts` — `renderDeltaHuman` (was 14):
    extracted `renderDeltaNodes`, `renderDeltaLinks`,
    `renderDeltaIssues` per-section helpers.

  ### 3. Justified inline `complexity` disables (~25 sites)

  Each disable carries an inline comment explaining why splitting
  would scatter intent. Categorised:

  - **CLI orchestrators with multi-flag handling** (~10):
    `scan.ts:execute` (38), `refresh.ts:execute` (18),
    `init.ts:execute` (13), `db.ts` `DbReset` (21) /
    `DbMigrate` (30), `conformance.ts:execute` (13),
    `scan-compare.ts:execute` (18), `history.ts:execute` ×2
    (14, 12), `orphans.ts` undo-rename arrow (14),
    `plugins.ts` `PluginsDoctor.execute` (15) and `toggle` (11),
    `check.ts:detectProbAnalyzerIds` (9),
    `config.ts:iterDotPaths` (10),
    `list.ts:#countIssuesPerNode` (9),
    `init.ts:runFirstScan` (9),
    `help.ts:renderVerbBlock` (9),
    `history.ts:renderTable` (10),
    `show.ts:aggregateLinks` (11),
    `watch.ts:runWatchLoop` and `runOnePass` (long-running watch
    lifecycle).
  - **Parsers / state machines** (3):
    `kernel/scan/query.ts:parseExportQuery` (11),
    `kernel/adapters/sqlite/plugin-migrations-validator.ts:splitStatements`
    (19), `objectName` (10).
  - **Multi-accumulator folds** (2):
    `kernel/adapters/sqlite/history.ts:accumulateExecutionRow` (15),
    `conformance/index.ts:applyJsonPathComparator` (16).
  - **Migration runners with per-file safe-apply** (2):
    `kernel/adapters/sqlite/migrations.ts:applyMigrations` (14),
    `kernel/adapters/sqlite/plugin-migrations.ts:applyPluginMigrations`
    (14).
  - **Pure column mappers** (2):
    `kernel/adapters/sqlite/scan-persistence.ts:nodeToRow` (13),
    `linkToRow` (12) — every `??` adds one cyclomatic branch.
  - **Discriminated-union dispatchers** (~6):
    `extensions/rules/{trigger-collision,link-conflict}/index.ts:evaluate`
    (12 each),
    `extensions/rules/trigger-collision/index.ts:analyzeTriggerBucket`
    (9), `conformance/index.ts:evaluateAssertion` (12),
    `runConformanceCase` (10), `runPriorScansSetup` (12),
    `deepEqual` (11).
  - **Kernel / adapter helpers** (~5):
    `kernel/orchestrator.ts:walkAndExtract` (28),
    `runScanInternal` (11), `indexPriorSnapshot` (10),
    `computeCacheDecision` (10), `reuseCachedLink` (11),
    `buildHookContext` (10);
    `extensions/providers/claude/index.ts:walkMarkdown` (9);
    `extensions/formatters/ascii/index.ts:format` (12);
    `kernel/adapters/plugin-loader.ts:{loadOne, applyIdCollisions,
loadStorageSchemas, #loadAndValidateExtensionEntry}`;
    `kernel/adapters/sqlite/history.ts:{executionToRow, listExecutions,
findStrandedStateOrphans, migrateNodeFks}`;
    `kernel/config/loader.ts:recordSources`;
    `cli/util/plugin-runtime.ts:{composeScanExtensions, bucketLoaded}`;
    `cli/commands/plugins.ts:{collectKnownKinds,
collectApplicableKindWarnings, collectExplorationDirWarnings,
resolveToggleTarget, forEachProviderInstance}`.

  ### 4. Real fixes (not just disables)

  - `kernel/adapters/sqlite/jobs.ts:120` — `let entries: string[] = []`
    → `let entries: string[]` (initial value was dead, the catch
    returns early). Closes a `no-useless-assignment` finding for real.
  - `kernel/adapters/sqlite/migrations.ts:200` and
    `kernel/adapters/sqlite/plugin-migrations.ts:243` — re-thrown
    errors now carry `{ cause: err }`, satisfying
    `preserve-caught-error` and giving better stack traces on
    migration failure.
  - `cli/commands/scan-compare.ts:197,204` — same `{ cause: err }`
    fix on dump-load and JSON-parse errors.

  ### 5. `silent-logger.ts` — file-level disable for the no-op contract

  Added `/* eslint-disable @typescript-eslint/no-empty-function */`
  at the top of `kernel/adapters/silent-logger.ts`. The whole point
  of `SilentLogger` is that every method is empty; adding an
  inline disable to each of the 5 methods would be noise.

  Same justified inline disable on the `dispatch: async () => {}`
  no-op fast path in `kernel/orchestrator.ts:makeHookDispatcher`.

  ## Net effect

  - Lint baseline before this wave (commit `518180d`): 67 warnings.
  - After this commit: **0 errors, 0 warnings — lint is silent.**
  - Tests: **602 / 602** still green.
  - Build: clean.
  - Every quality rule is now `'error'`, so the next regression
    fails CI instead of accumulating quietly.

- 66ea293: Extract `buildFreshNodeAndValidateFrontmatter` from `walkAndExtract` (orchestrator). Internal-only refactor — moves the `else` branch (no cache hit: build a fresh `Node` and run frontmatter validation) into a focused helper. `walkAndExtract` complexity drops from 35 to 33. No public API change; behaviour preserved.
- a785a16: Three follow-up tests for the open-node-kinds refactor — close gaps the Phase E smoke test left implicit.

  - `external-provider-kind.test.ts` gains two cases: (a) a Provider declares `cursorRule` with a strict per-kind frontmatter schema → the kernel emits `frontmatter-invalid` for any node whose frontmatter does not match, exactly as it does for the built-in claude catalog; (b) a misbehaving Provider whose `classify(...)` returns a kind absent from its `kinds` map → the kernel reports the mismatch via `frontmatter-invalid` with `data.errors === 'no-schema'` instead of crashing.
  - `scan-readers.test.ts` (`sm list --kind <external>`) — pins that the verb's `WHERE kind = ?` filter accepts external-Provider kinds end-to-end. Plants a `kind: 'cursorRule'` row alongside the claude fixtures and asserts the listing surfaces only it under `--kind cursorRule`. Catches a regression where someone retypes the column to `NodeKind` and quietly drops external rows.
  - `node-enrichments.test.ts` (`sm refresh` Test (f.5)) — pins that `sm refresh <external-kind-path>` exits 0 without rejecting the kind. Built-in extractors don't declare `applicableKinds: ['cursorRule']`, so the applicable set is empty and refresh persists zero det enrichments — but it MUST get there without a cast failure or filter rejection.

  These tests add 0 production code and 3 cases to the suite. 617 tests pass; npm run validate exit 0.

- b3debbe: Phase E of the open-node-kinds refactor — end-to-end smoke verification baked into the test suite.

  Adds `test/external-provider-kind.test.ts`: a fake "Cursor" Provider classifies `.cursor/rules/*.md` into `kind: 'cursorRule'` (a string the built-in Claude Provider does NOT know), and the test runs the full pipeline:

  1. `runScanWithRenames` — orchestrator persists the open kind through `IProvider.classify(...) → string`.
  2. `persistScanResult` — SQLite adapter writes the row; the dropped `ck_scan_nodes_kind` CHECK no longer rejects.
  3. `loadScanResult` — `rowToNode` returns the open string (no `as NodeKind` cast).
  4. `applyExportQuery({ kinds: ['cursorRule'] })` — the export query parser accepts the arbitrary kind and filters the snapshot down to the two seeded rows.

  If any layer regresses to the closed-enum behaviour (a stray cast, a forgotten CHECK, a renamed column missed by the migration), the test fails before the regression reaches a release.

  Audit findings:

  - `validate-all` rule's `FRONTMATTER_BY_KIND: Record<NodeKind, …>` map is decorative today (suppressed via `void` to keep the wire ready for when the schema-validators loader exposes per-kind frontmatter validators). It does NOT close the kind set at runtime — the rule validates every node against the `node` schema (which is open post-Phase A). External-Provider kinds pass through unaffected.
  - No built-in rule does `switch (node.kind) { case 'skill': ...; default: never }`. The trigger-collision rule's `ADVERTISING_KINDS` is a `Set<string>` that simply doesn't fire for kinds outside it — exactly the right behaviour.

  What's done across the whole refactor (Phases A → E):

  - Spec (`@skill-map/spec`, minor): JSON Schema + db-schema.md prose + action.schema.json all carry an open string for `kind`.
  - TS (`@skill-map/cli`, minor): `Node.kind: string`, `IProvider.classify(...): string`, `TNodeKind = string`. `NodeKind` survives as the Claude Provider catalog alias with a clarifying docstring.
  - SQL (`@skill-map/cli`, minor): the closed-kind `CHECK in (...)` constraints are removed from `001_initial.sql` directly (pre-1.0 fold; mirrors how `002_scan_meta` was folded back). Fresh DBs apply the open `kind` column from the first migration; no separate `003_open_node_kinds.sql` is needed.
  - Tests: 613 pass; the new `external-provider-kind.test.ts` is the cross-layer guard.

- 518180d: Code-quality follow-up to commit `369213c` — eighth batch of the
  ongoing complexity sweep ("hasta menos de 8"). Eight functions
  addressed: two splits into focused private helpers, six justified
  inline disables on CLI orchestrators / safe-apply loops where the
  cyclomatic count is intrinsic to the contract. **Patch bump**: zero
  public API changes (every refactored function keeps its exported
  signature; no new exports); pure internal restructuring.

  ## Why

  The previous round closed `splitStatements`, `plugins`, `history` and
  `config` and brought the lint baseline from 84 -> 75. This batch
  continues the same playbook: split where naming the steps adds value,
  disable-with-rationale where every branch is one flag in a multi-flag
  verb and splitting would scatter intent. Net `-8` warnings in one
  commit and four functions dropped fully below the threshold.

  ## What

  ### Splits (extracted helpers)

  #### `src/cli/commands/plugins.ts` — `PluginsShowCommand.execute` (21 -> <8)

  Two private helpers, one per detail-rendering branch:

  - `renderBuiltInDetail(builtIn)` — header + extensions list for a
    built-in bundle row.
  - `renderPluginDetail(match)` — header + manifest fields + extensions
    list for a discovered user plugin.

  `execute` is now a thin orchestrator: load the registry, resolve
  `builtIn` vs `match`, pick the renderer, emit. The two renderers
  mirror each other in shape (both return `string[]`) so the
  `builtIn ? renderBuiltInDetail(builtIn) : renderPluginDetail(match!)`
  ternary at the call site reads as a table of contents.

  #### `src/cli/commands/show.ts` — `renderHuman` (14 -> 10)

  One private helper, parametrised over direction:

  - `renderLinksSection(label, links, projectField, arrow)` — the
    `(N total, M unique)` header, `(none)` placeholder, and grouped
    per-link lines. Used for both "Links out" (project on `target`,
    arrow `->`) and "Links in" (project on `source`, arrow `<-`).

  `renderHuman` now spreads the helper twice instead of inlining two
  near-identical 8-line blocks. Aggregation behaviour and JSON output
  are unchanged.

  ### Justified inline complexity disables

  Each of these is a CLI orchestrator or per-file safe-apply transaction
  where the cyclomatic count is intrinsic to multi-flag handling,
  multi-accumulator folds, or per-file rollback semantics. Splitting per
  branch would distance the validations / guards from the state they
  shape. Each disable carries a comment explaining the call-site
  contract.

  - `src/cli/commands/db.ts` — `DbResetCommand.execute` (21) and
    `DbMigrateCommand.execute` (30). Multi-flag verbs: `--state` vs
    `--hard` mutex, `--dry-run`, `--yes`, `--kernel-only`,
    `--plugin <id>`, `--status`, `--to`. The early-return chain is the
    clearest expression of the flag semantics.
  - `src/cli/commands/history.ts` — `HistoryCommand.execute` (14). Many
    optional filter flags (`--node`, `--action`, `--status`, `--since`,
    `--until`, `--limit`, `--json`, `--quiet`); each branch is
    single-purpose and tightly coupled to the filter it shapes.
  - `src/cli/commands/orphans.ts` — undo-rename arrow function (14).
    Destructive verb with per-`analyzerId` validation chain
    (`auto-rename-medium` vs `auto-rename-ambiguous`) before the FK
    migration runs in a transaction.
  - `src/cli/commands/scan-compare.ts` — `renderDeltaHuman` (14). Three
    parallel sections (nodes / links / issues), each with
    added/removed/changed loops; per-section format differs slightly so
    a single helper would need a per-section adapter that hides the
    parallel structure.
  - `src/kernel/adapters/sqlite/migrations.ts` — `applyMigrations` (14).
    Per-file transactional safe-apply with backup + dry-run guards;
    rollback semantics live at the loop level.
  - `src/kernel/adapters/sqlite/plugin-migrations.ts` —
    `applyPluginMigrations` (14). Same shape as `applyMigrations` plus
    plugin-id ledger scoping.

  ## Net effect on lint

  - Previous baseline (commit `369213c`): 75 warnings.
  - After this commit: **67 warnings** (-8 net).
  - Four functions dropped fully below threshold via splits or disables;
    zero new warnings introduced.
  - 602 / 602 tests still green.

- 5ca7c36: Continue the complexity-reduction sweep — six more high-complexity
  functions split into focused helpers in a single batch. **Patch bump**:
  zero public API changes (no exported signatures touched, no new
  exports), pure internal restructuring; 602 / 602 tests still green
  after each split individually and after the batch.

  ## Why

  Follows the chain `91fea6a` → `efa8972` → `66ea293` → `6d031d8` →
  `4fbb23c` → `11c4382`, per the standing request to push every
  function below the lint complexity threshold of 8. This batch picks
  off the next six offenders across kernel, CLI commands, an extension
  rule, and the plugin-runtime helper layer. The chain is deliberately
  small per commit so each split is reviewable in isolation and the
  "behavior identical" claim is easy to verify.

  ## What

  ### `src/kernel/orchestrator.ts` — finish the `walkAndExtract` split (audit V4 follow-up)

  Refactored `reusePriorNode` to share its body via a new
  `cloneNodeAndReshapeLinks` helper. Both the full-cache-hit branch
  (still inside `reusePriorNode`) and the partial-cache-hit branch (now
  delegates to `cloneNodeAndReshapeLinks` directly) share one code path
  for the clone + link reshape + frontmatter issue re-emit.
  `reusePriorNode` adds the `extractorRuns` records on top.

  Effect: `walkAndExtract` 33 → 28; `cloneNodeAndReshapeLinks` and the
  trimmed `reusePriorNode` both sit below threshold.

  ### `src/cli/commands/refresh.ts` — split `execute` (30 → <8)

  Two private methods on `RefreshCommand`:

  - `#resolveTargetNodes` — handles the `--stale` vs `<nodePath>`
    decision, returns `{ ok: true, nodes } | { ok: false, exitCode }`.
  - `#runDetExtractorsAcrossNodes` — reads node bodies off disk, runs
    every applicable deterministic extractor per node, counts
    probabilistic skips.

  Added `ScanResult` to the kernel imports for the typed parameter.

  ### `src/cli/commands/init.ts` — split `execute` (25 → <8)

  The `--dry-run` branch was 60+ lines with many `existsSync()`
  conditionals plus a 3-way `.gitignore` plural / singular / unchanged
  switch. Two free helpers now: `writeDryRunPlan` writes the full plan
  to stdout; `writeDryRunGitignorePlan` is a sub-helper for the
  `.gitignore` preview phrasing. New `writeDryRunPlan` sits at 11 — the
  conditional density is intrinsic to the dry-run preview, further
  splitting would dilute clarity.

  ### `src/cli/commands/help.ts` — extract `renderVerbBlock` (19 → <8)

  The per-verb body of the markdown renderer (heading, description,
  details, flags table, examples block) was inlined inside two nested
  `for` loops. Pulled out as `renderVerbBlock(verb): string[]`. New
  helper at 9.

  ### `src/extensions/rules/trigger-collision/index.ts` — extract `analyzeTriggerBucket` (19 → <8)

  The per-bucket ambiguity analysis (advertisers / invocations /
  canonical comparison plus the issue construction) was an 80-line `for`
  body. Pulled into a free function returning `Issue | null`. New helper
  at 9.

  ### `src/cli/util/plugin-runtime.ts` — extract `accumulateBuiltInScanExtensions` (16 → 9)

  The bucketing of built-in extensions by kind (`switch` over
  `provider` / `extractor` / `rule` / `hook` inside nested `for`s) moved
  into a private helper. Caller passes the buckets object as a
  parameter; the helper mutates them in place. The remaining 9 in
  `composeScanExtensions` is the env-flag layer that follows, which
  still adds branches.

  ## Net effect on lint

  - Previous baseline (after `11c4382`): 81 warnings.
  - After this commit: **81 warnings** (no net change — each removed
    monster is replaced by 1 marginal helper at 9-11).
  - However, **6 functions dropped below threshold**: `refresh.ts:execute`,
    `init.ts:execute`, `help.ts:renderMarkdown`,
    `trigger-collision:evaluate`; plus `walkAndExtract` and
    `composeScanExtensions` reduced significantly.
  - Tests: 602 / 602 green; `npm run build -w src` green;
    `npm run lint -w src` green (0 errors).

  ## Out of scope

  The remaining ~24 warnings are mostly small (10-14 cyclomatic) and
  will be tackled in subsequent commits, same one-batch-per-session
  cadence.

- efa8972: Code-quality follow-up to commit `91fea6a` — split the next three
  high-complexity offenders into focused private helpers. **Patch bump**:
  zero public API changes (every refactored function keeps its exported
  signature; no new exports); pure internal restructuring.

  ## Why

  The previous round closed `walkAndExtract` (47 -> 35) but left three
  "monster" call sites that the lint pass kept flagging week after week.
  Three sequential algorithm steps stuffed into one body each is the
  shape that makes the lint warning pile feel permanent — once the steps
  are named, the warning disappears and the next reader gets a free
  table of contents.

  ## What

  ### `src/kernel/orchestrator.ts` — `detectRenamesAndOrphans` (24 -> <8)

  Five private helpers, one per step of the spec'd pipeline:

  - `findHighConfidenceRenames(opts)` — step 1, body-hash match.
  - `buildFrontmatterRenameCandidates(opts)` — step 2, bucket newPaths
    by `frontmatterHash`.
  - `claimSingletonRenames(opts)` — step 3a, medium-confidence
    singletons.
  - `flagAmbiguousRenames(opts)` — step 3b, multi-candidate ambiguity.
  - `flagOrphans(opts)` — step 4, unclaimed deletions.

  `detectRenamesAndOrphans` itself is now a 15-line orchestrator that
  threads the shared `claimedDeleted` / `claimedNew` / `issues`
  collections through the helpers in order. Every helper sits below the
  complexity threshold (no new lint warnings introduced). The mutation
  contract — helpers update the supplied sets in place — is documented
  on each JSDoc.

  ### `src/kernel/adapters/sqlite/scan-persistence.ts` — `persistScanResult` (23 -> <8)

  The async transaction callback was 180+ lines doing four distinct
  things. Three new private helpers, all taking the live `Transaction`
  plus the slice of state they own:

  - `replaceAllScanZone(trx, result, scannedAt, extractorRuns)` —
    the replace-all on `scan_*` tables + `scan_extractor_runs`.
  - `upsertEnrichmentLayer(trx, result, renameOps, enrichments)` —
    A.8 enrichment steps 1+2+3 (rename migration + drop disappeared +
    upsert fresh).
  - `flagStaleProbabilisticEnrichments(trx, result, enrichments)` —
    A.8 enrichment step 4 (mark stale prob rows).

  The transaction body is now ~10 lines orchestrating: rename FK
  migration, stranded-orphan detection (still inline because it's small
  and tightly coupled to `result.issues` / `result.stats` mutation),
  then the three helpers. Added `Transaction<IDatabase>` import from
  `kysely` to type the helper parameters.

  ### `src/kernel/adapters/sqlite/scan-persistence.ts` — `nodeToRow` / `linkToRow` justified disables

  These are pure column-by-column mappings: every `??` adds one to
  cyclomatic count, but there are zero branches. Splitting would be
  ceremony for a function with one purpose. Added
  `// eslint-disable-next-line complexity` with a comment on each
  explaining the justification.

  ### `src/kernel/scan/query.ts` — `parseExportQuery` (15 -> 11)

  Two private helpers extracted for the validators that contained the
  inner loops (the switch over `key` had inline `for (v of values)`
  with throw-on-invalid):

  - `parseKindValues(values)` — validates kind tokens, returns
    `NodeKind[]`.
  - `parseHasValues(values)` — validates has tokens, returns boolean
    (true iff `issues` is present).

  `parseExportQuery` still sits at 11 — just above the threshold of 8.
  Further splitting would dilute clarity (the remaining body is the
  clause loop itself plus the unknown-key default), so the residual
  warning is acceptable for now.

  ## Net effect on lint

  - Previous baseline (commit `91fea6a`): 84 warnings.
  - After this commit: **80 warnings** (-4 net).
  - Three "monster" complexity sites eliminated (24, 23 -> <8). One
    reduced (15 -> 11). Two justified disables (13 and 12, pure
    mappings).
  - Zero new warnings introduced — every extracted helper is below
    threshold.
  - 602 / 602 tests still green.

  ## Out of scope

  Three high-complexity sites remain and are intentionally left for
  their own dedicated session, because each carries enough behavioural
  risk that a focused testing pass before the split is the right
  approach:

  - `scan.ts:execute()` (complexity 38, 338 lines) — the main scan
    command; regressions would break the most-used CLI verb.
  - `loadOne` in `plugin-loader.ts` (complexity 31) — flagged by the
    audit; same reasoning.
  - `walkAndExtract` (still at 35 from earlier) — more splits possible
    (the partialCacheHit / buildNode branches), but this commit focuses
    on net-new wins.

- 33cfea4: Close audit item SD4 — clean ROADMAP "Step N / Phase N" references from kernel docstrings. 78 refs eliminated or reworded; 22 algorithm-internal "Step N" / "Phase N" comments preserved (they describe numbered steps inside an algorithm, not roadmap milestones — `trigger-normalize.ts`, `scan-persistence.ts:upsertEnrichmentLayer`, `plugin-loader.ts:loadOne`, `orchestrator.ts:detectRenamesAndOrphans` and friends). Updated one assertion in `hook-extension.test.ts` so the test no longer pins the literal string "Step 10" in the deferral message.
- 4fbb23c: Split `evaluateJsonPath` (complexity 25) and `runConformanceCase` (complexity 20) in `src/conformance/index.ts`. Internal-only refactor — no public API change. Extracted helpers: `traverseJsonPath` (pure walker over a parsed segment list), `applyJsonPathComparator` (justified inline disable for the 4-comparator chain), `runPriorScansSetup` (the priorScans replay loop). Both monsters drop below or just above the threshold; no test regressions.
- 11c4382: Split `renderMarkdown` (complexity 19) in `src/cli/commands/export.ts`. Extracted `countIssuesPerNode` (issue index helper) and `renderNodesByKindSection` (the per-kind nodes block with grouping + sorting + rendering). `renderMarkdown` itself drops below the threshold; the extracted section helper sits at 11 (parallel branches over `KIND_ORDER`, manageable). Pure refactor, no public API change.
- 6d031d8: Code-quality follow-up to commit `66ea293` — split the audit's other
  big offender, `loadOne` in `src/kernel/adapters/plugin-loader.ts`
  (310 lines, complexity 31), into focused private helpers. **Patch
  bump**: zero public API changes (the `PluginLoader` class still
  exposes the same `loadOne(pluginPath): Promise<IDiscoveredPlugin>`
  signature; new helpers are `#`-prefixed truly-private methods plus
  one private free function); pure internal restructuring.

  ## Why

  `loadOne` was the last "monster" call site flagged by the pre-1.0
  audit and explicitly deferred in `refactor-complexity-splits-followup`
  as needing a dedicated session. Three sequential phases (manifest
  parse + validation, per-extension import + kind validation, storage
  schema compile) stuffed into one body, with the per-extension loop
  itself doing six sub-checks plus a 30-line hook-trigger validation
  block inline. Once each phase is named, the warning disappears and
  the next reader gets a free table of contents.

  ## What

  Three extractions, all in `src/kernel/adapters/plugin-loader.ts`:

  - `#parseAndValidateManifest(pluginPath)` (private method, ~75 lines)
    — phase 1: read `plugin.json`, AJV-validate the manifest shape,
    enforce the directory-name == manifest.id structural rule, validate
    specCompat (range syntax + satisfies installed spec version).
    Returns either the validated manifest or an `IDiscoveredPlugin`
    with the appropriate failure status (`invalid-manifest` /
    `incompatible-spec`).
  - `#loadAndValidateExtensionEntry(pluginPath, manifest, relEntry)`
    (private async method, ~100 lines) — phase 3 inner loop body: 6
    sub-checks per extension entry (file exists, dynamic import with
    timeout, has-kind, kind-is-known, pluginId match, kind-specific
    manifest validation including hook trigger pre-check), with the
    `pluginId` injection and shallow-clone of the runtime instance.
  - `validateHookTriggers(...)` (private free function) — extracted
    because the hook-specific trigger validation was a 30-line block
    inside the extension loop body that was hurting both readability
    and complexity.

  Both methods/functions return discriminated unions
  (`{ ok: true; ... } | { ok: false; failure: IDiscoveredPlugin }`) so
  the caller (`loadOne`) stays a thin orchestrator: ~30 lines of
  "manifest -> enabled check -> loop entries -> storage schemas ->
  success result".

  ## Net effect on lint

  - Previous baseline (after `66ea293`): 80 warnings.
  - After this commit: **81 warnings** (+1 net).
  - `loadOne` itself: **31 -> 10** (-21 — massive drop, just barely
    above the threshold of 8).
  - `#loadAndValidateExtensionEntry` new helper at **13** (the new
    warning, but contained — much easier to reason about than the
    original monolith).
  - `#parseAndValidateManifest` and `validateHookTriggers` both <8
    (no warnings).
  - 602 / 602 tests still green.

  The +1 net is misleading — the architectural improvement is the
  central method dropping from 31 to 10. The helper at 13 is the next
  splitting target if anyone wants to keep going.

- Updated dependencies [f8a7125]
  - @skill-map/spec@0.10.0

## 0.7.0

### Minor Changes

- 88afe24: Cleanup pass post-v0.8.0 — finishing the renames and wiring the
  conformance kill-switches.

  **Pre-1.0 minor bump** per `spec/versioning.md` § Pre-1.0. The schema
  field rename below is technically breaking, but ships as a minor while
  the spec stays `0.Y.Z`.

  ## Spec changes (`@skill-map/spec`)

  ### Breaking — `conformance-case.schema.json`

  - **Rename `setup.disableAllDetectors` → `setup.disableAllExtractors`.**
    Finishes the kind rename Detector → Extractor introduced in 0.8.0
    (Phase 2 of the plug-in model overhaul). The previous name was the
    last residue and it never reached a release where anything consumed
    it.
  - **`setup.disableAll{Providers,Extractors,Rules}` are now consumed
    end-to-end.** Until this release the three toggles were declared in
    the schema and accepted by the runner, but the runner never threaded
    them anywhere — the `kernel-empty-boot` case happened to pass
    because its fixture is empty. The runner now injects
    `SKILL_MAP_DISABLE_ALL_{PROVIDERS,EXTRACTORS,RULES}=1` into the
    child process environment when the matching toggle is `true`, and
    the CLI's scan composer drops every extension of the disabled kind
    from the in-scan pipeline regardless of granularity gates and
    `--no-built-ins`. Each toggle now has a docstring on the schema
    property pointing at the env-var convention.
  - `kernel-empty-boot` case updated for the rename.
  - `conformance/README.md` example updated.

  ### Non-breaking — copy fixes

  - Comments and docstrings across `architecture.md` and friends already
    refer to "Extractor" everywhere; only the schema field stayed on the
    old name. No prose changes in this bump.

  ## CLI changes (`@skill-map/cli`)

  ### Breaking — `IDiscoveredPlugin.status` enum

  - **Rename `'loaded'` → `'enabled'`.** The schema enum
    (`plugins-registry.schema.json`) already used `enabled` since 0.8.0;
    the runtime drifted to `loaded` and has now been pulled back so the
    runtime status matches the spec contract. `'disabled'`, the
    semantic pair, was already aligned. Every consumer (`sm plugins
list`, `sm plugins doctor`, `sm db prune` plugin filter, runtime
    plugin composer) updated. No published consumers exist.

  ### Non-breaking — sweep cleanup

  - Old `Detector` / `detector` references (kind name, manifest field
    names, JSDoc, comments, test fixture filenames, test variable
    names) replaced with `Extractor` / `extractor` across the
    production code and test suite. Excludes historical CHANGELOG
    entries, explicit migration notes ("Renamed from Detector"), and
    test data strings whose semantics are independent of the kind
    name (e.g. `'@FooDetector'` in trigger normalization tests).
  - A residual reference to "an audit reading `ScanResult.issues`" in
    `validate-all`'s docstring rewritten without the removed kind name.

  ## Tests

  - `plugin-runtime-branches.test.ts` — five new unit tests covering
    the env-var kill-switch in `composeScanExtensions` (per kind, all
    three together, and stray-value resilience).
  - `conformance-disable-flags.test.ts` — four new e2e tests pointing
    the runner at a populated fixture with each toggle in turn (and a
    baseline) so a regression in the env-var pipeline shows up
    structurally rather than relying on the empty-fixture coincidence.

### Patch Changes

- Updated dependencies [88afe24]
  - @skill-map/spec@0.9.0

## 0.6.0

### Minor Changes

- 6dad772: v0.8.0 — Pre-1.0 stabilization pass.

  This release combines two coherent pre-1.0 cleanup pieces that
  both push the project closer to v1.0 stability: the cli-architect
  audit review pass and the plugin model overhaul.

  Pre-1.0 minor bumps per `versioning.md` § Pre-1.0; breaking
  changes allowed within minor while in `0.Y.Z`. No real downstream
  ecosystem exists yet, so the breaking surface costs nothing
  today.

  ## Part 1 — Pre-1.0 audit review pass

  Pre-1.0 review pass — `cli-architect` audit findings.

  Internal audit run by the `cli-architect` agent in REVIEW mode
  produced a Critical / High / Medium / Low / Nit catalog. This
  pass bundles the implementation of every actionable finding into
  one unit so the review can be read end-to-end. **Pre-1.0 minor
  bump**: a few breaking surface changes ride along (CLI sub-verb
  split, exit-code enum exposed, plugin loader option). No
  published downstream consumers exist yet.

  ### Spec changes (`@skill-map/spec`)

  - **`cli-contract.md`** — `sm scan compare-with <dump> [roots...]`
    is now a sub-verb instead of a `--compare-with <path>` flag on
    `sm scan`. Read-only delta report against a saved `ScanResult`
    JSON dump. Read-only — does not modify the DB. Same exit codes
    (`0` empty delta / `1` drift / `2` operational error). Old flag
    form removed.
  - **`cli-contract.md`** — exit-code `2` "Operational error" row
    clarified to mention environment / runtime mismatches (wrong
    Node version, missing native dependency) explicitly. The
    "unhandled exception" catch-all already covered the case; this
    just removes ambiguity for future implementers.
  - **`cli-contract.md`** — new normative section **§Dry-run**
    between §Exit codes and §Verb catalog defining the contract for
    any verb exposing `-n` / `--dry-run`: no observable side effects
    (DB / FS / config / network / spawns), no auto-provisioning of
    scope directories, output mirrors the live mode with explicit
    "would …" framing, exit codes mirror the live mode, dry-run
    MUST short-circuit `--yes` / `--force` confirmation prompts.
    Per-verb opt-in: the flag is not global, verbs that don't
    declare it MUST reject it as an unknown option. Verb catalog
    rows for `sm init`, `sm db reset` (default + `--state` +
    `--hard`), and `sm db restore` amended to declare and describe
    their `--dry-run` previews.

  ### CLI changes (`@skill-map/cli`)

  #### Critical — kernel & adapter hygiene

  - **C1 — `runScanInternal` decomposed.** The 290-line monolith in
    `kernel/orchestrator.ts` split into a thin composer + four pure
    functions: `validateRoots`, `indexPriorSnapshot`,
    `walkAndDetect`, `runRules`. Composer is now 89 lines reading
    top-to-bottom through the pipeline phases. Zero behavioural
    change.
  - **C2 — `withSqlite(options, fn)` helper.** Single utility at
    `cli/util/with-sqlite.ts` standardises the open / use / close
    idiom every read-side command was open-coding. Eliminates four
    classes of boilerplate bugs (forgotten close, `autoBackup`
    drift, double-close, missing `try/finally`). Migrated 20 call
    sites across `check`, `export`, `graph`, `history`, `init`,
    `jobs`, `list`, `orphans`, `plugins`, `scan`, `show`, `watch`,
    plus `cli/util/plugin-runtime.ts`. Companion `tryWithSqlite`
    short-circuits when the DB file does not exist, replacing the
    `if (existsSync) { withSqlite(...) }` chain. In `scan.ts` the
    read-prior + persist double-open consolidated into a single
    `withSqlite` callback that brackets read prior → run scan →
    guard → persist when `willPersist`. Saves one migration
    discovery pass + one WAL setup per normal scan (~50–100ms).

  #### High — UX & contract integrity

  - **H3 — `--dry-run` semantics unified across `init` / `db reset`
    / `db restore`.** The new spec §Dry-run codifies the "no
    writes, reads OK" contract; three verbs that did not previously
    expose a preview now do: - `sm init --dry-run` — previews the would-create lines for
    `.skill-map/`, `settings.json`, `settings.local.json`,
    `.skill-mapignore`, the `.gitignore` entries that would be
    appended (deduped against the existing file), the DB
    provisioning, and the first-scan trigger. Honours `--force`
    for the would-overwrite preview. Re-init over an existing
    scope without `--force` still exits 2 (same gate as live). - `sm db reset --dry-run` (default + `--state`) — opens the DB
    read-only, computes the row count per `scan_*` (and `state_*`
    when `--state`) table, and prints them. No `DELETE`
    statements issued. Bypasses the `--state` confirmation prompt
    entirely. - `sm db reset --hard --dry-run` — reports the DB file path and
    size that would be unlinked; missing-file case prints a clear
    no-op line instead of an error. - `sm db restore <src> --dry-run` — validates the source exists
    (still exits 5 if missing), reports the source size and
    whether the target would be created or overwritten, plus the
    WAL / SHM sidecars that would be dropped. Bypasses the
    confirmation prompt.
    Implementation: new helper `previewGitignoreEntries(scopeRoot,
entries)` in `init.ts` mirrors `ensureGitignoreEntries` parsing
    so the preview tracks the live outcome exactly. Texts moved
    into `cli/i18n/init.texts.ts` and `cli/i18n/db.texts.ts` per
    the N4 pattern. **9 new tests** under `init-cli.test.ts` (5
    cases) and `db-cli.test.ts` (9 cases) cover the previews + the
    spec invariants ("DB file checksum unchanged after dry-run",
    "scope directory absent after dry-run", "source-not-found
    still exits 5", "confirmation prompt skipped under dry-run").
  - **H1 — Centralised exit codes.** New `cli/util/exit-codes.ts`
    exporting `ExitCode` (`Ok` / `Issues` / `Error` / `Duplicate` /
    `NonceMismatch` / `NotFound`) and the type alias `TExitCode`.
    Every `Command#execute()` migrated from numeric literals (123
    sites across 17 files) to the enum. Single source of truth
    aligned with `spec/cli-contract.md` §Exit codes. **Bug fix
    surfaced en passant:** `sm job prune` returned `2` for "DB
    missing" while every other read-side verb returned `5` via
    `assertDbExists`; corrected to use the shared helper and return
    `NotFound`. Companion test updated to expect `5`.
  - **H2 — Plugin loader timeout.** `IPluginLoaderOptions.loadTimeoutMs`
    (default `5000`, exported as `DEFAULT_PLUGIN_IMPORT_TIMEOUT_MS`).
    Each dynamic `import()` now races against a timer; on timeout
    the plugin is reported as `load-error` with a message naming
    the elapsed budget and pointing at top-level side effects as
    the likely cause (network call, infinite loop, large blocking
    work). Without this a plugin with a hanging top-level `await`
    blocks every host CLI command indefinitely.
  - **H4 — `--strict` self-validates `--json` output.** When
    `sm scan --strict --json` is invoked, the produced `ScanResult`
    is validated against `scan-result.schema.json` before stdout.
    Catches the case where a custom detector emits a Link that
    passes the shallow `validateLink` guard but fails the full
    schema, which would silently land in stdout and break a
    downstream `sm scan compare-with -`.
  - **H5 — External-link discrimination uses URL-shape regex.**
    `isExternalUrlLink` was string-matching `http://` / `https://`
    only; any other URL scheme (`mailto:`, `data:`, `file:///`,
    `ftp://`) was silently classified as internal and polluted the
    graph as a fake internal link with `byPath` lookups that always
    missed. Replaced with the RFC 3986 scheme regex
    (`/^[a-z][a-z0-9+\-.]+:/i`), guarding against Windows-style
    absolute paths via the ≥ 2-char scheme constraint.
  - **H6 — Prior snapshot validated under `--strict`.** Both
    `sm scan` and `sm watch`, when run with `--strict`, validate
    the DB-resident `ScanResult` against the spec schema before
    handing it to the orchestrator. A DB corrupted manually or
    mid-rollback used to slip nodes with malformed `bodyHash` /
    `frontmatterHash` into the rename heuristic, where the
    dereference would silently produce spurious matches.

  #### Medium — surface & extensibility

  - **M1 — `sm scan compare-with` sub-verb.** New
    `ScanCompareCommand` in `cli/commands/scan-compare.ts`; the
    `--compare-with` flag is removed from `ScanCommand`. The
    sub-verb form structurally rejects flag combos that used to
    require runtime guards (`--changed`, `--no-built-ins`,
    `--allow-empty`, `--watch`): Clipanion rejects them at parse
    time as unknown options.
  - **M2 — `kernel/index.ts` enumerated exports.** Replaced the two
    `export type *` wildcards (from `./types.js` and
    `./ports/index.js`) with explicit named exports. Same set of
    public types — the DTS size and tests confirm parity. Going
    forward, any new domain type or port change requires an
    explicit edit to the barrel, preventing silent surface drift.
  - **M3 — Build hack documented (workaround retained).** Tried to
    replace the post-build `restoreNodeSqliteImports` pass with
    `external: ['node:sqlite']` in `tsup.config.ts`. Esbuild marks
    the specifier as external but still strips the `node:` prefix;
    same outcome with `[/^node:/]` regex and `packages: 'external'`
    (which also externalises real npm deps). Reverted to the
    post-build `replaceAll` pass, with a docstring documenting
    every workaround attempted so the next agent does not repeat
    the spike.
  - **M4 — `tryWithSqlite` helper.** See C2.
  - **M5 — `CamelCasePlugin` trap documented.** Added a
    trap-warning block to `SqliteStorageAdapter`'s docstring:
    `sql.raw` / `sql\`...\``template literals do NOT pass through
the`CamelCasePlugin`; raw SQL fragments must use snake_case to
    match the migrations.
  - **M6 — Per-extension error reporting.** When the orchestrator
    drops a link emitted with an undeclared kind or an issue with
    an invalid severity, it now emits a `type: 'extension.error'`
    `ProgressEvent` instead of silently swallowing. The CLI
    subscribes via the new `createCliProgressEmitter(stderr)`
    helper and renders those events as `extension.error: <message>`
    on stderr. Plugin authors finally see WHY their link / issue
    disappears from the result. Wired in `scan` (normal +
    compare-with), `watch`, and `init`.
  - **M7 — Type naming convention documented (no rename).** Top-of-
    file docstring in `kernel/types.ts` and a new section in
    `AGENTS.md` describe the four-bucket convention the codebase
    has always implicitly followed: domain types (no prefix,
    mirrors spec schemas), hexagonal ports (`Port` suffix), runtime
    extension contracts (`I` prefix), internal shapes (`I`
    prefix). Mass rename was rejected after a cost-benefit pass —
    naming changes are cheap to write but expensive to review;
    existing names are mostly coherent. The agent base
    (`_plugins/minions/shared/architect.md`) gained a "Naming
    conventions check" sub-section in REVIEW mode so future audits
    reach the same conclusion.

  #### Low / nit — cleanup

  - **L1 — `omitModule` JSON replacer precision.** Identifies the
    ESM namespace by `[Symbol.toStringTag] === 'Module'` instead of
    matching every `module` key blindly. A plugin manifest that
    legitimately ships an unrelated `module` field (e.g. a string
    property in `metadata`) is no longer silently dropped from
    `sm plugins list --json` output.
  - **L2 — Stub verbs flagged in `--help`.** Every
    `not-yet-implemented` verb in `cli/commands/stubs.ts` carries a
    `(planned)` suffix on its `description`, surfaced in
    `sm --help`. The `notImplemented` helper now writes
    `<verb>: not yet implemented (planned).` on stderr instead of
    promising a specific Step number — roadmap step numbers shift
    mid-flight, stale promises in `--help` are worse than no
    promise.
  - **L3 — Dead `eslint-disable` removed** from
    `cli/util/plugin-runtime.ts`.
  - **N1 — `Link.source` vs `Link.sources` doc clarified.** Both
    fields now carry inline doc-comments calling out the singular /
    plural naming trap. Spec-frozen, but the ambiguity is the
    easiest way to misread the type for new contributors.
  - **N2 — `sm check` Usage examples expanded.** The `-g/--global`
    and `--db <path>` flags were declared but missing from the
    `Usage.examples` block — asymmetry with `sm scan` and the rest
    of the read-side verbs that ship the same flags. Two examples
    added: `sm check --global` and `sm check --db
/path/to/skill-map.db`.
  - **N4 — Error / hint strings extracted to `*.texts.ts` modules
    with `{{name}}` template interpolation.** Pre-1.0 is the
    natural moment to seed the pattern before the string set grows.
    The workspace `ui/` already has a sibling layout at
    `ui/src/i18n/` (functions returning template literals); CLI
    takes a deliberately different shape — flat string templates
    with `{{name}}` placeholders, interpolated by a tiny
    `tx(template, vars)` helper. Rationale: the template form is
    **drop-in compatible with Transloco / Mustache / Handlebars**
    (the syntax they all share) so the day this project migrates to
    a real i18n library, the strings move as-is. Functions would
    have to be re-shaped first.

            Helper at `kernel/util/tx.ts`. Contract:

            - Every `{{name}}` token MUST have a matching key in the vars
              object — missing key throws (silent fallback hides
              forgotten args in production).
            - `null` / `undefined` values throw — caller coerces
              upstream.
            - Whitespace inside the braces tolerated (`{{ name }}`) so
              long templates wrap cleanly across `+`-joined lines.
            - Plural / conditional logic does NOT live in the template;
              the caller picks `*_singular` vs `*_plural` keys.

            Files created:

            - `kernel/util/tx.ts` — the helper itself, with 13 tests in
              `test/tx.test.ts` (single / multi token, whitespace,
              missing / null / undefined keys, identifier shapes, error
              truncation).
            - `kernel/i18n/orchestrator.texts.ts` — frontmatter
              malformed/invalid templates, `extension.error` payloads,
              root validation errors.
            - `kernel/i18n/plugin-loader.texts.ts` — every `load-error` /
              `invalid-manifest` / `incompatible-spec` reason, plus the
              import timeout message.
            - `cli/i18n/scan.texts.ts` — `sm scan` flag-clash / scan
              failure / guard / summary templates, plus the `sm scan

        compare-with`dump-load errors.

    -`cli/i18n/watch.texts.ts`—`sm watch`lifecycle templates. -`cli/i18n/init.texts.ts`—`sm init`templates including
    the`--dry-run`previews and the singular/plural pair for
    gitignore updates. -`cli/i18n/db.texts.ts`—`sm db reset`/`sm db restore` templates including their`--dry-run`previews. -`cli/i18n/cli-progress-emitter.texts.ts`— the
    `extension.error: ...` stderr line.

            String content moved verbatim — every existing test that
            matches on stderr / stdout content keeps passing. Trivial
            single-token strings (`'No issues.\n'`) and rare per-handler
            bespoke phrases stay inline; the pattern is now established
            for whoever wants to migrate them in a follow-up.

            Note on `ui/` divergence: today the two workspaces use
            different shapes for their text tables (functions in `ui/`,
            templates in `cli/`). Aligning them is a follow-up — the day a
            real i18n library lands, both converge on its native shape.
            The CLI shape is closer to the eventual destination.

  - **N6 — `TIssueSeverity` aliased to `Severity`.** SQLite schema
    type now reads `type TIssueSeverity = Severity` instead of
    duplicating the union literal. Keeps DB and runtime in
    lock-step if the union ever evolves.

  ### Migrations consolidation (kernel DB)

  - **`src/migrations/001_initial.sql` + `002_scan_meta.sql`**
    consolidated into a single `001_initial.sql`. Pre-1.0 with no
    released DBs to forward-migrate, the two-file split was a
    historical accident from an incremental shipment. After
    consolidation: same 12 tables, same constraints, same indexes;
    `PRAGMA user_version` of a freshly-initialised DB is now `1`
    instead of `2`. Migration runner is unchanged (it tolerates any
    count of `NNN_*.sql` files).

  ### Test coverage (Part 1)

  - New tests for H2 (plugin loader timeout — 2 cases),
    M6 (orchestrator `extension.error` emission — 3 cases),
    CLI progress emitter wiring (4 cases). The compare-with suite
    (`scan-compare.test.ts`, 9 cases) was migrated to
    `ScanCompareCommand` and the three flag-clash tests dropped
    (the flags are now structurally absent on the sub-verb). Test
    totals: 479 (start of pass) → 488 (after H2/M6 tests) → 485
    (after the three flag-clash deletions).

  ### Deferred / out of scope

  The findings below were reviewed but did not warrant code
  changes; each has its own resolution noted alongside.

  - **L4 — `runScan` / `runScanWithRenames` unification.** Already
    resolved by C1 (both are thin wrappers around
    `runScanInternal`).
  - **L5 — Node-version-guard exit code.** Reviewed against the
    updated exit-code table; existing `2` is correct under
    "operational error / unhandled exception". Spec table got the
    environment-mismatch clarification (above).
  - **L6 — `loadSchemaValidators()` cache.** Already cached at
    module level since Step 5.12.
  - **L7 — `pkg with { type: 'json' }` portability.** Stable in
    Node ≥ 22; `engines.node": ">=24.0"` covers it. No fallback
    needed.
  - **N3 — `compare-with` "dump not found" exit code.** The error
    paths in `ScanCompareCommand` already use the `ExitCode.Error`
    enum (= 2) for dump load failures, matching the spec clause for
    operational errors.
  - **N5 — Exit-code list completeness.** Verified the comment in
    `cli/entry.ts` against `spec/cli-contract.md` §Exit codes —
    identical, no edit needed.

  ## Part 2 — Plugin model overhaul (5-phase implementation)

  ### Summary

  The plugin model received a comprehensive overhaul before
  stabilizing at v1.0. Plugin kinds total after this bump: **6**
  (Provider, Extractor, Rule, Action, Formatter, Hook). All
  breakings are pre-1.0 minor per `versioning.md` § Pre-1.0.

  ### Phase 1 (commit 7354c26) — Foundation

  Five sub-phases, additive or pre-1.0 minor breakings:

  - **A.4** — three-tier frontmatter validation model documented in
    `plugin-author-guide.md` (default permissive + `unknown-field`
    rule + `scan.strict` promote-to-error). Behavior unchanged.
  - **A.5** — plugin id global uniqueness: `directory ==
manifest.id` rule, new status `id-collision` (sixth),
    validation in boot/scan/doctor. Cross-root collisions block
    both involved plugins; user resolves by renaming.
  - **A.6** — extension ids qualified `<plugin-id>/<ext-id>` in
    registry. Built-ins classified into `claude/*` (4 Claude-
    specific) and `core/*` (7 kernel built-ins) bundles. New
    `Registry.get/find` APIs; `defaultRefreshAction` schema
    requires the qualified pattern; `extension.error` events emit
    qualified ids.
  - **A.10** — optional `applicableKinds` filter on Detector
    manifest; fail-fast skip for non-matching kinds (zero CPU/LLM
    cost); doctor warning for kinds not declared by any installed
    Provider. Empty array invalid; absence preserves apply-to-all
    default.
  - **Granularity** — Built-ins now respect `config_plugins`
    enable/disable via granularity-aware filtering. New
    `IBuiltInBundle` shape with `granularity: 'bundle' |
'extension'`; `claude` ships as bundle (all-or-nothing), `core`
    as extension (each toggleable). User plugins default to bundle;
    opt in via `granularity` in `plugin.json`. Both plugin ids and
    qualified extension ids accepted as keys in `config_plugins`
    and `settings.json#/plugins` (no schema change needed).

  550/550 tests pass (+33 vs baseline 517).

  ### Phase 2 (commit ae3eaa6) — Renames

  Four sub-phases, all breaking but allowed in minor pre-1.0:

  - **2a (Renderer → Formatter)** — Kind, types, files renamed.
    Method `render(ctx)` → `format(ctx)`; manifest field `format`
    → `formatId` (TS clash resolution). Same contract: graph →
    string, deterministic-only.
  - **2b (Adapter → Provider)** — New required field
    `explorationDir` on the manifest (e.g. `~/.claude` for the
    Claude Provider). DB schema migrated in-place (column
    `nodes.adapter` → `nodes.provider`, etc.). The
    hexagonal-architecture `RunnerPort.adapter` /
    `StoragePort.adapter` is unchanged.
  - **2c (Audit removed)** — Audit kind removed. The single
    built-in `validate-all` migrated to a Rule (qualified id
    `core/validate-all`, `evaluate(ctx) → Issue[]`). CLI verbs
    `sm audit *` removed; users invoke via `sm check --rules
core/validate-all`.
  - **2d (Detector → Extractor)** — Method signature changes from
    `detect(ctx) → Link[]` to `extract(ctx) → void` — output flows
    through three ctx callbacks: `emitLink`, `enrichNode`, `store`.
    Built-ins migrated maintain functional parity using `emitLink`.
    Persistence of `enrichNode` deferred to Phase 4 (A.8 stale
    layer); orchestrator buffers in memory today.

  554/554 cli + 32/32 testkit pass.

  ### Phase 3 (commit 34f993e) — Schema relocation

  **A.2** — Per-kind frontmatter schemas relocate from spec to the
  Provider that declares them. Spec keeps only `frontmatter/base`
  (universal).

  - 5 schemas moved (`git mv`):
    `spec/schemas/frontmatter/{skill,agent,command,hook,note}.schema.json`
    → built-in Claude Provider's `schemas/` directory. New `$id`:
    `https://skill-map.dev/providers/claude/v1/frontmatter/<kind>`.
    Cross-package `$ref` resolves via the spec base's `$id`
    (`https://skill-map.dev/spec/v0/frontmatter/base.schema.json`);
    AJV resolves by `$id` when both schemas register on the same
    instance.
  - Provider manifest gains a required `kinds` map subsuming three
    former fields: `emits` (now derives from
    `Object.keys(kinds)`), the flat `defaultRefreshAction` map (now
    per-entry inside `kinds[<kind>].defaultRefreshAction`), and the
    new `schema` (path to the per-kind schema relative to the
    provider directory).
  - Built-in Claude Provider migrated: 5 kind entries (skill,
    agent, command, hook, note), each with `schema`, `schemaJson`
    (runtime field, AJV-compiled at load), and qualified
    `defaultRefreshAction` (`claude/summarize-<kind>`).
  - Kernel orchestrator parse phase asks the Provider for the
    schema via `IProviderFrontmatterValidator` (composed by scan
    via `buildProviderFrontmatterValidator`) instead of reading
    from spec/. Flow: validate base → look up provider → validate
    per-kind schema from Provider.
  - `schema-validators.ts` catalog loses the 5 per-kind frontmatter
    entries; only `frontmatter-base` remains kernel-known.
    `plugin-loader`'s `stripFunctionsAndPluginId` now also strips
    `schemaJson` (runtime-only) from each `kinds` entry before
    AJV-validating the manifest.
  - Coverage matrix: 28 → 23 schemas (the 5 per-kind frontmatter
    schemas are now Provider-owned and ship with their own
    conformance suite in Phase 5 / A.13).

  556/556 cli + 32/32 testkit pass.

  ### Phase 4 (commit e62695f) — Probabilistic infra

  Five sub-phases, all breaking but allowed in minor pre-1.0:

  - **4a (A.9)** — fine-grained Extractor cache via new
    `scan_extractor_runs` table. Resolves gap where newly
    registered Extractors silently skipped cached nodes; cache hit
    logic now per-(node, extractor). Uninstalled Extractors cleaned
    (rows + orphan links). Migration in-place.
  - **4b (A.12)** — opt-in `outputSchema` for plugin custom
    storage. Manifest gains `storage.schema` (Mode A) and
    `storage.schemas` (Mode B) for AJV validation of
    `ctx.store.write/.set` calls. Throws on shape violation;
    default absent = permissive.
  - **4c (A.8)** — enrichment layer + stale tracking. New
    `node_enrichments` table persists per-(node, extractor)
    partials separately from author's frontmatter (immutable).
    Probabilistic enrichments track `body_hash_at_enrichment`; scan
    flags `stale=1` on body change (NOT deleted, preserves LLM
    cost). Helper `mergeNodeWithEnrichments` filters stale +
    last-write-wins. New verbs `sm refresh <node>` and
    `sm refresh --stale` (stubs awaiting Step 10).
  - **4d (A.11)** — sixth plugin kind `hook`. Declarative
    subscriber to a curated set of 8 lifecycle events (`scan.*`,
    extractor/rule/action.completed,
    job.spawning/completed/failed). Other events deliberately not
    hookable. Manifest declares `triggers[]` (load-time validated)
    and optional `filter`. Three new kernel events added to
    catalog. Dual-mode (det dispatched in-process; prob deferred to
    Step 10).
  - **4e (A.7)** — `sm check --include-prob` opt-in flag (stub).
    Default `sm check` unchanged: det only, CI-safe. With flag:
    detects prob rules, emits stderr advisory; full dispatch awaits
    Step 10. Combines with `--rules`, `-n`, `--no-plugins`.

  591/591 cli + 32/32 testkit pass.

  ### Phase 5 (commit 03b5a65) — Conformance + cleanup

  **A.13** — Conformance fixture relocation:

  - 3 cases moved (`git mv`): `basic-scan`, `orphan-detection`,
    `rename-high` →
    `src/extensions/providers/claude/conformance/cases/`. 11
    fixture files (`minimal-claude/`, `orphan-{before,after}/`,
    `rename-high-{before,after}/`) moved alongside.
  - New `coverage.md` per-Provider listing the 5 frontmatter
    schemas (skill, agent, command, hook, note) and their cases.
  - New verb `sm conformance run [--scope spec|provider:<id>|all]`.
    Discovery by convention at `<plugin-dir>/conformance/`. The
    existing runner gains optional `fixturesRoot` (default
    `<specRoot>/conformance/fixtures` for compat); tooling using
    the public API of `@skill-map/cli/conformance` keeps working.
    `--json` deferred — reporter shape not yet frozen.
  - Spec keeps only the kernel-agnostic case (`kernel-empty-boot`)
    and the universal preamble fixture. Coverage matrix downgrades
    conservatively (rows that depended on `basic-scan` are now
    partial or missing, with cross-link to the Provider's matrix).

  ROADMAP cleanup:

  - The three "Status: target state for v0.8.0 — spec catch-up
    pending" banners on §Plugin system / §Frontmatter standard /
    §Enrichment are removed; prose shifts from future to present
    ("kinds from v0.7.0 are renamed" → "were renamed in spec
    0.8.0"; Model B enrichment now describes the shipped
    `node_enrichments` table with `body_hash_at_enrichment` rather
    than "table or column set decided in PR").
  - Decision-log entry for the working session rewritten to
    reflect "shipped" rather than "pending".
  - Last-updated header gains an "implementation" paragraph
    listing the four prior phase commits.

  593/593 cli + 32/32 testkit pass (+2 vs Phase 4 baseline).
  spec:check green (40 files hashed — down from 53 because the
  Claude-specific cases and fixtures left the spec's hash set).

  ### Breaking changes for plugin authors (Part 2)

  Manifest renames:

  - `kind: 'adapter'` → `kind: 'provider'`
  - `kind: 'detector'` → `kind: 'extractor'`
  - `kind: 'renderer'` → `kind: 'formatter'`
  - `kind: 'audit'` removed (migrate to `kind: 'analyzer'`).

  Method signatures:

  - Detector `detect(ctx) → Link[]` → Extractor `extract(ctx) →
void` (output via `ctx.emitLink` / `ctx.enrichNode` /
    `ctx.store`).
  - Renderer `render(ctx) → string` → Formatter `format(ctx) →
string`.

  Manifest fields:

  - Provider gains required `explorationDir`.
  - Provider's flat `defaultRefreshAction` map replaced by per-kind
    entries inside `kinds[<kind>].defaultRefreshAction` (must
    follow qualified pattern `<plugin-id>/<ext-id>`).
  - Provider's `emits` derives from `Object.keys(kinds)` (the
    manifest field is gone).
  - Provider's per-kind schemas declared via `kinds[<kind>].schema`
    (path relative to provider dir).
  - Renderer's `format` field renamed to `formatId` on the
    Formatter manifest (TS clash resolution).
  - New plugin kind `hook` with `triggers[]` + optional `filter`.
  - Optional `outputSchema` (`storage.schema` / `storage.schemas`)
    for Mode A / Mode B plugin custom storage.
  - Optional `applicableKinds` filter on Extractor manifest.

  Extension ids:

  - All extension ids must be qualified
    `<plugin-id>/<extension-id>` (built-ins classified into
    `claude/*` and `core/*`).

  DB schema:

  - Two new tables added in-place to `001_initial.sql` (pre-1.0
    consolidation, no production DBs to migrate):
    `scan_extractor_runs` and `node_enrichments`.
  - Column rename `nodes.adapter` → `nodes.provider` (and parallel
    in `result.adapters` → `result.providers`).

  ## Test stats

  593/593 cli + 32/32 testkit pass (post-Phase 5).
  Two new DB tables (`scan_extractor_runs`, `node_enrichments`)
  added in-place to `001_initial.sql` (pre-1.0 consolidation, no
  production DBs to migrate). The 5 per-kind frontmatter schemas
  relocated from spec/ to the Claude Provider package.

### Patch Changes

- Updated dependencies [6dad772]
  - @skill-map/spec@0.8.0

## 0.5.0

### Minor Changes

- 0463a0f: Step 9.1 — plugin runtime wiring. Drop-in plugins discovered under
  `<scope>/.skill-map/plugins/<id>/` now participate in the read-side
  pipeline: their detectors / rules emit links + issues during `sm scan`,
  and their renderers are selectable via `sm graph --format <name>`.

  New surface:

  - `loadPluginRuntime(opts)` helper at `src/cli/util/plugin-runtime.ts`
    centralises discovery, layered enabled-resolver (settings.json + DB
    override `config_plugins`), failure-mode-to-warning conversion, and
    manifest-row collection. Single source of truth for any verb that
    needs plugin extensions on the wire.
  - `composeScanExtensions` + `composeRenderers` merge built-in and plugin
    contributions into the shapes the orchestrator + graph command consume.
  - `--no-plugins` flag added to `sm scan`, `sm scan --watch`, `sm watch`,
    and `sm graph`. Pairs with `--no-built-ins` for kernel-empty-boot
    parity.
  - Failed plugins (`incompatible-spec` / `invalid-manifest` / `load-error`)
    emit one stderr line each and are skipped; the kernel keeps booting.
    Disabled plugins silently drop out of the pipeline (their `sm plugins
list` row already conveys intent).

  Bug fix collateral: the plugin loader now strips function-typed
  properties from a plugin's runtime export before AJV-validating it
  against the extension-kind schema. The kind schemas use
  `unevaluatedProperties: false` to keep the manifest shape strict;
  without the strip, real plugins shipping `detect` / `render` /
  `evaluate` methods always failed validation. Built-ins were unaffected
  because they never went through the loader.

  Out of scope for 9.1, picked up later in Step 9:

  - `sm export --format` does not consult the renderer registry today;
    its formats (`json`, `md`, `mermaid`) are hand-rolled. Flipping it
    to use renderers is a future enhancement, not on the Step 9 critical
    path.
  - Plugin migrations + `sm db migrate --kernel-only` / `--plugin <id>`
    flags + triple protection ship as Step 9.2.
  - `@skill-map/testkit` package ships as Step 9.3.
  - Plugin author guide ships as Step 9.4.

  5 new tests at `src/test/plugin-runtime.test.ts` cover plugin detector
  contribution, `--no-plugins` opt-out on both scan and graph, broken-
  manifest tolerance, and plugin-renderer selection. Test count
  389 → 394.

- 0463a0f: Step 9.2 — plugin migrations + triple protection. Plugins declaring
  `storage.mode === 'dedicated'` can now ship their own SQL migrations
  under `<plugin-dir>/migrations/NNN_<name>.sql`, and `sm db migrate`
  applies them after the kernel pass. Two new flags from
  `spec/cli-contract.md:304` light up:

  - `--kernel-only` — skip plugin migrations entirely.
  - `--plugin <id>` — run migrations for one plugin (skips the kernel
    pass; assumes kernel is already up to date). Mutually exclusive
    with `--kernel-only`.

  Triple-protection rule (every object a plugin migration touches MUST
  live in the namespace `plugin_<normalizedId>_*`):

  - **Layer 1 — discovery**: every pending file is parsed + validated
    before any of them run. Failure aborts the whole batch with no DB
    writes.
  - **Layer 2 — apply**: same validator runs immediately before
    `db.exec(sql)`, defending against TOCTOU edits between discovery
    and apply.
  - **Layer 3 — post-apply catalog assertion**: after each plugin's
    batch commits, `sqlite_master` is compared against a pre-batch
    snapshot. Any new object outside the prefix is reported as an
    intrusion (exit code 2; ledger row still written for whatever
    applied cleanly so the breach is loud).

  Implementation: pragmatic regex parser per the Arquitecto's pick.
  Whitelist of allowed DDL (`CREATE` / `DROP` / `ALTER` over `TABLE` /
  `INDEX` / `TRIGGER` / `VIEW`) + DML (`INSERT` / `UPDATE` / `DELETE`)
  on prefixed objects. Forbidden keywords (`BEGIN` / `COMMIT` /
  `ROLLBACK` / `PRAGMA` / `ATTACH` / `DETACH` / `VACUUM` / `REINDEX` /
  `ANALYZE`) abort validation. Schema qualifiers other than `main.`
  are rejected. Comments are stripped first so `-- CREATE TABLE evil;`
  and `/* … */` blocks can't smuggle hidden DDL past the regex.

  Lights up `storage.mode === 'dedicated'` end-to-end: the existing
  `config_schema_versions` table records plugin migrations under
  `(scope='plugin', owner_id=<plugin-id>)`. Plugins with `mode === 'kv'`
  or no `storage` field are skipped silently — the kernel-owned
  `state_plugin_kvs` table is already there. Each migration runs in
  its own transaction with the ledger insert in the same transaction
  so partial failures roll back cleanly.

  New modules:

  - `src/kernel/adapters/sqlite/plugin-migrations-validator.ts` —
    `normalizePluginId`, `stripComments`, `splitStatements`,
    `validatePluginMigrationSql`, `snapshotCatalog`,
    `detectCatalogIntrusion`, `assertNoNormalizationCollisions`. Pure,
    no IO.
  - `src/kernel/adapters/sqlite/plugin-migrations.ts` —
    `discoverPluginMigrations`, `planPluginMigrations`,
    `applyPluginMigrations`, `readPluginLedger`. Mirrors the kernel
    runner shape for consistency.

  CLI surface:

  - `DbMigrateCommand` learns `--kernel-only` and `--plugin <id>`. The
    `--status` summary now lists kernel + per-plugin ledgers.
  - Plugin discovery uses the `loadPluginRuntime` helper from 9.1, so
    the resolver layering (settings.json + DB override) stays in
    lock-step with `sm plugins list`.

  43 new tests across two files (`plugin-migrations-validator.test.ts`,
  `plugin-migrations.test.ts`) cover id normalization, comment stripping,
  statement splitting, prefix enforcement (green path + 9 violation
  shapes), catalog intrusion detection, runner integration (green path,
  Layer 1 abort, idempotent re-run, dry-run), and the CLI flag matrix
  (`--kernel-only`, `--plugin <id>`, missing-id exit 5, mutual exclusion,
  `--status` formatting). Test count 394 → 437.

### Patch Changes

- 0463a0f: Step 9.3 — `@skill-map/testkit` lands as a separate workspace + npm
  package (per the Arquitecto's pick of independent versioning over a
  subpath export). Plugin authors install it alongside `@skill-map/cli`
  and use it to unit-test detectors, rules, renderers, and audits
  without spinning up the full skill-map runtime.

  New surface (all stable through v1.0 except the runner stand-in,
  flagged `experimental` until Step 10 lands the job subsystem
  contract):

  - **Builders** — `node()`, `link()`, `issue()`, `scanResult()` produce
    spec-aligned domain objects with sensible defaults. Override only
    the fields a given test cares about.
  - **Context factories** — `makeDetectContext`, `makeAnalyzerContext`,
    `makeRenderContext`, `detectContextFromBody`. Per-kind context shapes
    the kernel injects into extension methods.
  - **Fakes** — `makeFakeStorage` (in-memory KV stand-in for `ctx.store`,
    matches the Storage Mode A surface) and `makeFakeRunner` (queue +
    history `RunnerPort` stand-in for probabilistic extensions).
  - **Run helpers** — `runDetectorOnFixture(detector, opts)`,
    `runAnalyzerOnGraph(rule, opts)`, `runRendererOnGraph(renderer, opts)`.
    Most plugin tests reduce to one line: build the fixture, call the
    helper, assert on the result.

  Collateral on `@skill-map/cli`: `src/kernel/index.ts` now re-exports
  the extension-kind interfaces (`IDetector`, `IAnalyzer`, `IRenderer`,
  `IAdapter`, `IAudit` and their context shapes) so plugin authors can
  type-check their extensions against the same surface the kernel
  consumes. Patch-level bump because the change is purely additive.

  The testkit workspace ships its own `tsup` build (5 KB of runtime,
  10 KB of types) and pins every dep at exact versions per the
  monorepo policy. `@skill-map/cli` is marked `external` in the bundle
  so the published testkit stays a thin layer over the user's installed
  cli version.

  30 new tests under `testkit/test/*.test.ts` cover builder defaults +
  overrides, context factory shapes, KV stand-in semantics (set / get /
  list-by-prefix / delete), fake-runner queueing + history + reset, and
  the three high-level run helpers. Tests run in their own
  `npm test --workspace=@skill-map/testkit` step (independent from cli's
  test command).

  Out of scope for 9.3, picked up in 9.4:

  - Plugin author guide (`spec/plugin-author-guide.md`) referencing the
    testkit by example.
  - Reference plugin under `examples/hello-world/` (Arquitecto's pick:
    in the principal repo, not a separate one).
  - Diagnostics polish on the loader's `reason:` strings.

- 0463a0f: Step 9.4 — plugin author guide + reference plugin + diagnostics polish.
  **Step 9 fully closed** with this changeset.

  ### Spec — plugin author guide (additive prose)

  New document at `spec/plugin-author-guide.md` covering:

  - Discovery roots (`<project>/.skill-map/plugins/`,
    `~/.skill-map/plugins/`, `--plugin-dir <path>`).
  - Manifest fields with the normative schema reference.
  - `specCompat` strategy — narrow ranges pre-`v1.0.0`, `^1.0.0`
    recommendation post-`v1.0.0`.
  - The six extension kinds with one minimal worked example each
    (detector, rule, renderer in full; adapter / audit / action flagged
    for later expansion alongside Step 10).
  - Storage choice (KV vs Dedicated) cross-linking `plugin-kv-api.md`
    and the Step 9.2 triple-protection rule.
  - Execution modes (deterministic / probabilistic) cross-linking
    `architecture.md`.
  - Testkit usage with `runDetectorOnFixture`, `runAnalyzerOnGraph`,
    `runRendererOnGraph`, `makeFakeRunner`.
  - The five plugin statuses (`loaded` / `disabled` / `incompatible-spec`
    / `invalid-manifest` / `load-error`) and how to read them.
  - Stability section (document is stable; widening additions are minor
    bumps; breaking edits are major).

  `spec/package.json#files` updated to ship the new doc; `spec/index.json`
  regenerated (57 → 58 hashed files). `coverage.md` unchanged because the
  guide is prose, not a schema.

  ### Reference plugin — `examples/hello-world/`

  Smallest viable plugin in the principal repo (Arquitecto's pick: in
  the main repo, not separate). One detector (`hello-world-greet`)
  emitting `references` links per `@greet:<name>` token in node bodies.
  Includes:

  - `plugin.json` declaring one extension and pinning `specCompat: ^1.0.0`.
  - `extensions/greet-detector.mjs` — runtime instance with both
    manifest fields and the `detect` method.
  - `README.md` — what it does, file layout, three-step "try it
    locally" recipe, what's intentionally missing (storage,
    multi-extension, probabilistic mode), pointers for production-grade
    patterns.
  - `test/greet-detector.test.mjs` — four-assertion test using
    `@skill-map/testkit`, runnable via `node --test` with no build step.

  Verified end-to-end: the example plugin loads cleanly under
  `sm plugins list`, scans contribute its links to the persisted graph,
  and the testkit-based test passes. The example is **not** registered
  as a workspace — it's intentionally standalone so users can copy it.

  ### CLI — diagnostics polish on `PluginLoader.reason`

  Each failure-mode reason string now carries an actionable hint:

  - `invalid-manifest` (JSON parse): names the manifest path, suggests
    validating the JSON.
  - `invalid-manifest` (AJV): names the manifest path AND points at
    `spec/schemas/plugins-registry.schema.json#/$defs/PluginManifest`.
  - `invalid-manifest` (specCompat not a valid range): suggests a range
    shape (`"^1.0.0"`).
  - `incompatible-spec`: suggests two remediations (update the plugin's
    `specCompat`, or pin sm to a compatible spec version).
  - `load-error` (extension file not found): includes the absolute
    resolved path, pointer to `plugin.json#/extensions`.
  - `load-error` (default export missing kind): lists the valid kinds.
  - `load-error` (unknown kind): lists the valid kinds.
  - `load-error` (extension manifest schema fails): names the
    per-kind schema (`spec/schemas/extensions/<kind>.schema.json`).

  6 new tests under `test/plugin-loader.test.ts` (`Step 9.4 diagnostics
polish` describe block) assert each hint shape is present without
  pinning the full text. Test count 437 → **443 cli + 30 testkit = 473**.

  ### Step 9 closed

  The four sub-steps — 9.1 (plugin runtime wiring), 9.2 (plugin
  migrations + triple protection), 9.3 (`@skill-map/testkit` workspace),
  9.4 (author guide + reference plugin + diagnostics polish) — together
  turn `skill-map` plugins from "discovered but inert" into a
  first-class authoring surface with documentation, tests, and a
  working reference. Next step: **Step 10 — job subsystem + first
  probabilistic extension** (wave 2 begins).

- Updated dependencies [0463a0f]
  - @skill-map/spec@0.7.1

## 0.4.0

### Minor Changes

- a73f3f4: Step 7.1 — File watcher (`sm watch` / `sm scan --watch`)

  Long-running watcher that subscribes to the scan roots, debounces
  filesystem events, and triggers an incremental scan per batch. Reuses
  the existing `runScanWithRenames` pipeline, the `IIgnoreFilter` chain
  (`.skill-mapignore` + `config.ignore` + bundled defaults), and the
  `scan.*` non-job events from `job-events.md` — one ScanResult per
  batch, emitted as ndjson under `--json`.

  **Spec changes (minor)**:

  - `spec/schemas/project-config.schema.json` — new `scan.watch` object
    with a single key `debounceMs` (integer ≥ 0, default 300). Groups
    bursts of filesystem events (editor saves, branch switches, npm
    installs) into a single scan pass. Set to 0 to disable debouncing.
  - `spec/cli-contract.md` §Scan — documents `sm watch [roots...]` as
    the primary verb and `sm scan --watch` as the alias. Watcher
    respects the same ignore chain as one-shot scans, emits one
    ScanResult per batch (ndjson under `--json`), closes cleanly on
    `SIGINT` / `SIGTERM`, exits 0 on clean shutdown. Exit-code rule
    carved out for the watcher: per-batch error issues do not flip the
    exit code (the loop keeps running); operational errors still exit 2.

  No new events. No new ports. The watcher is implementation-defined
  inside the kernel package; a future `WatchPort` can be added when /
  if a non-Node implementation needs to swap the chokidar wrapper.

  **Runtime changes (minor — new verb + new config key)**:

  - `chokidar@5.0.0` pinned in `src/package.json` (single new runtime
    dependency, MIT). Chokidar v5 requires Node ≥ 20.19; the project
    already pins `engines.node: ">=24.0"` so this is a no-op for
    consumers. Brings in `readdirp@5` as a transitive.
  - `src/kernel/scan/watcher.ts` — `IFsWatcher` interface + concrete
    `ChokidarWatcher` wrapping `chokidar.watch()` with the existing
    `IIgnoreFilter` plumbed through, debouncer, batch coalescing,
    and explicit `stop()` for clean teardown.
  - `src/cli/commands/watch.ts` — new `WatchCommand`. `sm scan
--watch` delegates to the same code path so the two surfaces are
    byte-aligned (no parallel implementations).
  - `src/config/defaults.json` — new `scan.watch.debounceMs: 300`
    default.

  **Why minor (not patch)**: new public verb (`sm watch`), new public
  config key (`scan.watch.debounceMs`), and a new flag on an existing
  verb (`sm scan --watch`). All three are surface additions, not bug
  fixes — minor under both the spec and the runtime semver policies.
  No breaking changes; existing `sm scan` without `--watch` is
  byte-identical to before.

  **Roadmap**: Step 7 — Robustness, sub-step 7.1 (chokidar watcher).
  Trigger normalization is implicit-already-landed (cabled into every
  detector at Steps 3–4 with full unit tests in
  `src/kernel/trigger-normalize.test.ts`); we do not write a sub-step
  for it. Next sub-steps: 7.2 detector conflict resolution, 7.3 `sm
job prune` + retention enforcement.

- a73f3f4: Step 7.2 — Detector conflict resolution

  Two pieces:

  1.  **New built-in rule `link-conflict`** (`src/extensions/rules/link-conflict/`).
      Surfaces detector disagreement. Groups links by `(source, target)` and
      emits one `warn` Issue per pair where the set of distinct `kind` values
      has size ≥ 2. Agreement (single kind across multiple detectors) is
      silent — by design, to avoid massive noise on real graphs.
      Issue payload (`data`) carries `{ source, target, variants }` where
      each `variant` is `{ kind, sources: detectorId[], confidence }`. Variant
      sources are deduped + sorted; confidence is the highest across rows
      of the same kind (`high` > `medium` > `low`).

      This is the kernel piece of Decision #90 read-time "consumers that
      need uniqueness aggregate at read time" — the rule is one such
      consumer, on the alarming side. Storage stays untouched (one row
      per detector, no merge, no dedup). Severity is `warn`, not `error`:
      the rule cannot pick which kind is correct, so per `cli-contract.md`
      §Exit codes the verb stays exit 0.

  2.  **`sm show` pretty link aggregation** (`src/cli/commands/show.ts`).
      The human renderer now groups `linksOut` / `linksIn` by `(endpoint,
kind, normalizedTrigger)` and prints one row per group with the
      union of detector ids in a `sources:` field. The section header
      reports both the raw row count and the unique-after-grouping count
      (`Links out (12, 9 unique)`). When N > 1 detector emits the same
      logical link, the row also gets a `(×N)` suffix.

                                                                                                                                                                                                                                                     `--json` output is byte-identical to before — raw rows, no merge.
                                                                                                                                                                                                                                                     Storage is byte-identical to before. The grouping is purely a
                                                                                                                                                                                                                                                     read-time presentation choice for human eyes.

  **Spec changes (patch)**:

  - `spec/cli-contract.md` §Browse — `sm show` row clarifies that pretty
    output groups identical-shape links and that `--json` emits raw rows.
    Patch (not minor) because the JSON contract is unchanged; the human
    output format is non-normative anyway.

  **Runtime changes (minor — new rule + new presentation)**:

  - New rule `link-conflict` registered in `src/extensions/built-ins.ts`.
  - `sm show` pretty output groups links + reports unique counts.

  **UI inspector aggregation deferred to Step 13**: the current Flavor A
  inspector renders the `Relations` card from `node.frontmatter.metadata.{
related, requires, supersedes, provides, conflictsWith}` directly — it
  does NOT consume `linksOut` / `linksIn` rows from `scan_links`. There
  is no link table to aggregate today. When Step 13's Flavor B lands (Hono
  BFF + WS + full link panel from scan), the aggregation logic from
  `src/cli/commands/show.ts` will need to be ported.

  **Roadmap**: Step 7 — Robustness, sub-step 7.2 (detector conflict
  resolution). Closes one of the three remaining frentes; 7.3 (`sm job
prune` + retention) still pending. Decision #90 unchanged: storage
  keeps raw per-detector rows. The `related` vs LLM-amplification
  discussion is documented in `.tmp/skill-map-related-test/` (status
  quo retained — fields stay opt-in under `metadata.*`; revisit if
  real-world amplification appears).

  **Tests**: 327 → 335 (+8 new for the rule, no regressions).

- a73f3f4: Step 7.3 — `sm job prune` retention GC

  Lands the real implementation behind the existing stub. Closes Step 7.

  **Behaviour**:

  - Default: applies the configured retention policy. For each terminal
    status (`completed` / `failed`) with a non-null
    `jobs.retention.<status>` value, deletes `state_jobs` rows whose
    `finished_at < Date.now() - policySeconds * 1000` and unlinks each
    row's MD file in `.skill-map/jobs/`. Default `completed` policy is
    30 days (2592000s); default `failed` is `null` (never auto-prune,
    preserving failure history for analysis).
  - `--orphan-files`: ALSO scans `.skill-map/jobs/` for MD files whose
    absolute path is not referenced by any `state_jobs.file_path` and
    unlinks them. Runs AFTER retention so freshly-pruned files don't
    double-count. Useful when the DB was wiped or a runner crashed
    mid-render.
  - `--dry-run` / `-n`: reports what would be pruned without touching
    the DB or the FS. Output shape is identical to live mode (`dryRun:
true` distinguishes them under `--json`).
  - `--json`: emits a structured document on stdout — `{ dryRun,
retention: { completed: { policySeconds, deleted, files }, failed:
{...} }, orphanFiles: { scanned, deleted } | { scanned: false } }`.

  **Implementation**:

  - New module `src/kernel/adapters/sqlite/jobs.ts`: `pruneTerminalJobs`
    (DB-only — returns count + filePaths so the CLI does the unlink) and
    `listOrphanJobFiles` (FS scan + DB cross-reference).
  - New command file `src/cli/commands/jobs.ts`: `JobPruneCommand`.
  - `src/cli/commands/stubs.ts` no longer exports `JobPruneCommand`; the
    stub registration was removed from `STUB_COMMANDS`.
  - `src/cli/entry.ts` registers `JobPruneCommand` from the new file.

  **Spec invariants honoured**:

  - `state_executions` is NOT touched (per `spec/db-schema.md` §Persistence
    zones — append-only through v1.0).
  - Pruning runs only on explicit invocation; no implicit GC during
    normal verb execution (per `spec/job-lifecycle.md` §Retention and
    GC).
  - DB-missing → exit 2 with a clear message ("run `sm init` first").
  - File-unlink failures (already missing, permission denied) are
    swallowed silently — a stale file path doesn't fail the verb;
    the DB row is already gone.

  **Tests**: 327 → 341 (+14 covering helpers + CLI: empty DB, retention
  cutoff, dry-run, orphan-files mode, json shape, default policies).

  **Roadmap**: closes Step 7. All four frentes listed when 7 opened
  (trigger normalization, chokidar, conflict resolution, sm job prune)
  are now landed. Trigger normalization stayed implicit-already-done
  (cabled at Steps 3–4). Step 8 (Diff + export) is next.

- d3ad73c: Step 8.1 — `sm graph [--format <name>]` real implementation

  Replaces the long-standing stub with a real read-side verb that renders
  the persisted graph through any registered renderer. First sub-step of
  Step 8 (Diff + export).

  **Behaviour**:

  - Reads the DB via the existing `loadScanResult` driving adapter
    (`src/kernel/adapters/sqlite/scan-load.ts`); never persists.
  - Resolves the renderer by `format` field — default `ascii`. The lookup
    is over `builtIns().renderers`; plugin-supplied renderers will plug in
    through the same loader path that `sm scan` uses for adapters /
    detectors / rules, scheduled for Step 9 (plugin author UX).
  - Trailing newline normalisation: appends `\n` only if the renderer's
    output didn't already end in one. Safe to pipe.

  **Flags**:

  - `--format <name>` — must match a registered renderer's `format` field.
    Default `ascii`. `mermaid` and `dot` ship at Step 12 as drop-in
    built-ins; the verb requires no further changes when they land.
  - `--db <path>` and `-g/--global` — standard read-side scope flags
    (delegate to `resolveDbPath`).

  **Exit codes** (per `spec/cli-contract.md` §Exit codes):

  - `0` — render succeeded.
  - `2` — bad flag or unhandled error.
  - `5` — DB missing OR no renderer registered for the requested format.

  The empty-DB case (migrated but never scanned) renders the zero-graph
  ("0 nodes, 0 links, 0 issues") and exits `0` on purpose: graph is a
  read-side reporter, not a guard. Pair it with `sm doctor` (Step 10) for
  state assertions.

  **Wiring**:

  - New command at `src/cli/commands/graph.ts`.
  - Registered in `src/cli/entry.ts`.
  - Removed from `STUB_COMMANDS` in `src/cli/commands/stubs.ts`; the
    remaining `export` stub now points at Step 8.3 (was Step 3, stale).
  - `context/cli-reference.md` regenerated via `npm run cli:reference`;
    CI's `cli:check` job stays green.

  **Tests** (`src/test/graph-cli.test.ts`, 5 cases): default format renders
  two-node fixture; explicit `--format ascii` matches default; unknown
  `--format mermaid` exits 5 with "Available: ascii"; missing DB exits 5;
  empty DB renders zero-graph at exit 0. Total: 346 → **351** (+5).

  **No spec change**: the `sm graph [--format ...]` row in
  `spec/cli-contract.md` was already in place since Step 0a. This is pure
  runtime catch-up — wiring the verb that the spec already promised.

- d3ad73c: Step 8.2 — `sm scan --compare-with <path>` delta report

  Second sub-step of Step 8 (Diff + export). Adds a flag to `sm scan` that
  loads a saved `ScanResult` dump, runs a fresh scan in memory, and emits
  a delta between the two snapshots. Never touches the DB.

  **Flag**:

  - `--compare-with <path>` — string, optional. Points at a JSON file
    conforming to `scan-result.schema.json` (typically the output of an
    earlier `sm scan --json > baseline.json` invocation).

  **Behaviour**:

  - Loads the dump, parses it, validates against `scan-result.schema.json`
    via the existing `loadSchemaValidators()` adapter.
  - Runs a fresh scan with the same wiring as a normal `sm scan` (built-ins,
    layered config, ignore filter, strict mode). Skips persistence — the
    verb's contract is read-only.
  - Computes a delta via the new `computeScanDelta` kernel helper and
    emits a report.

  **Identity contract** (recorded in `src/kernel/scan/delta.ts`):

  - **Node** identity = `path`. Two nodes with the same path are the same
    node; differences become a `changed` entry annotated with the reason
    (`'body'` / `'frontmatter'` / `'both'`) so a renderer / summariser can
    decide whether the change is interesting.
  - **Link** identity = `(source, target, kind, normalizedTrigger ?? '')`.
    Mirrors the `sm show` aggregation key and Step 7.2's `link-conflict`
    rule — the `sources[]` union and confidence are presentation facets
    that don't constitute identity.
  - **Issue** identity = `(analyzerId, sorted nodeIds, message)`. Matches the
    diff key `spec/job-events.md` §issue.\* defines for future job events,
    so consumers can reuse the same logic.

  No "changed" bucket for links / issues — identity already captures
  everything that matters there. Nodes get one because the path stays
  stable while the body / frontmatter rewrites, and that change matters
  to downstream consumers (renderers, summarisers, the UI inspector).

  **Output**:

  - Pretty (default): one-line header with totals per bucket, then a
    `## nodes` / `## links` / `## issues` section per non-empty bucket
    using `+` (added), `-` (removed), `~` (changed) prefixes. Identical
    scans get a `(no differences)` hint.
  - `--json`: emits the `IScanDelta` object — `{ comparedWith, nodes:
{ added, removed, changed }, links: { added, removed }, issues:
{ added, removed } }`. Schema is implementation-defined pre-1.0 per
    `spec/cli-contract.md` and intentionally not pinned to a separate
    `delta.schema.json` until consumers materialise.

  **Exit codes** (per `spec/cli-contract.md` §Exit codes):

  - `0` — empty delta. Snapshot matches the dump byte-for-identity.
  - `1` — non-empty delta. Pre-commit / pre-merge wiring trips here.
  - `2` — operational error: dump file missing, malformed JSON, or
    schema-violating dump.

  **Combo rules**:

  - `--compare-with` cannot be combined with `--changed`, `--no-built-ins`,
    `--allow-empty`, or `--watch`. The first three are incoherent (a
    zero-filled or partial current scan makes the delta meaningless); the
    last is a different lifecycle.
  - `--dry-run` is implicit (no DB writes happen anyway), so the combo is
    silently allowed as a no-op.
  - `--strict` and `--no-tokens` are honoured — they affect what the
    fresh scan produces, which then drives the delta.

  **Kernel surface**:

  - New module `src/kernel/scan/delta.ts` exporting `computeScanDelta`,
    `isEmptyDelta`, `IScanDelta`, `INodeChange`, `TNodeChangeReason`.
  - Re-exported from `src/kernel/index.ts` for plugin authors and
    alternative drivers.

  **Tests** (`src/test/scan-compare.test.ts`, 12 cases): identical fixture
  → empty delta exit 0; body / frontmatter edits surface with the right
  reason; new file → added node + added link; deleted file → removed node;
  `--json` shape matches `IScanDelta`; missing / non-JSON / schema-violating
  dumps exit 2; combo rejections for `--changed`, `--no-built-ins`,
  `--watch`. Test count: 351 → **363** (+12).

  **No spec change**: the `sm scan --compare-with <path>` row in
  `spec/cli-contract.md` was already in place since Step 0a. This is pure
  runtime catch-up — wiring the verb that the spec already promised.

- 13727a3: Step 8.3 — `sm export <query> --format <json|md|mermaid>` real implementation

  Third and final sub-step of Step 8 (Diff + export). Replaces the stub
  with a real verb that filters the persisted graph through a minimal
  query language and emits the resulting subset as JSON or Markdown.
  **Step 8 is now fully closed.**

  **Query syntax** (v0.5.0; spec calls it "implementation-defined pre-1.0"):

  - Whitespace-separated `key=value` tokens; AND across keys.
  - Values within one token are comma-separated; OR within one key.
  - Keys: `kind` (skill / agent / command / hook / note), `has` (`issues`
    today; `findings` / `summary` reserved for Steps 10 / 11), `path`
    (POSIX glob — `*` matches a single segment, `**` matches across
    segments).
  - Empty query (`""`) is valid and exports every node.

  Examples:

  sm export "kind=command" --format json
  sm export "kind=skill,agent has=issues" --format md
  sm export "path=.claude/commands/\*\*" --format json
  sm export "" --format md

  **Subset semantics** (recorded in `src/kernel/scan/query.ts`):

  - A node passes when every specified filter matches (AND across keys,
    OR within values).
  - Links survive only when BOTH endpoints are in the filtered set — the
    exported subgraph is closed. Boundary edges would confuse "I asked
    for a focused view" with "I asked for the focus and its neighbours".
  - Issues survive when ANY of their `nodeIds` is in scope. Cross-cutting
    issues (e.g. `trigger-collision` over two advertisers) stay visible
    even when the user filtered to one of the parties — that's the
    scenario where the user actively wants to see the conflict.

  **Format support at v0.5.0**:

  - `json` — emits `{ query, filters, counts: {nodes, links, issues},
nodes, links, issues }`. Schema is implementation-defined pre-1.0
    per `spec/cli-contract.md` and intentionally not pinned to a separate
    `export.schema.json` until consumers materialise.
  - `md` — Markdown report grouped by node kind (same `KIND_ORDER` as the
    ASCII renderer for visual consistency); per-node issue counts inline;
    separate `## links` and `## issues` sections.
  - `mermaid` — exits 5 with a clear pointer to Step 12 (when the mermaid
    renderer lands as a built-in). Surfacing it now would require a
    synthesis layer this verb shouldn't carry.

  **Exit codes** (per `spec/cli-contract.md` §Exit codes):

  - `0` — render succeeded.
  - `5` — DB missing OR unsupported format OR invalid query.

  **Kernel surface**:

  - New module `src/kernel/scan/query.ts` exporting `parseExportQuery`,
    `applyExportQuery`, `IExportQuery`, `IExportSubset`, and
    `ExportQueryError`. Pure (no IO). Re-exported from `src/kernel/index.ts`
    for plugin authors and alternative drivers.
  - Micro-glob → RegExp converter rolled in-module (zero-deps; supports
    `*` and `**` only). The grammar is intentionally minimal so the spec
    doesn't bind us to a specific glob library before v1.0.

  **Wiring**:

  - New command at `src/cli/commands/export.ts`.
  - Registered in `src/cli/entry.ts`.
  - Removed from `STUB_COMMANDS` in `src/cli/commands/stubs.ts`.
  - `context/cli-reference.md` regenerated via `npm run cli:reference`;
    `cli:check` stays green.

  **Tests** (`src/test/export-cli.test.ts`, 26 cases across two suites):

  - `parseExportQuery` unit tests (12): empty / whitespace / kind /
    multi-value / has / path / combined / unknown key / unknown kind /
    unknown has / malformed token / empty value list / duplicate key.
  - `applyExportQuery` semantic tests (7): empty query → everything;
    kind filter + closed subgraph; has=issues; path glob with `*` and
    `**`; AND across keys; ANY-nodeId rule for issues.
  - `ExportCommand` handler tests (7): default JSON, kind filter, MD
    rendering, mermaid → exit 5, unsupported format → exit 5, invalid
    query → exit 5, missing DB → exit 5.

  Total: 363 → **389** (+26).

  **No spec change**: the `sm export <query> --format json|md|mermaid` row
  in `spec/cli-contract.md` was already in place since Step 0a. This is
  pure runtime catch-up — wiring the verb that the spec already promised.

### Patch Changes

- b067f35: Runtime catch-up — thread `mode: 'deterministic'` explicitly through the built-in detectors and rules

  The execution-modes spec lift (separate changeset, `@skill-map/spec` major)
  defined the per-kind capability matrix and added the optional `mode` field
  to `Detector` / `Rule` schemas with default `deterministic`. Manifests stayed
  valid without an update because the field is optional, but the project
  policy is to thread the mode explicitly so a future probabilistic extension
  is a visible deviation, not a silent flip of the default.

  **Runtime changes**:

  - `src/kernel/types.ts` — new exported type
    `TExecutionMode = 'deterministic' | 'probabilistic'` mirroring
    `spec/architecture.md` §Execution modes. Re-exported from
    `src/kernel/extensions/index.ts` so plugin authors importing from the
    kernel barrel get it.
  - `src/kernel/extensions/detector.ts` — `IDetector` gains optional
    `mode?: TExecutionMode`. Optional matches the schema (default
    `deterministic`); existing third-party detectors compile unchanged.
  - `src/kernel/extensions/rule.ts` — `IAnalyzer` gains optional
    `mode?: TExecutionMode`. Same defaulting story; the prior "rules MUST
    be deterministic" claim in the doc-comment dropped to match the schema
    rewrite.
  - All four built-in detectors (`frontmatter`, `slash`, `at-directive`,
    `external-url-counter`) and all four built-in rules
    (`trigger-collision`, `broken-ref`, `superseded`, `link-conflict`) now
    declare `mode: 'deterministic'` explicitly.
  - `validate-all` audit, `claude` adapter, and `ascii` renderer are
    intentionally untouched — audits derive mode from `composes[]` at load
    time, and adapters / renderers are deterministic-only at the system
    boundaries (the schemas forbid the field on those three kinds).

  **New test** (`src/test/built-ins-modes.test.ts`, 5 cases) asserts the
  invariant: every built-in detector and rule declares
  `mode: 'deterministic'`; the audit / adapter / renderer manifests do NOT
  declare the field. Locks the project policy as a compile-time + runtime
  guarantee. Test count: 341 → **346** (+5).

  **No behavioural change**: the orchestrator does not yet consult
  `mode` — every built-in is already deterministic, and the kernel routing
  that rejects probabilistic extensions from scan-time hooks lands with
  the first probabilistic extension at Step 10. Today the field is
  metadata that consumers (`sm plugins doctor`, future `sm extensions
list --mode probabilistic`, the UI inspector) can read.

  **Why patch (not minor)**: pure runtime catch-up to a spec change that
  already shipped. No new public API, no new verb, no new behaviour. The
  optional `mode?` on `IDetector` / `IAnalyzer` is a backwards-compatible
  additive widen — existing code that constructs these objects keeps
  compiling without an update.

- Updated dependencies [d730094]
- Updated dependencies [a73f3f4]
- Updated dependencies [a73f3f4]
  - @skill-map/spec@1.0.0

## 0.3.3

### Patch Changes

- 16e782a: Fix `tsc --noEmit` regressions surfaced by CI after the Step 6
  follow-up commits (`7d4b143`, `4669267`). The commits validated
  through `tsup` (which does not enforce `noUncheckedIndexedAccess` /
  `exactOptionalPropertyTypes`) but tripped CI's stricter `npm run
typecheck` step. Eight TS errors across six files; runtime behaviour
  unchanged.

  **Type fixes**:

  - `src/cli/commands/config.ts` — `setAtPath` / `deleteAtPath` /
    `pruneEmptyAncestors` indexed `segments[i]` directly under
    `noUncheckedIndexedAccess`. Added an early-return guard for
    empty paths and non-null assertions on segment access.
  - `src/cli/commands/init.ts` — `GITIGNORE_ENTRIES as const` narrowed
    `length` to `2`, making the pluralization branch (`=== 1`) a TS
    "no-overlap" error. Dropped `as const` and typed it as
    `readonly string[]`.
  - `src/cli/commands/plugins.ts` — `TogglePluginsBase` extends
    Clipanion's `Command` but never implemented the abstract
    `execute()`. Marked the class `abstract` so only its concrete
    subclasses (`PluginsEnableCommand` / `PluginsDisableCommand`)
    need to implement it.
  - `src/kernel/config/loader.ts` — direct cast between
    `IEffectiveConfig` and `Record<string, unknown>` is no longer
    accepted; routed through `unknown` at both `deepMerge` call
    sites.
  - `src/kernel/scan/ignore.ts` — under `exactOptionalPropertyTypes`,
    `IBuildIgnoreFilterOptions` did not accept `undefined` even
    though the runtime tolerated it. Widened the three optional
    fields to `T | undefined` so callers can forward
    `readIgnoreFileText()` (which returns `string | undefined`)
    without a guard.
  - `src/test/config-loader.test.ts` — `match(warnings[0], …)`
    failed under `noUncheckedIndexedAccess`; added non-null
    assertions (the lines above already verify `length === 1`).

  **Prevention** — encadenar typecheck antes del test runner:

  - `src/package.json` — `test` and `test:ci` now run
    `tsc --noEmit && node --import tsx --test ...`. Local `npm test`
    picks up strict-mode regressions immediately instead of waiting
    for CI.

  Test count unchanged: 312 of 312 pass.

- f41dbad: Step 6.2 — Layered config loader for `.skill-map/settings.json`. Walks the
  six canonical layers (defaults → user → user-local → project → project-local
  → overrides), deep-merges per key, validates each layer against the
  `project-config` JSON schema, and is resilient per-key: malformed JSON,
  schema violations, and type mismatches emit warnings and skip the offending
  input without invalidating the rest of the layer. Strict mode (`--strict`,
  wired in 6.3+) re-routes every warning to a thrown `Error`.

  **Runtime change**:

  - `src/config/defaults.json` — bundled defaults derived from `project-config.schema.json`
    property descriptions (autoMigrate, tokenizer, scan._, jobs._, history.share, i18n.locale).
  - `src/kernel/config/loader.ts` — `loadConfig(opts)` entry point. Returns
    `{ effective, sources, warnings }`:
    - `effective` — fully merged `IEffectiveConfig`.
    - `sources` — `Map<dotPath, layerName>` so `sm config show --source` (6.3)
      can answer who set what.
    - `warnings` — accumulated diagnostics; empty when the load was clean.
  - Layer dedup: when `scope === 'global'`, project layers (4/5) resolve to
    the same files as user layers (2/3) and are skipped to avoid double-merging
    the same source.
  - Deep-merge semantics: nested objects merge per key; arrays replace whole;
    `null` values are preserved (e.g. `jobs.retention.failed`).
  - Schema-failure handling: AJV errors are walked once; `additionalProperties`
    errors strip the unknown key, type/const/etc. errors strip the offending
    leaf. The cleaned object is then merged so a single bad value never
    invalidates the rest of the layer.
  - No CLI surface yet — `sm config` verbs (6.3) and `--strict` flag
    (6.3+) consume this loader; the API is internal until then.

  **Tests**: `src/test/config-loader.test.ts` covers defaults application,
  five-layer precedence, override layer, global-scope dedup, deep-merge
  nested objects + array replacement + null preservation, malformed-JSON
  warning + skip, unknown-key strip, type-mismatch strip, partial-bad-file
  continues, non-object root rejection, and three strict-mode escalations
  (JSON / schema / unknown-key).

  Test count: 213 → 231 (+18).

- f41dbad: Step 6.3 — `sm config list / get / set / reset / show` go from
  stub-printing-"not implemented" to real implementations. The five verbs
  share the layered loader from 6.2 and gain a `--strict` flag on
  the read side that escalates merge warnings to fatal errors.

  **Runtime change**:

  - `src/cli/commands/config.ts` — five Clipanion commands plus shared
    helpers (`getAtPath`, `setAtPath`, `deleteAtPath` with empty-parent
    pruning, JSON-first value coercion, dot-path → human formatter).
  - `src/cli/commands/stubs.ts` — five `Config*Command` classes removed;
    `STUB_COMMANDS` array shrunk; replaced-at-step comment kept.
  - `src/cli/entry.ts` — registers the new `CONFIG_COMMANDS` array.
  - `context/cli-reference.md` — regenerated from `sm help --format md`;
    CLI version line now reflects the live `0.3.x` value (the file had
    drifted at PR #12 against the prior stub descriptions).

  **Verb semantics**:

  - `sm config list [--json] [-g] [--strict]` — prints the merged
    effective config. Human mode emits sorted `key.path = value` lines;
    `--json` emits the JSON object. Exempt from `done in <…>` per
    `spec/cli-contract.md` §Elapsed time.
  - `sm config get <key> [--json] [-g] [--strict]` — leaf value
    by dot-path. Unknown key → exit 5. `--json` wraps in JSON literals
    so callers can pipe into `jq`. Exempt from elapsed-time.
  - `sm config show <key> [--source] [--json] [-g] [--strict]` —
    identical to `get` plus optional `--source` that surfaces the winning
    layer (`defaults / user / user-local / project / project-local /
override`). For nested objects, the highest-precedence descendant
    wins. `--source --json` emits `{ value, source }`. Exempt from
    elapsed-time.
  - `sm config set <key> <value> [-g]` — writes to project file by
    default; `-g` writes to user file. JSON-parses the raw value first so
    CLI ergonomics produce booleans / numbers / arrays / objects naturally
    (unparseable falls through as plain string). Result is re-validated
    against `project-config.schema.json`; schema violation → exit 2 with
    the file untouched. In-scope verb — emits `done in <…>` to stderr.
  - `sm config reset <key> [-g]` — strips the key from the target file;
    prunes now-empty parent objects so the file stays tidy. Idempotent —
    absent key prints "No override at <path>" and exits 0. In-scope verb.

  **Tests**: `src/test/config-cli.test.ts` exercises every verb through
  the real `bin/sm.mjs` binary with isolated `HOME` and `cwd` per test:
  list defaults / project / `--json`, get leaf / object / `--json` /
  unknown-key, show `--source` on leaf and nested object, show `--source
--json`, show without `--source`, set project default + `-g` + nested
  dot-path + invalid → exit 2 + preserves siblings + emits `done in`,
  reset basic + idempotent absent + `-g` + parent-pruning.

  Test count: 231 → 252 (+21).

- f41dbad: Step 6.4 — `.skill-mapignore` parser + scan walker integration.
  Layered ignore filter composes bundled defaults + `config.ignore`
  (from `.skill-map/settings.json`) + `.skill-mapignore` file content;
  the walker honours it so reorganising `node_modules`, `dist`, drafts,
  or any user-defined private dir keeps them out of the scan in one
  predictable place.

  **New dependency**: `ignore@7.0.5` (zero-deps, MIT, gitignore-spec
  compliant — same library used by eslint, prettier). Pinned exact per
  AGENTS.md.

  **Runtime change**:

  - `src/config/defaults/skill-mapignore` — bundled defaults file shipped
    with the CLI (`.git/`, `node_modules/`, `dist/`, `build/`, `out/`,
    `.next/`, `.cache/`, `.tmp/`, `.skill-map/`, `*.log`, `.DS_Store`,
    `Thumbs.db`, `*.swp`, `*~`). Copied into `dist/config/defaults/` by
    tsup `onSuccess`.
  - `src/kernel/scan/ignore.ts` — `buildIgnoreFilter({ configIgnore?,
ignoreFileText?, includeDefaults? })` returns an `IIgnoreFilter` with
    one method, `ignores(relativePath)`. Layer order is fixed: defaults
    → `configIgnore` → `ignoreFileText`. Bundled defaults loaded once
    (module-level cache); resolves a small candidate-list of paths to
    cover both the dev layout (`src/`) and the bundled layout (`dist/`).
  - `src/kernel/scan/ignore.ts` also exports `readIgnoreFileText(scopeRoot)`
    — convenience to read `<scopeRoot>/.skill-mapignore` and feed it to
    `buildIgnoreFilter`.
  - `src/kernel/extensions/adapter.ts` — `IAdapter.walk` signature
    changes: `options.ignore?: string[]` → `options.ignoreFilter?:
IIgnoreFilter`. The old shape was unused (no caller passed it), so
    no compat shim ships.
  - `src/extensions/adapters/claude/index.ts` — walker tracks the
    current relative path during recursion and consults the filter for
    every directory and file. The previous hard-coded `DEFAULT_IGNORE`
    set is removed; the bundled defaults provide the same baseline.
    Adapters that omit `ignoreFilter` get the bundled-defaults filter as
    a defensive fallback, so kernel-empty-boot and direct adapter tests
    still skip `.git` / `node_modules` / `.tmp`.
  - `src/kernel/orchestrator.ts` — `RunScanOptions.ignoreFilter?:
IIgnoreFilter` plumbed through to every `adapter.walk(...)` call.
  - `src/cli/commands/scan.ts` — `ScanCommand` loads layered config and
    composes the filter from `cfg.ignore` + the project's
    `.skill-mapignore`, then passes it via `runOptions.ignoreFilter`.

  **Tests**: `src/test/scan-ignore.test.ts` — 14 tests covering filter
  defaults (skip / preserve / empty path), `configIgnore` patterns and
  directory globs, ignore-file text parsing with comments and blanks,
  three-layer combination including negation that respects gitignore's
  "can't re-include from excluded directory" rule, `includeDefaults:
false` opt-out, `readIgnoreFileText` present / missing, plus four
  end-to-end runScan integrations (`.skill-mapignore` excludes drafts,
  `config.ignore` excludes a private dir, defaults still skip
  `node_modules` / `.git` without extra config, file-glob negation
  re-includes a single file inside an otherwise-excluded directory).

  Test count: 252 → 266 (+14).

- 8a4667f: Step 6.5 — `sm init` scaffolding. Replaces the
  "not-implemented" stub with a real bootstrap verb that provisions
  everything Step 6 has built so far in one command:

  - `<scopeRoot>/.skill-map/` directory.
  - `settings.json` with `{ "schemaVersion": 1 }` (minimal, validated
    against `project-config.schema.json`).
  - `settings.local.json` with `{}` (placeholder for personal overrides;
    appended to `.gitignore` so it never gets committed).
  - `.skill-mapignore` at the scope root, copied byte-for-byte from
    `src/config/defaults/skill-mapignore`.
  - `<scopeRoot>/.skill-map/skill-map.db` provisioned via
    `SqliteStorageAdapter.init()` (auto-applies kernel migrations).
  - First scan: walks the scope, persists `scan_*` tables. Exit code
    mirrors `sm scan` — 1 if any `error`-severity issues land.

  Project scope (default = cwd): also appends two entries to
  `<cwd>/.gitignore` (`.skill-map/settings.local.json`,
  `.skill-map/skill-map.db`); creates the file if missing, leaves
  existing entries untouched, never duplicates. Comments and blank
  lines in an existing `.gitignore` survive.

  Global scope (`-g`): same scaffolding under `$HOME/.skill-map/`. No
  `.gitignore` is written — `$HOME` isn't a repo.

  Re-running over an existing scope errors with exit 2 unless `--force`
  is passed. `--no-scan` skips the first scan (useful in CI where the
  operator wants to provision before populating roots). `--force`
  overwrites `settings.json`, `settings.local.json`, and `.skill-mapignore`
  but keeps the DB and any other state in `.skill-map/`.

  **Runtime change**:

  - `src/cli/commands/init.ts` — new file. The `runFirstScan` helper
    loads the layered config, builds the ignore filter
    (defaults + `config.ignore` + the `.skill-mapignore` it just wrote),
    runs `runScanWithRenames`, and persists. Inline (not subprocess) so
    the parent owns the elapsed line and stdio cleanly.
  - `src/cli/commands/stubs.ts` — `InitCommand` removed; replaced-at-step
    comment kept.
  - `src/cli/entry.ts` — registers the new `InitCommand`.
  - `src/kernel/scan/ignore.ts` — new `loadBundledIgnoreText()` export;
    re-uses the module-level cache so `sm init` reads the defaults file
    once across the process lifetime.
  - `context/cli-reference.md` — regenerated; init's flag table and
    examples block now appear in the reference.

  **Tests**: `src/test/init-cli.test.ts` — 7 tests through the real
  binary covering project-scope scaffolding (files present, schemaVersion
  set, ignore template populated), `.gitignore` create-when-missing,
  `.gitignore` merge without duplicating an existing entry, re-init
  blocked without `--force`, `--force` overwrites, default first-scan
  finds and counts a seeded `.claude/agents/foo.md`, global scope under
  `HOME/.skill-map/` with no `.gitignore` written and no leakage into
  `cwd`.

  Test count: 266 → 273 (+7).

- 8a4667f: Step 6.6 — `sm plugins enable / disable` + the `config_plugins`
  override layer they read from. The two stub verbs become real, and
  the `PluginLoader` finally honours user intent: a disabled plugin
  surfaces in `sm plugins list` with status `disabled`, but its
  extensions are NOT imported and the kernel will not run them.

  **Decision (recorded in spec)**: enable/disable resolution favours the
  DB row over `settings.json` over the installed default. The DB
  override is local-machine; `settings.json` is the team-shared baseline.
  A developer can locally disable a misbehaving plugin without
  committing the toggle to the team's config; conversely, a baseline
  that explicitly enables a plugin is overridable per-machine. The rule
  is documented in `spec/db-schema.md` §`config_plugins`.

  **Spec change (additive, patch)**:

  - `spec/db-schema.md` — appended an "Effective enable/disable
    resolution" subsection under `config_plugins` documenting the
    three-layer precedence (DB > `settings.json` > installed default).
    No schema changes; the `config_plugins` table itself was already
    defined in the initial migration.

  **Runtime change**:

  - `src/kernel/types/plugin.ts` — `TPluginLoadStatus` gains a `disabled`
    variant. JSDoc explains all five states.
  - `src/kernel/adapters/sqlite/plugins.ts` — new file. Storage helpers
    over the `config_plugins` table: `setPluginEnabled` (upsert),
    `getPluginEnabled` (single read), `loadPluginOverrideMap` (bulk
    read for one round-trip per process), `deletePluginOverride`
    (idempotent drop, used by future `sm config reset plugins.<id>`).
  - `src/kernel/config/plugin-resolver.ts` — new file.
    `resolvePluginEnabled` implements the precedence above;
    `makeEnabledResolver` curries the layered config and DB map into
    the `(id) => boolean` shape `IPluginLoaderOptions.resolveEnabled`
    expects.
  - `src/kernel/adapters/plugin-loader.ts` — new optional
    `resolveEnabled` callback in `IPluginLoaderOptions`. When supplied,
    the loader checks AFTER manifest + specCompat validation and
    short-circuits with `status: 'disabled'` (manifest preserved,
    extensions array omitted, reason `"disabled by config_plugins or
settings.json"`). Omitting the callback keeps the legacy "always
    load" behaviour for tests / kernel-empty-boot.
  - `src/cli/commands/plugins.ts` — wires the loader to the resolver:
    every read (`list / show / doctor`) loads `config_plugins` once and
    feeds the resolver. Two new commands `PluginsEnableCommand` and
    `PluginsDisableCommand` write to the DB. `--all` toggles every
    discovered plugin; `<id>` and `--all` are mutually exclusive.
    `sm plugins doctor` now treats `disabled` as intentional (does not
    contribute to the issue list, does not flip exit code).
  - `src/cli/commands/plugins.ts` — adds `off` to the status icon legend
    in human output (`off  mock-a@0.1.0 · disabled by config_plugins or
settings.json`).
  - `src/cli/commands/stubs.ts` — `PluginsEnableCommand` and
    `PluginsDisableCommand` removed; replaced-at-step comment kept.
  - `context/cli-reference.md` — regenerated; the two new verbs appear
    with their flag tables.

  **Tests**:

  - `src/test/plugin-overrides.test.ts` — 8 unit tests covering storage
    round-trip (upsert + read), `loadPluginOverrideMap` bulk read,
    `deletePluginOverride` idempotency, resolver precedence (default ⇒
    true, `settings.json` overrides default, DB overrides
    `settings.json`), `makeEnabledResolver` currying, and PluginLoader
    surfacing `disabled` status with manifest preserved + no extensions
    - omitting the resolver still loads.
  - `src/test/plugins-cli.test.ts` — 9 end-to-end tests via the binary:
    `disable <id>` writes a DB row + `sm plugins list` reflects `off`,
    `enable <id>` flips back, `--all` covers every discovered plugin,
    unknown id → exit 5, no-arg → exit 2, both `<id>` and `--all` →
    exit 2, `settings.json` baseline overridden by DB `enable`,
    `settings.json` baseline applies when DB has no row, and
    `sm plugins doctor` exits 0 when the only non-loaded plugin is
    intentionally disabled.

  Test count: 273 → 291 (+18).

- 8a4667f: Step 6.7 — Frontmatter strict mode. The orchestrator now validates each
  node's parsed frontmatter against `frontmatter/<kind>.schema.json`
  during `sm scan` and emits a `frontmatter-invalid` issue when the shape
  doesn't conform. Severity is `warn` by default (scan still exits 0);
  `--strict` (CLI) or `scan.strict: true` (config) promote every such
  finding to `error` so the scan exits 1.

  **Runtime change**:

  - `src/kernel/adapters/schema-validators.ts` — registers
    `frontmatter-skill / -agent / -command / -hook / -note` as named
    top-level validators (they were already loaded as supporting schemas
    via the AJV `$ref` graph; this step exposes them through the
    `validate(name, data)` surface). Reuses the module-level cache from
    Step 5.12 — the validators compile once per process.
  - `src/kernel/orchestrator.ts` — new `RunScanOptions.strict?: boolean`
    field. After each adapter yields a node, the orchestrator validates
    the parsed frontmatter (skipping when no `---` fence is present, so
    fence-less notes stay clean). A failure produces a single
    `frontmatter-invalid` issue with `severity: 'warn' | 'error'` per
    the `strict` flag, the path in `nodeIds`, the AJV error string in
    `message`, and `data: { kind, errors }` for downstream tools.
    Issues collected during the walk land in the result alongside the
    rule-emitted ones.
  - Incremental-scan (`--changed`) preservation: a per-path
    `priorFrontmatterIssuesByNode` index walks the prior result once;
    on a cache hit, the previously-emitted frontmatter issue is re-pushed
    (re-validating would be wasted work since `frontmatterHash` is
    unchanged). The `strict` flag still applies on the second pass — a
    cached `warn` from the first scan becomes `error` on a strict
    re-run.
  - `src/cli/commands/scan.ts` — new `--strict` flag. The CLI also reads
    `cfg.scan.strict` (already in the project-config schema since 0.1)
    and passes `strict: this.strict || cfg.scan.strict === true` to
    `runScan`. CLI flag wins when both are set.
  - `context/cli-reference.md` — regenerated; `--strict` appears under
    `sm scan` with its description.

  **Tests**:

  - `src/test/scan-frontmatter-strict.test.ts` — 12 tests covering
    fence-less files (no issue), fenced-but-incomplete frontmatter
    (warn issue, message names the missing field), `strict: true`
    promotion to error, valid frontmatter (no issue), type-mismatch
    on a base field (`name: 42` flagged), per-kind schemas
    (skill / command / hook / note each emit one issue with the
    matching `data.kind`), incremental preservation of the cached
    issue, incremental + strict promotion, and four CLI tests via
    the binary (`sm scan` exit 0 with warnings, `--strict` → exit 1,
    `scan.strict: true` config → exit 1, `--strict` overrides
    `scan.strict: false` config).
  - `src/test/scan-readers.test.ts` — `rollback.md` fixture extended to
    include `description` + `metadata` so the `--issue` filter test
    remains semantically correct (rollback.md is the issue-free node).
  - `src/test/scan-benchmark.test.ts` — 500-MD perf budget bumped from
    2000ms → 2500ms with a comment explaining the AJV per-file cost
    (~50-80μs × 500 = ~25-40ms over the prior ceiling). Warm-scan
    reality on a developer laptop stays around 1.0-1.2s; the new
    ceiling preserves headroom for slow CI without lowering the bar.

  Test count: 291 → 303 (+12).

- 7d4b143: Step 6 follow-up — unify the `--strict-config` flag (introduced in 6.2
  for the layered loader) with the existing `--strict` flag (introduced
  in 6.7 for frontmatter validation). One name, same intent across every
  verb that touches user input: "fail loudly on any validation
  warning".

  **CLI surface change** (renamed flag, same Option.Boolean):

  - `sm config list / get / show` — `--strict-config` → `--strict`.
  - `sm scan --strict` — already did frontmatter strict; now ALSO
    propagates strict to `loadConfig` so a bogus key in
    `settings.json` aborts the scan instead of being silently
    skipped.
  - `sm init --strict` — new. Propagates strict to BOTH the loader
    (so user-layer warnings during the first-scan path become
    fatal) and the first-scan's frontmatter validator. Affects only
    the path that actually loads config — `sm init --no-scan`
    skips the loader entirely so `--strict` has nothing to enforce
    there.

  The user-visible motivation: one flag to remember. Internally each
  verb still routes the boolean to whichever validations are reachable
  from its execution path; the conflated name reflects the conflated
  intent ("strict mode = no silent input fixups").

  **Runtime change**:

  - `src/cli/commands/config.ts` — `Option.Boolean('--strict-config',
false)` becomes `Option.Boolean('--strict', false)` in three
    commands (list / get / show). Local field renamed `strictConfig`
    → `strict`. Module JSDoc rewritten to point at the unified
    contract.
  - `src/cli/commands/scan.ts` — `loadConfig` call in `ScanCommand`
    now passes `strict: this.strict` and is wrapped in a try/catch
    emitting `sm scan: <message>` + exit 2 on throw, matching the
    config-verbs UX from the prior follow-up.
  - `src/cli/commands/init.ts` — new `Option.Boolean('--strict',
false)` on `InitCommand`; threaded through `runFirstScan` to
    both the `loadConfig` call (try/catch) and the `runScan` options.
  - `context/cli-reference.md` — regenerated; `sm init --strict` flag
    description now appears in the reference.

  **Spec / docs**:

  - `ROADMAP.md` — every `--strict-config` reference renamed to
    `--strict` (header status, §Configuration body, completeness
    marker, Step 14 `sm ui` flag list).
  - `ui/src/models/settings.ts` JSDoc — same rename.
  - `.changeset/step-6-2-config-loader.md`,
    `.changeset/step-6-3-config-verbs.md`,
    `.changeset/step-6-followup-version-strict-config.md` — all
    flag mentions in pending changeset bodies updated so the
    generated CHANGELOG entries match the shipping flag name.

  **Tests**:

  - `src/test/config-cli.test.ts` — `--strict-config` references in
    the existing `sm config — --strict UX` describe block renamed to
    `--strict`. Test count unchanged.
  - `src/test/scan-frontmatter-strict.test.ts` — new
    `--strict unification` describe block with two end-to-end CLI
    tests: `sm scan --strict` aborts on a bogus loader key (and
    the lenient `sm scan` still tolerates it), and `sm init --strict`
    surfaces the same bogus key during the first-scan path.

  Test count: 310 → 312 (+2).

  No `@skill-map/spec` change — the rename is CLI-only; the spec never
  defined the flag (only the feature semantics).

- 4669267: Step 6 follow-up — two UX polish fixes surfaced during the post-Step-6
  manual walkthrough.

  **`sm version` db-schema field**: was hardcoded `'—'` (carried over from
  Step 1a as a placeholder). The command now resolves the project DB path
  via the shared `resolveDbPath` helper, opens the DB read-only when it
  exists, and reads `PRAGMA user_version` (kept in sync by the migrations
  runner since Step 1a). Returns `'—'` for every failure mode (missing
  DB, unreadable file, malformed pragma) so an informational verb can
  never crash on a bad DB.

  - Pre-fix: `db-schema —` regardless of DB state.
  - Post-fix: `db-schema —` when no DB; `db-schema 2` after `sm init`
    (= MAX kernel migration version applied).

  **`sm config --strict` UX**: the loader's strict-mode `throw`
  was reaching Clipanion's default error handler, producing "Internal
  Error: ..." with a five-line stack trace and exit code 1. Now wrapped
  in a per-command `tryLoadConfig` helper that catches the throw, writes
  a one-line `sm config: <message>` to stderr, and returns exit code 2
  (operational error) per `spec/cli-contract.md` §Exit codes. Applied to
  `sm config list`, `sm config get`, and `sm config show` — every read
  verb that exposes `--strict`.

  - Pre-fix: stack trace + exit 1.
  - Post-fix: clean stderr line + exit 2.

  **Runtime change**:

  - `src/cli/commands/version.ts` — new `resolveDbSchemaVersion()` helper
    uses `node:sqlite` `DatabaseSync` in read-only mode + `PRAGMA
user_version`. Three failure paths all collapse to `'—'`. JSDoc
    expanded with the resolution contract.
  - `src/cli/commands/config.ts` — new `tryLoadConfig()` private wrapper
    catches `loadConfig` throws (only emitted under `--strict`).
    Three call sites in `ConfigListCommand`, `ConfigGetCommand`, and
    `ConfigShowCommand` updated to early-return with the wrapper's exit
    code.

  **Tests**:

  - `src/test/cli.test.ts` — two new tests under the existing `CLI binary`
    suite: `sm version` shows `db-schema —` when no DB exists in cwd
    (uses `EMPTY_DIR`), and reports the numeric `user_version` after
    `sm init --no-scan` provisions a DB in a tmpdir. Test asserts the
    number matches `\d+` and is `>= 1` rather than pinning a specific
    value, so it survives future kernel migrations.
  - `src/test/config-cli.test.ts` — new `sm config — --strict UX`
    describe block (5 tests): warning + exit 0 without the flag,
    clean-message + exit 2 with the flag (and explicit assertion that
    no `Internal Error` / stack-trace lines leak through), wrapper
    applied uniformly to `list / get / show`, and malformed-JSON path
    also routes through the clean-error path.

  Test count: 303 → 310 (+7).

- Updated dependencies [f41dbad]
- Updated dependencies [8a4667f]
  - @skill-map/spec@0.6.1

## 0.3.2

### Patch Changes

- dacd4d9: Move the auto-generated CLI reference from `docs/cli-reference.md` to
  `context/cli-reference.md`. Spec change is editorial: `cli-contract.md`
  references the file path in three spots (`--format md` description, the
  NORMATIVE introspection section, and the "Related" link list); all three
  updated to the new location. No schema or behavioural change.

  Reference impl: `scripts/build-cli-reference.mjs` writes to the new path,
  the `cli:reference` / `cli:check` npm scripts point there, and `sm help`
  output (which embeds the path in the `--format md` flag description) is
  regenerated. The `docs/` folder is gone.

- 551f6ec: Persist scan results to SQLite (scan_nodes/links/issues).

  `sm scan` now writes the ScanResult into `<cwd>/.skill-map/skill-map.db`
  with replace-all semantics across `scan_nodes`, `scan_links`, and
  `scan_issues`. The DB is auto-migrated on first run. Persistence is
  skipped under `--no-built-ins` so the kernel-empty-boot conformance
  probe cannot wipe an existing snapshot.

  Also fixes the bundled-CLI default migrations directory: the prior
  resolver assumed an unbundled `kernel/adapters/sqlite/` path layout,
  which silently missed `dist/migrations/` in the tsup-bundled CLI.

- 4c34af1: Step 4.10 — scenario coverage. Pure regression-test growth, no behavior
  changes, no new dependencies, no migrations, no spec edits. Backfills
  the scenarios surfaced by the manual end-to-end validation in
  `.tmp/sandbox/` that the existing test suite did not codify:

  - Hash discrimination: body-only edits leave `frontmatter_hash` and
    `bytes_frontmatter` byte-equal; frontmatter-only edits leave
    `body_hash` and `bytes_body` byte-equal. Locks in that the two
    SHA-256 streams are independent.
  - `external_refs_count` lifecycle across body edits: 0 → 2 → 2 (dedup) →
    1 (malformed URL silently dropped), and `scan_links.target_path`
    never carries an `http(s)` value at any step.
  - Replace-all ID rotation: synthetic `scan_links.id` /
    `scan_issues.id` are not promised to round-trip across re-scans;
    the natural keys (source/kind/target/normalized-trigger and
    analyzerId/nodeIds) do. Documents the contract via assertion.
  - Deletion-driven dynamic broken-ref re-evaluation, full-scan path:
    companion to the existing incremental-path test. Confirms rules
    always re-run over the merged graph even on the all-fresh path.
  - Trigger-collision interaction with `--changed`: editing one
    advertiser keeps the collision firing (cached node still claims
    the trigger); deleting one advertiser clears it.
  - `sm scan --no-tokens` at the CLI handler level (the existing test
    exercised the orchestrator only): default → `tokens_total`
    populated; `--no-tokens` → null; default again → repopulated.
  - `sm scan --changed --no-built-ins` rejection: exit 2 with an
    explanatory stderr, no DB I/O.

  Test count delta: 133 → 143.

- 4c34af1: Step 4.11 — three layers of defense against accidental DB wipes when
  `sm scan` receives invalid or empty inputs:

  - `runScan` validates every root path exists as a directory before
    walking, throwing on the first failure (was: silently yielded zero
    files via the claude adapter swallowing `ENOENT` in `readdir`).
  - `sm scan` surfaces the validation error with exit code 2 and a clear
    stderr message naming the bad path.
  - `sm scan` refuses to overwrite a populated DB with a zero-result scan
    unless `--allow-empty` is passed. Prevents the typo-trap reported in
    the e2e validation: `sm scan -- --dry-run` (where clipanion's `--`
    made `--dry-run` a positional root that did not exist) silently
    cleared the user's data. The new flag is opt-in by design — the
    natural case of "empty repo on first scan" is preserved (DB starts
    empty, scan returns 0 rows, persist proceeds without prompting).

  Test count delta: 143 → 151.

- 551f6ec: Compute per-node token counts via `js-tiktoken`.

  `runScan` now populates `node.tokens` (frontmatter / body / total) using
  the `cl100k_base` BPE — the modern OpenAI tokenizer used by
  GPT-4 / GPT-3.5-turbo. The encoder is constructed once per scan and
  reused across nodes (the BPE table is heavyweight to load). Tokens are
  computed against the raw frontmatter bytes (not the parsed YAML
  object) so the count stays reproducible from on-disk content.

  The new `sm scan --no-tokens` flag opts out of tokenization; `node.tokens`
  is left undefined, which is spec-valid because the field is optional in
  `spec/schemas/node.schema.json`. Persistence already handles the absence
  (maps to NULL across `tokens_frontmatter` / `tokens_body` / `tokens_total`).

- 551f6ec: Add `external-url-counter` detector and orchestrator-level segregation for
  external pseudo-links.

  The new detector scans node bodies for `http(s)://` URLs, normalizes them
  (lowercase host, drop fragment, preserve scheme / port / path / query),
  dedupes per node, and emits one `references` pseudo-link per distinct URL
  at `low` confidence. URL parsing uses Node's built-in WHATWG `URL` — no
  new dependency.

  `runScan` now partitions emitted links into internal (graph) and external
  (URL pseudo-link) sets by checking `target.startsWith('http://')` or
  `'https://'`. Internal links flow through the rules layer, populate
  `linksOutCount` / `linksInCount`, and land in `result.links` and
  `scan_links` as before. External pseudo-links are counted into
  `node.externalRefsCount` and then dropped — they never reach rules,
  never appear in `result.links`, and never persist to `scan_links`. This
  keeps the spec's `link.kind` enum locked and `scan_links` semantically
  clean (graph relations only) while giving the inspector a cheap "external
  references" badge.

  This is the drop-in proof from Step 2: the kernel boots, detectors plug
  in, and a new built-in extension lands without spec or migration changes.

- 551f6ec: Add `sm scan -n` / `--dry-run` (in-memory, no DB writes) and `sm scan
--changed` (incremental scan against the persisted prior snapshot).

  `-n` / `--dry-run` runs the full pipeline in memory and skips every DB
  operation (no auto-migration, no persistence). The human-mode summary
  now ends with `Would persist N nodes / M links / K issues to <path>
(dry-run).` so the operator sees what would land. `--json` output is
  unchanged.

  `--changed` opens the project DB read-side, loads the prior snapshot via
  the new `loadScanResult` helper, walks the filesystem, and reuses
  unchanged nodes (matched by `path` + `bodyHash` + `frontmatterHash`).
  Only new / modified files run through the detector pipeline; rules
  always re-run over the merged graph (issue state can change for an
  unchanged node when a sibling moves). Persistence semantics are
  unchanged — replace-all over the merged ScanResult — so the on-disk
  shape stays canonical regardless of how the result was assembled.

  Combination rules:

  - `--changed --no-built-ins` is rejected with exit code 2 — a
    zero-filled pipeline has nothing to merge against.
  - `--changed -n` is supported: load the prior, compute the merged
    result, emit it, do NOT persist. Useful for "what would change?"
    inspection.
  - `--changed` against an empty / missing DB degrades to a full scan and
    prints `--changed: no prior snapshot found; running full scan.` to
    stderr. Exit code unaffected.

  Internals: `runScan` gains an optional `priorSnapshot` field on
  `RunScanOptions`. The orchestrator emits `scan.progress` events with a
  new `cached: boolean` field so future UIs can show the
  reused-vs-reprocessed delta. External pseudo-links are never persisted,
  so for cached nodes the prior `externalRefsCount` is preserved as-is;
  new / modified nodes recompute it from a fresh detector pass. The
  `loadScanResult` helper documents the external-pseudo-link omission
  explicitly — it returns zero pseudo-links by definition, but the
  per-node count survives in the loaded node row.

- 551f6ec: Promote `sm list`, `sm show`, `sm check` from stubs to real
  implementations backed by the persisted `scan_*` snapshot.

  `sm list [--kind <k>] [--issue] [--sort-by <field>] [--limit N] [--json]`
  emits a tabular view (PATH / KIND / OUT / IN / EXT / ISSUES / BYTES) of
  every node in `scan_nodes`. `--kind` and `--issue` filter rows; the
  issue filter uses a SQL `EXISTS` over `scan_issues` so the work stays
  in the DB. `--sort-by` is whitelisted (`path`, `kind`, `bytes_total`,
  `links_out_count`, `links_in_count`, `external_refs_count`) — anything
  else exits 2 with a clear stderr message. Numeric columns sort
  descending by default so `--sort-by bytes_total --limit N` returns the
  heaviest nodes; textual columns sort ascending. `--json` emits a flat
  array conforming to `node.schema.json`.

  `sm show <node.path> [--json]` prints the per-node detail view: header
  with kind / adapter, optional title / description / stability /
  version / author lines, the bytes (and tokens, when present) triple
  split, the parsed frontmatter, links out, links in, and current
  issues. `--json` emits `{ node, linksOut, linksIn, issues, findings,
summary }`; `findings` is reserved as `[]` and `summary` as `null`
  until Step 10 (`state_findings`) and Step 11 (`state_summaries`) ship.
  A missing path exits 5 with `Node not found: <path>` on stderr.

  `sm check [--json]` reads every row from `scan_issues`, prints them
  grouped by severity (errors first, then warns, then infos) as
  `[<severity>] <analyzerId>: <message> — <node-paths>`, and exits 1 if any
  issue carries severity `error`, otherwise 0. Equivalent to
  `sm scan --json | jq '.issues'` but without the walk-and-detect cost.
  `--json` emits an `Issue[]`.

  All three verbs honor the `-g/--global` and `--db <path>` global flags,
  and exit 5 with `DB not found at <path>; run \`sm scan\` first.` when
  the snapshot has not been persisted yet.

  Internals: extracted the `resolveDbPath` and DB-existence guard from
  `sm db` into a shared `cli/util/db-path.ts` so the read-side commands
  and the lifecycle commands stay byte-aligned on path resolution.
  Promoted the row→Node / row→Link / row→Issue mappers in
  `scan-load.ts` from private helpers to module exports so the readers
  reuse the exact mapping the incremental loader uses, keeping the
  read-side aligned with the spec schemas.

- 551f6ec: Add Step 4.6 acceptance coverage: a self-scan test and a 500-MD
  performance benchmark.

  `src/test/self-scan.test.ts` runs `runScan` directly against the
  project repo (no persistence — never writes `.skill-map/skill-map.db`)
  with the full built-in pipeline and asserts: `schemaVersion === 1`;
  every node, link, and issue conforms to its authoritative spec
  schema (mirrors the `validate-all` audit's per-element strategy);
  nodes count > 0; the expected node kinds appear (relaxed to allow
  `command` and `hook` as missing today since neither
  `.claude/commands/` nor `.claude/hooks/` exists in the working tree
  — the tolerated-missing set auto-tightens the moment either grows
  a real file); no `error`-severity issues survive; tokens are
  populated for ≥ 1 node (Step 4.2 smoke test); `externalRefsCount > 0`
  for ≥ 1 node (Step 4.3 smoke test). Failures print actionable detail
  (missing kinds present, full per-issue dump) so a regression is
  diagnosable without re-running with extra logging.

  `src/test/scan-benchmark.test.ts` materialises 500 synthetic
  markdown files under `<repo>/.tmp/scan-bench-<random>/` (gitignored,
  project-local per AGENTS.md) — 100 each of agents, commands, hooks,
  skills (with `SKILL.md` per-skill subdir), and notes — each carrying
  a slash invocation, an `@`-directive, and an http URL so every
  detector fires. Ten agents share the same `name` so
  `trigger-collision` has work to do; some commands cross-reference
  each other through `metadata.related[]`. Asserts the full scan
  (tokenize + 4 detectors + 3 rules) completes within a 2000 ms
  budget (measured ~930 ms locally), `nodesCount === 500`, and
  `linksCount > 0`. Always prints a `[bench] 500 nodes / N links / M
issues in Tms` line to stderr so a CI failure surfaces the actual
  measurement, not a bare assertion. Comment above the threshold
  documents the escape hatch (profile cl100k_base cold-start before
  bumping; never disable).

  Adds `.tmp` to the `claude` adapter's `DEFAULT_IGNORE` set so the
  walker never traverses transient AI/test artifacts. Without this,
  the benchmark's fixture would appear in the self-scan and races
  between the two tests would flake the suite. The convention is
  already enforced everywhere else (gitignore, AGENTS.md), so the
  adapter now matches.

  Both tests run inside the standard `npm test` / `npm run test:ci`
  flow; no separate `bench` script is needed (runtime delta well under
  a second).

- 551f6ec: Reconcile the runtime `ScanResult` shape with `spec/schemas/scan-result.schema.json`.

  The runtime has been silently violating the spec since Step 0c. The
  spec is the source of truth and has been correct all along; this change
  is a one-way fix — `src/` catches up to `spec/`. No spec edit, no
  spec changeset.

  What changed at the runtime boundary:

  - `scannedAt` is now `number` (Unix milliseconds, integer ≥ 0). It used
    to be an ISO-8601 `string` that the persistence layer parsed back to
    an int via `Date.parse()`; both conversions are gone. The DB column
    has always been `INTEGER` — only the in-memory shape moved.
  - `scope` is now emitted: `'project' | 'global'`. Defaults to
    `'project'`; overridable via the new `RunScanOptions.scope?` field.
    The CLI surface (`sm scan`) hardcodes `'project'` for now — the
    `--global` flag wiring lands in Step 6 (config + onboarding).
  - `roots` is now hard-required to be non-empty. `runScan` throws
    `"runScan: roots must contain at least one path (spec requires
minItems: 1)"` when called with `roots: []`. The CLI already
    defaults `roots = ['.']` when no positional args are supplied, so
    the throw is a programming-error guard, not a user-visible regression.
  - `adapters: string[]` is now emitted (the ids of every adapter that
    participated in classification; `[]` when no adapter ran). Optional
    in spec; emitted unconditionally for self-describing output.
  - `scannedBy: { name, version, specVersion }` is now emitted.
    `name` is hardcoded `'skill-map'`; `version` is read once at module
    init from this package's `package.json` (static JSON import, same
    pattern as `cli/version.ts`); `specVersion` reuses the existing
    `installedSpecVersion()` helper from the plugin loader (reads
    `@skill-map/spec/package.json#version` off disk, with a safe fallback
    to `'unknown'`).
  - `stats.filesWalked: number` is now emitted. Counts every `IRawNode`
    yielded by the adapter walkers. With one adapter it equals
    `nodesCount`; with future multi-adapter scans on overlapping roots
    it will diverge.
  - `stats.filesSkipped: number` is now emitted. Spec definition: "Files
    walked but not classified by any adapter." Today every walked file
    IS classified (the `claude` adapter's `classify()` always returns a
    kind, falling back to `'note'`), so this is **always 0**. Wired now
    so the field shape is spec-conformant; meaningful once multiple
    adapters compete (Step 9+).

  Ripple changes:

  - `persistScanResult` no longer parses `scannedAt`; it validates
    `Number.isInteger(scannedAt) && scannedAt >= 0` and uses the value
    as-is. The error message updated to "expected non-negative integer
    ms"; the matching test case renamed from "rejects an unparseable
    scannedAt" to "rejects a non-integer scannedAt".
  - `loadScanResult` returns a synthetic envelope: `scannedAt` is
    derived from `max(scan_nodes.scanned_at)` (or `Date.now()` for
    empty snapshots); `scope` defaults to `'project'`; `roots: ['.']`
    to satisfy the spec's `minItems: 1` (NOT load-bearing — the
    orchestrator's incremental path only reads `nodes` / `links` /
    `issues` from a prior, never the meta); `adapters: []`;
    `stats.filesWalked` / `filesSkipped` / `durationMs` are zeroed.
    The header comment documents the omissions and points at the
    follow-up `state_scan_meta` table that would let the loader return
    real values.
  - `ScanCommand` (`sm scan`) explicitly passes `scope: 'project'` into
    `runScan`. No change to the CLI surface.

  Self-scan acceptance test (`src/test/self-scan.test.ts`) upgraded:
  the per-element node / link / issue validation is replaced with a
  single top-level `scan-result.schema.json` validation. This is the
  strong assertion for the reconciliation: the whole `ScanResult` now
  parses against the authoritative top-level schema.

  **Breaking change for runtime consumers**: anyone who was reading the
  buggy ISO `scannedAt` string off `result` (or from `JSON.stringify(result)`
  via `sm scan --json`) now sees an integer. The fix is one line:
  `new Date(result.scannedAt)`. The runtime contract was buggy — the
  spec said integer all along — but the buggy runtime was the de-facto
  contract for downstream tooling tracking the `0.3.x` line, so call
  this out explicitly. `schemaVersion` stays at 1 because the spec did
  not move.

- 551f6ec: Three fixes surfaced by the Step 4 end-to-end validation:

  - `sm scan` exit code now matches `sm check`: returns `1` only when issues
    at `error` severity exist (was: `1` on any issue, including warn / info).
    Honors `spec/cli-contract.md` §Exit codes. The exit code is now
    consistent across `--json` and the human format — previously the
    `--json` branch always returned `0`, which made an agent loop scripting
    `sm scan --json | jq` blind to error-severity issues.
  - `sm show` human output now reports `External refs: <N>` after the
    Weight section. The `--json` output already exposed
    `node.externalRefsCount`; the human format had a parity gap. Rendered
    unconditionally (including `External refs: 0`) for honest reporting.
  - `sm scan --changed` no longer drops `supersedes`-inversion links from
    cached nodes. The frontmatter detector emits `supersededBy` edges with
    `source = newer-node` and `target = older-node`; the prior cached-reuse
    filter incorrectly required `link.source === node.path`, which dropped
    these inverted edges (the source path is often not even a real node).
    Repro on the skill-map repo: `sm scan` then `sm scan --changed`
    previously yielded 470 → 468 links; both now yield 470 with the link
    sets set-equal. The fix introduces an `originatingNodeOf(link,
priorNodePaths)` helper in the orchestrator: for `kind === 'supersedes'`
    it falls back to `link.target` only when `link.source` is not a known
    prior node path, which handles BOTH the inverted case (originating =
    target) and the forward `metadata.supersedes[]` case (originating =
    source). Frontmatter is currently the only detector that emits
    cross-source links — a future detector adding another inversion case
    would escalate to a persisted `Link.detectedFromPath` field with a
    schema bump rather than extending this heuristic.

- 4c34af1: Two more fixes from the Step 4 end-to-end validation pass:

  - `trigger-collision` rule now also detects cases where two nodes advertise
    the same trigger via their `frontmatter.name` (e.g. two commands both
    named `deploy` in different files — the canonical example in the rule's
    own doc comment). Previously the rule only fired on case-mismatch
    invocations between different sources; commands competing for a
    namespace silently passed because the implementation iterated `links`
    alone and never looked at `nodes`. The rule now buckets two kinds of
    claims on each normalized trigger — advertisements (`'/' +
frontmatter.name` for `command` / `skill` / `agent` nodes) and
    invocations (raw `link.target`) — and emits one `error` issue per
    bucket with two or more distinct advertiser paths, two or more distinct
    invocation forms, or one advertiser plus a non-canonical invocation
    (e.g. an upper-cased trigger against a lower-cased advertiser name).
    Issue payload exposes
    `{ normalizedTrigger, invocationTargets, advertiserPaths }` so callers
    can render either side.
  - `sm scan` now runs `PRAGMA wal_checkpoint(TRUNCATE)` after persisting,
    so external read-only tools (sqlitebrowser, DBeaver, ad-hoc `sqlite3`
    clients) see fresh state without manual intervention. Previously the
    main `.db` could lag the `.db-wal` arbitrarily — for typical small-repo
    scans the WAL never crossed the 1000-page auto-checkpoint threshold,
    so the canonical snapshot stayed in the sidecar indefinitely. The
    checkpoint runs on the top-level Kysely handle (not inside the
    transaction); cost is `~ms` on small DBs and there are no concurrent
    readers to contend with.

- 9a89124: Step 5.1 — Persist scan-result metadata in a new `scan_meta` table so
  `loadScanResult` returns real values for `scope` / `roots` / `scannedAt` /
  `scannedBy` / `adapters` / `stats.filesWalked` / `stats.filesSkipped` /
  `stats.durationMs` instead of the synthetic envelope shipped at Step 4.7.

  **Spec change (additive, minor)**:

  - New `scan_meta` table in zone `scan_*`, single-row (CHECK `id = 1`).
    Columns: `scope`, `roots_json`, `scanned_at`, `scanned_by_name`,
    `scanned_by_version`, `scanned_by_spec_version`, `adapters_json`,
    `stats_files_walked`, `stats_files_skipped`, `stats_duration_ms`.
    `nodesCount` / `linksCount` / `issuesCount` are not stored — they are
    derived from `COUNT(*)` of the sibling tables.
  - Replaced atomically with the rest of `scan_*` on every `sm scan`.

  **Runtime change**:

  - New kernel migration `002_scan_meta.sql`.
  - `IScanMetaTable` added to `src/kernel/adapters/sqlite/schema.ts` and
    bound in `IDatabase`.
  - `persistScanResult` writes the row (and deletes prior rows in the same
    transaction).
  - `loadScanResult` reads from `scan_meta` when the row exists; degrades
    to the previous synthetic envelope when it does not (DB freshly
    migrated, never scanned, or pre-5.1 snapshot).
  - The Step 4.7 follow-up notes in `scan-load.ts` documenting the
    synthetic envelope are simplified to describe both branches.

  Test count: 151 → 154 (+3 covering meta round-trip, replace-all
  single-row invariant, and synthetic-fallback on empty DB).

- 9a89124: Step 5.10 — Two polish fixes for the `sm history` CLI surfaces, both
  surfaced during end-to-end walkthrough.

  **Fix 1 — `sm history` (human) table columns no longer collapse**:
  the previous `formatRow` padded every non-ID column to a flat 11
  chars. The STARTED column writes a 20-char ISO-8601 timestamp
  (`2026-04-26T14:00:00Z`), which exceeds the 11-char width — `padEnd`
  silently no-ops when content is longer than the target width, so the
  timestamp ran into the next ACTION cell with zero whitespace
  between (`...T14:00:00Zsummarize`). Replaced with a per-column
  `COL_WIDTHS` array sized so the longest expected content fits with
  ≥2 trailing spaces:

  | Column   | Width | Rationale                      |
  | -------- | ----- | ------------------------------ |
  | ID       | 28    | truncate to 26 + 2 padding     |
  | STARTED  | 22    | 20-char ISO + 2 padding        |
  | ACTION   | 26    | truncate to 24 + 2 padding     |
  | STATUS   | 12    | longest enum (`completed`) + 3 |
  | DURATION | 10    | longest format (`1m 42s`) + 3  |
  | TOKENS   | 14    | typical `12345/6789` + buffer  |
  | NODES    | 6     | small int + buffer             |

  **Fix 2 — `sm history stats --json` `elapsedMs` accuracy**: the field
  was captured at `stats` construction time, BEFORE
  `loadSchemaValidators()` (which loads + AJV-compiles 29 schemas from
  disk on every CLI invocation, ~100 ms cold). Result: the JSON
  reported `elapsedMs: 10` while stderr showed `done in 111ms` —
  divergence of ~10× that misled anyone trying to correlate the two
  numbers. Fixed by re-stamping `stats.elapsedMs = elapsed.ms()` AFTER
  the validator load but BEFORE serialise. Schema validation is
  order-independent for `elapsedMs` (any non-negative integer
  satisfies the schema), so re-stamping post-validate is safe. The
  ~10 ms remaining gap (serialise + write) is below user-perception
  threshold.

  The validator load itself is still uncached — addressing that is a
  deeper refactor (module-level cache or pre-compiled validators) and
  out of scope for this polish pass.

  Test: 1 new in `src/test/history-cli.test.ts` — "table columns do
  not collapse" — asserts the rendered output contains an ISO
  timestamp followed by ≥2 spaces before the action id. Catches the
  pre-5.10 regression directly.

  Test count: 206 → 207.

- 9a89124: Step 5.11 — `sm history` human renderer now shows `failure_reason`
  inline when present, so the human path stops hiding info that's
  already in `--json`.

  Before:

  ```
  h-008  ...  audit-bar  failed     200ms  50/0     1
  h-006  ...  audit-foo  cancelled  50ms   20/0     1
  ```

  After:

  ```
  h-008  ...  audit-bar  failed (runner-error)         200ms  50/0   1
  h-006  ...  audit-foo  cancelled (user-cancelled)    50ms   20/0   1
  ```

  `completed` rows are unchanged (no parens noise). The STATUS column
  widened from 12 to 30 chars to fit the longest enum
  (`cancelled (user-cancelled)` = 26).

  Test count: 207 → 208.

- 9a89124: Step 5.12 — `loadSchemaValidators()` now caches the compiled validator
  set at module level. Before: every call paid ~100 ms cold to read +
  AJV-compile 17 schemas (plus 8 supporting `$ref` targets). After: the
  first call costs the same; every subsequent call in the same process
  returns the same instance for free.

  For a one-shot CLI like `sm history stats --json`, this is a no-op
  (only one call per process). The win shows up once a future verb
  validates at multiple boundaries — likely candidates: `sm doctor`,
  `sm record`, plugin manifest re-checks, the audit pipeline. Lays the
  groundwork without forcing those callers to thread a cached
  validators bundle through their call stacks.

  Test-only escape hatch `_resetSchemaValidatorsCacheForTests()`
  exported so tests can re-trigger the cold load deterministically. The
  public `loadSchemaValidators` signature is unchanged.

  Test count: 208 → 211 (+3 in `kernel/adapters/schema-validators.test.ts`).

- 9a89124: Step 5.13 — `frontmatter_hash` is now computed over a CANONICAL YAML
  form of the parsed frontmatter, not over the raw text bytes.

  **Why**: a YAML formatter pass on the user's editor (Prettier YAML,
  IDE autoformat, manual indent fix, key reordering) used to silently
  break the medium-confidence rename heuristic — two files with
  identical logical frontmatter but different YAML formatting got
  different `frontmatter_hash` values, so the heuristic saw them as
  "different frontmatter" and demoted what should have been a
  medium-confidence rename to an `orphan` issue. Surfaced during the
  end-to-end walkthrough (the `cat <<EOF` output didn't byte-match the
  file written via the Write tool, even though both blocks looked
  identical to a human).

  **How**: new `canonicalFrontmatter(parsed, raw)` helper in
  `kernel/orchestrator.ts`. Re-emits the parsed frontmatter via
  `yaml.dump` with deterministic options:

  - `sortKeys: true` — keys in lexicographic order regardless of
    declaration order.
  - `lineWidth: -1` — no auto-wrap.
  - `noRefs: true` — no `*alias` shorthand.
  - `noCompatMode: true` — modern YAML 1.2 output.

  Comments are lost (they're not semantic). Hash is then `sha256` of
  that canonical string instead of `raw.frontmatterRaw`.

  **Fallback**: when the adapter's parse failed silently (yields
  `parsed = {}` for non-empty `raw`), we fall back to hashing the raw
  text so a malformed-YAML file still hashes deterministically against
  itself across rescans. Without this, every malformed file would
  collapse to the same `sha256(yaml.dump({}))` and erroneously match
  each other for rename.

  **Migration impact**: existing DBs have `frontmatter_hash` values
  computed over raw text. After this lands, the next `sm scan` will
  see every file as "frontmatter changed" (cache miss in `--changed`
  mode; otherwise cosmetic). No data loss. `state_*` rows aren't
  affected — they key on `node.path`, not on `frontmatter_hash`. Once
  the new hashes settle, behaviour stabilises.

  Tests: 2 new in `src/test/scan-mutation.test.ts`:

  - "two files with the same logical frontmatter but DIFFERENT YAML
    formatting hash to the same fm_hash" — exercises key reordering,
    quote-style change, trailing-newline change, all in one fixture
    pair.
  - "logically-different frontmatters still produce different
    fm_hashes" — guard against canonicalization collapsing distinct
    values.

  Test count: 211 → 213.

- 9a89124: Step 5.2 — Storage helpers for the history readers (`sm history`,
  `sm history stats`) and for the rename heuristic / `sm orphans` verbs
  landing in 5.3 — 5.6.

  New module `src/kernel/adapters/sqlite/history.ts` with four entry
  points, all accepting either a `Kysely<IDatabase>` or a
  `Transaction<IDatabase>` so callers can compose them inside a larger
  tx (the rename heuristic does this):

  - `insertExecution(db, exec)` — write a `state_executions` row.
    Surfaces today through tests; consumed by `sm record` / `sm job run`
    at Step 9.
  - `listExecutions(db, filter)` — read with optional filters: `nodePath`
    (JSON-array containment via `json_each`, mirroring the
    `sm list --issue` subquery in `cli/commands/list.ts`), `actionId`
    (exact match on `extension_id`), `statuses[]`, `sinceMs` /
    `untilMs` (since inclusive, until exclusive), `limit`. Sorted
    most-recent first.
  - `aggregateHistoryStats(db, range, period, topN)` — totals,
    per-action token rollup (sorted desc by `tokensIn + tokensOut`),
    per-period bucketing via `bucketStartMs` (UTC `day` / `week` /
    `month`), top-N nodes by frequency (tie-break `lastExecutedAt`
    desc), and error rates: global, per-action, and per-failure-reason.
    The per-failure-reason map ALWAYS includes all six enum values
    (zero-filled), so dashboards see a predictable shape.
  - `migrateNodeFks(trx, fromPath, toPath)` — repoint every `state_*`
    reference to a node from `fromPath` to `toPath`. Handles the three
    FK shapes the kernel uses today: simple column on `state_jobs`,
    JSON-array contents on `state_executions.node_ids_json`
    (pull-modify-update), and composite PKs on `state_summaries`,
    `state_enrichments`, `state_plugin_kvs` (delete + insert at the new
    PK). Composite-PK collisions are resolved conservatively: the
    destination row is preserved (it represents the live node's
    history), the migrating row is dropped, and the drop is reported
    back via `IMigrateNodeFksReport.collisions[]` so callers can surface
    a diagnostic. The empty-string sentinel for plugin-global keys is
    intentionally skipped.

  Exports `bucketStartMs(dateMs, period)` for direct use by the
  `sm history stats` CLI (5.4) and to keep bucketing testable in
  isolation.

  New domain types in `src/kernel/types.ts`: `ExecutionRecord`,
  `ExecutionKind`, `ExecutionStatus`, `ExecutionFailureReason`,
  `ExecutionRunner`, plus `HistoryStats` and its sub-shapes —
  mirroring `spec/schemas/execution-record.schema.json` and
  `spec/schemas/history-stats.schema.json` respectively.

  Test count: 154 → 169 (+15 covering insert/list filter axes,
  bucket boundaries for day/week/month, totals + per-action +
  per-period + top-nodes + error-rates aggregation including the
  all-six-keys failure-reason invariant, FK migration across the
  three shapes, sentinel preservation, and conservative collision
  resolution).

- 9a89124: Step 5.3 — `sm history` CLI lands. The stub is removed from
  `stubs.ts`; the real implementation lives at `src/cli/commands/history.ts`
  and is registered in `cli/entry.ts`.

  Surface (matches `spec/cli-contract.md` §History):

  - `-n <path>` — restrict to executions whose `nodeIds[]` contains `<path>`
    (JSON-array containment via `json_each`, mirroring the
    `sm list --issue` subquery).
  - `--action <id>` — exact match on `extension_id`.
  - `--status <s,...>` — comma-separated subset of
    `completed,failed,cancelled`. Unknown values rejected with exit 2.
  - `--since <ISO>` / `--until <ISO>` — Unix-ms boundaries on
    `started_at`. Since inclusive, until exclusive (per the schema's
    `range` semantics). Unparseable input → exit 2.
  - `--limit N` — positive integer cap. Non-positive → exit 2.
  - `--json` — emits an array conforming to
    `spec/schemas/execution-record.schema.json` (no top-level
    `elapsedMs` for array outputs, per `cli-contract.md` §Elapsed time).
  - `--quiet` — suppresses the `done in <…>` stderr line.

  Exit codes follow `cli-contract.md`: 0 ok (including empty result),
  2 bad flag, 5 DB missing.

  New shared util `src/cli/util/elapsed.ts` (`startElapsed` /
  `formatElapsed` / `emitDoneStderr`) carries the §Elapsed time
  formatting (`34ms` / `2.4s` / `1m 42s`). Used by `sm history` /
  `sm history stats` only — retrofitting `list` / `show` / `check` /
  `scan` is a known drift kept out of Step 5 scope.

  Tests: 9 new under `src/test/history-cli.test.ts` covering the missing
  DB, empty DB, --json schema validation, every filter axis (-n, --status,
  window boundaries), and bad-input exit codes.

  `context/cli-reference.md` regenerated.

  Test count: 169 → 184.

- 9a89124: Step 5.4 — `sm history stats` CLI lands alongside `sm history` in
  `src/cli/commands/history.ts`. The stub is removed from `stubs.ts`
  and the real class registered in `cli/entry.ts`.

  Surface (matches `spec/cli-contract.md` §History):

  - `--since <ISO>` / `--until <ISO>` — window boundaries. Since defaults
    to `null` (all-time); until defaults to `now()`. Both validated.
  - `--period day|week|month` — bucket granularity. Default `month`. Bucket
    start computed in UTC (`bucketStartMs` from 5.2): day = 00:00 of the
    date, week = Monday 00:00 UTC, month = day-1 00:00 UTC.
  - `--top N` — caps the `topNodes` array. Default 10. Non-positive → exit 2.
  - `--json` — emits a `HistoryStats` object conforming to
    `spec/schemas/history-stats.schema.json`. The output is **self-validated
    before emit** via `loadSchemaValidators().validate('history-stats', …)` —
    same pattern as `src/test/self-scan.test.ts` — so a runtime shape
    regression surfaces as exit 2 with a clear stderr message rather than
    drifting silently.
  - `--quiet` — suppresses the `done in <…>` stderr line.

  Top-level `elapsedMs` is included in the JSON object per the schema.
  Stderr always carries `done in <formatted>` unless `--quiet`.

  The per-failure-reason map ALWAYS contains all six enum values
  (`runner-error`, `report-invalid`, `timeout`, `abandoned`,
  `job-file-missing`, `user-cancelled`), zero-filled when a reason has
  no occurrences — predictable shape for dashboards.

  Tests: 6 new in `src/test/history-cli.test.ts` covering schema
  self-validation, day-period bucketing, invalid `--period`, `--top`
  cap, `range.since` shape (`null` vs ISO string), and the empty-DB
  all-zero totals path.

  `context/cli-reference.md` regenerated.

- 9a89124: Step 5.5 — Auto-rename heuristic lands at scan time per
  `spec/db-schema.md` §Rename detection.

  **Orchestrator changes**:

  - New post-rule phase in `runScan` that classifies the diff
    `priorPaths \ currentPaths` × `currentPaths \ priorPaths`:
    - **High** (body hash match): emits a `RenameOp` with confidence
      `high`. NO issue — silent migration per spec.
    - **Medium** (frontmatter hash, exactly one remaining candidate
      after high pass): emits `RenameOp` + `auto-rename-medium` issue
      (severity `warn`) with `data: { from, to, confidence: 'medium' }`.
    - **Ambiguous** (frontmatter hash, more than one remaining
      candidate): emits `auto-rename-ambiguous` issue with
      `data: { to, candidates: [<old1>, <old2>, …] }` and `nodeIds: [to]`.
      NO migration; the candidates fall through to the orphan pass.
    - **Orphan**: every unclaimed deletion yields an `orphan` issue
      (severity `info`) with `data: { path: <deletedPath> }`.
  - 1-to-1 matching is enforced (a `newPath` claimed by an earlier
    stage cannot be reused). Iteration is lex-asc on both sides for
    deterministic output across runs and conformance fixtures.
  - Body-hash match wins over frontmatter-hash match (high pass runs
    before medium pass and consumes its `newPath`).

  **API surface**:

  - `runScan(kernel, opts)` continues to return `ScanResult` only —
    preserved for backward compatibility with tests and external
    consumers.
  - New `runScanWithRenames(kernel, opts)` returns
    `{ result: ScanResult; renameOps: RenameOp[] }` — the variant `sm scan`
    consumes so it can hand `renameOps` to `persistScanResult` for
    in-tx FK migration.
  - New `detectRenamesAndOrphans(prior, currentNodes, issues)` exported
    for direct testing and reuse by future surfaces (e.g. `sm orphans`
    reconciliation paths).
  - New `RenameOp` type exported from `kernel/index.ts`:
    `{ from: string; to: string; confidence: 'high' | 'medium' }`.

  **Persistence changes**:

  - `persistScanResult(db, result, renameOps?)` accepts an optional
    ops list. The migration runs **first inside the tx** (via the
    Step 5.2 `migrateNodeFks` helper), then the scan zone replace-all.
    A failure during FK migration rolls back the entire scan persist —
    either all renames land or none do (per spec). Returns
    `{ renames: IMigrateNodeFksReport[] }` so callers can surface
    collision diagnostics.

  **`sm scan`**:

  - Switches to `runScanWithRenames` and forwards the ops to
    `persistScanResult`. No new flags. CLI exit code semantics are
    unchanged: `auto-rename-medium` and `auto-rename-ambiguous` are
    `warn`-severity and `orphan` is `info`-severity, so they do NOT
    trip exit code 1 (which still requires at least one `error`).

  Test count: 184 → 190 (+6: high happy path, medium issue + FK
  migration, ambiguous N:1 leaving FKs intact, orphan info-issue,
  body-wins-frontmatter precedence, deterministic 1-to-1 lex matching).

  `context/cli-reference.md` unchanged — `sm scan` flag surface stays
  identical.

- 9a89124: Step 5.6 — `sm orphans` verbs land. The three stubs are removed from
  `stubs.ts`; the real implementations live at
  `src/cli/commands/orphans.ts` and are registered as `ORPHANS_COMMANDS`
  in `cli/entry.ts`.

  **`sm orphans [--kind orphan|medium|ambiguous] [--json]`**:
  Lists every active issue with `analyzerId IN (orphan, auto-rename-medium,
auto-rename-ambiguous)`. `--json` emits an array of `Issue` objects
  (per `spec/schemas/issue.schema.json`); the human path renders a
  one-line summary per issue grouped by analyzerId.

  **`sm orphans reconcile <orphan.path> --to <new.path>`**:
  Forward direction. Validates `<new.path>` exists in `scan_nodes`
  (exit 5 otherwise) and that an active `orphan` issue with
  `data.path === <orphan.path>` exists (exit 5 otherwise). Migrates
  state\_\* FKs via `migrateNodeFks` (5.2) inside a single transaction
  along with the `DELETE FROM scan_issues` of the resolved orphan
  issue. Surfaces composite-PK collision diagnostics on stderr when
  they occur.

  **`sm orphans undo-rename <new.path> [--from <old.path>] [--force]`**:
  Reverse direction. Resolves the active `auto-rename-medium` or
  `auto-rename-ambiguous` issue on `<new.path>`:

  - For `auto-rename-medium`, reads `data.from` (omit `--from`).
    Passing a `--from` that does not match `data.from` → exit 2.
  - For `auto-rename-ambiguous`, requires `--from <old.path>` to pick
    one of `data.candidates` (exit 5 if missing or not in candidates).

  Migrates state\_\* FKs back to the prior path (the reverse of what the
  heuristic did), deletes the auto-rename issue, and emits a new
  `orphan` issue on the prior path (per spec: "the previous path
  becomes an `orphan`"). Destructive — prompts via `readline` unless
  `--force`.

  **Refactor**: the `confirm()` helper used by `sm db restore` /
  `sm db reset --state` / `sm db reset --hard` is extracted to
  `src/cli/util/confirm.ts` so `sm orphans undo-rename` reuses the
  exact same prompt shape (`<question> [y/N] `, stderr-emitting
  readline interface). `db.ts` now imports it; behaviour identical.

  Test count: 190 → 201 (+11 covering: list happy path, --kind filter,
  --kind invalid, reconcile happy path / target-missing / no-issue,
  undo-rename medium force, --from mismatch, no-issue exit 5,
  ambiguous --from required + outside-candidates + valid).

  `context/cli-reference.md` regenerated.

- 9a89124: Step 5.7 — Conformance coverage for the rename heuristic.

  **Spec change (additive, minor)**:

  - `spec/schemas/conformance-case.schema.json` gains
    `setup.priorScans: Array<{ fixture, flags? }>` — an ordered list of
    staging scans the runner executes BEFORE the main `invoke`. Each
    step replaces every non-`.skill-map/` directory in the scope with
    the named fixture and runs `sm scan` (with optional flags). The DB
    persists across steps because `.skill-map/` is preserved between
    swaps. After the last step, the runner copies the top-level
    `fixture` and runs the case's `invoke`.

    Required to express scenarios that need a prior snapshot (rename
    heuristic, future incremental cases). The schema is purely
    additive — every existing case keeps passing without modification.

  - Two new conformance cases under `spec/conformance/cases/`:

    - **`rename-high`** — moving a single file with identical body
      triggers a high-confidence auto-rename. Asserts:
      `stats.nodesCount === 1`, `stats.issuesCount === 0`,
      `nodes[0].path === skills/bar.md`. Verifies the spec invariant
      that high-confidence renames emit NO issue.
    - **`orphan-detection`** — deleting a file with no replacement
      emits exactly one `orphan` issue (severity `info`). Asserts the
      `analyzerId` and `severity` directly.

  - Four new fixture directories under `spec/conformance/fixtures/`:
    `rename-high-before/`, `rename-high-after/`,
    `orphan-before/`, `orphan-after/`.

  - `spec/conformance/coverage.md`: row I (Rename heuristic) flips
    from `🔴 missing` to `🟢 covered`. Notes the medium / ambiguous
    branches stay covered by `src/test/rename-heuristic.test.ts` for
    now (assertion vocabulary in the schema is not rich enough to
    express "the issues array contains an item with analyzerId X and
    data.confidence === 'medium'" — when the conformance schema gains
    array-filter assertions, those branches can land here too).

  **Runtime change**:

  - `src/conformance/index.ts` runner: implements `setup.priorScans`.
    Helper `replaceFixture(scope, specRoot, fixture)` clears every
    top-level entry in the scope except `.skill-map/`, then copies the
    named fixture on top. Used by both staging steps and the main
    `fixture` phase.
  - `src/test/conformance.test.ts`: includes the two new cases in the
    Step-0b subset. Total conformance cases passing in CI: 1 → 3.

  **`spec/index.json`** regenerated (50 → 57 files). `npm run spec:check`
  green.

  Test count: 201 → 203 (+2 conformance cases). The Step 5 totals close
  at: 151 → 203 (+52 across 7 sub-steps).

- 9a89124: Step 5.8 — fire the rename heuristic on every `sm scan`, not just
  `sm scan --changed`. Closes the follow-up flagged at the close of
  Step 5.

  Before this change, `priorSnapshot` in `RunScanOptions` carried two
  coupled responsibilities:

  1. Source for the rename heuristic (5.5).
  2. Source for cache reuse (5.4 / Step 4.4 — skip detectors on
     hash-matching nodes).

  Loading prior was gated on `--changed` in `scan.ts`, so a plain
  `sm scan` after reorganising files emitted no rename / orphan issues
  and migrated no `state_*` FKs. The user-visible expectation — and a
  defensible reading of the spec ("`sm scan` is the only surface that
  triggers automatic rename detection") — is that **every** `sm scan`
  fires the heuristic.

  The fix decouples the two responsibilities:

  - New `RunScanOptions.enableCache?: boolean` (default `false`).
    Controls cache reuse only. The orchestrator's "cached" check is now
    `enableCache && prior !== null && hashes match`.
  - `priorSnapshot` reverts to a single meaning: "data from the prior
    scan". Always passed when a prior exists, regardless of `--changed`.
  - `scan.ts` always loads the prior when the DB exists and the user
    isn't running `--no-built-ins`. The `--changed`-only stderr warning
    ("no prior snapshot found") survives — without `--changed` the
    empty-prior path is silent (it's the normal first-scan behaviour).
  - `scan.ts` sets `enableCache: this.changed` when `priorSnapshot` is
    passed, so `--changed` keeps its perf win and the contract for
    cache-reliant tests doesn't break.

  Behaviour matrix after the fix:

  | Invocation                      | Prior loaded? | Cache reuse? | Rename heuristic? |
  | ------------------------------- | ------------- | ------------ | ----------------- |
  | `sm scan` (DB exists)           | yes           | no           | yes               |
  | `sm scan` (DB empty)            | no            | n/a          | no                |
  | `sm scan --changed` (DB exists) | yes           | yes          | yes               |
  | `sm scan --changed` (DB empty)  | no — warns    | n/a          | no                |
  | `sm scan --no-built-ins`        | no            | n/a          | no (no walk)      |

  `--changed --no-built-ins` rejection (exit 2) stays as-is — the
  combination is still incoherent.

  Tests:

  - `scan-incremental.test.ts` — pre-existing tests assert on cache
    events; they now pass `enableCache: true` explicitly to keep that
    contract under test.
  - `cli.test.ts` — new e2e: write file → `sm scan` → delete file →
    `sm scan --json` (no --changed) → assert one `orphan` issue in the
    result. Closes the gap at the binary level.

  Test count: 203 → 204.

  Internal API note: `runScanWithRenames` continues to return
  `{ result, renameOps }`. Both the heuristic and the cache use the
  same prior data, so the wrapper's signature didn't change.

- 9a89124: Step 5.9 — Orphan issues now persist across scans as long as `state_*`
  has stranded references. Closes a gap surfaced during end-to-end
  walkthrough.

  **The bug**: `persistScanResult` does `DELETE FROM scan_issues` before
  inserting the new issues. The per-scan rename heuristic
  (`detectRenamesAndOrphans`) only emits `orphan` for paths in `prior \
current` of the _immediately preceding_ scan. So after a deletion-scan
  emitted an `orphan` issue, the very next scan (with no further
  mutations) wiped that issue and emitted nothing — leaving the stranded
  `state_*` rows invisible. Worst consequence:
  `sm orphans reconcile <orphan.path>` requires an active orphan issue,
  so once the issue silently expired, the user had no way to reconcile
  the stranded references.

  This contradicts `spec/db-schema.md` §Rename detection:

  > "the kernel emits an issue (...) and keeps the `state_*` rows
  > referencing the dead path untouched **until the user runs
  > `sm orphans reconcile`** or accepts the orphan."

  The "until" language implies the issue stays surfaceable as long as
  the stranded refs remain.

  **The fix**: new `findStrandedStateOrphans(trx, livePaths)` helper in
  `src/kernel/adapters/sqlite/history.ts` sweeps every node reference
  across `state_jobs`, `state_executions` (json_each over the JSON
  array), `state_summaries`, `state_enrichments`, and `state_plugin_kvs`
  (skipping the empty-string sentinel for plugin-global keys). Returns
  the set of distinct `node_id` values not present in the live snapshot,
  deterministically lex-asc.

  `persistScanResult` calls the sweep AFTER applying `renameOps` and
  BEFORE the replace-all of `scan_issues`. For each stranded path not
  already covered by a per-scan orphan issue, it appends a new orphan
  issue to `result.issues`. Then the replace-all writes the augmented
  list. `result.stats.issuesCount` is updated to keep `sm scan --json`
  self-consistent.

  **Behaviour**:

  - High / medium renames migrate state\_\* → no stranded refs → no extra
    orphan issues. Unchanged.
  - Ambiguous → state stays on the old paths → next scan emits orphans
    for each previously-stranded path automatically.
  - Pure orphan (deleted, no rename match) → emits orphan in the same
    scan, persists across subsequent scans until the user reconciles
    via `sm orphans reconcile <path> --to <new.path>` or rewrites the
    state row manually.
  - Once `state_*` no longer references the dead path, the next scan
    emits no orphan for it. Self-healing.

  The sweep is deduplicated against per-scan emissions via
  `knownOrphanPaths`, so the same path never appears twice in
  `scan_issues` after a single scan.

  Tests: 2 new in `rename-heuristic.test.ts`:

  - "orphan issue persists across subsequent scans while state\_\*
    references the dead path" — 4 scans walking the full lifecycle
    (seed → delete → re-scan persistence → reconcile-via-state-edit).
  - "per-scan orphan and stranded sweep do not duplicate the same path"
    — same path emitted by both pathways, only 1 issue in result.

  Test count: 204 → 206.

- Updated dependencies [dacd4d9]
- Updated dependencies [9a89124]
- Updated dependencies [9a89124]
  - @skill-map/spec@0.6.0

## 0.3.1

### Patch Changes

- 18d758a: Editorial pass across spec/ and src/ docs: convert relative-path text references (e.g. `plugin-kv-api.md`, `schemas/node.schema.json`) to proper markdown links, so they resolve on GitHub and in renderers. No normative or behavioural changes — prose, schemas, and CLI contract are unchanged.
- b6c46f8: Pin all dependencies to exact versions in `src/package.json` (no `^` / `~` ranges). Matches the new repo-wide rule in `AGENTS.md`. No runtime behaviour change — all versions match what the lockfile already resolves to. Re-evaluate when `src/` flips to public (published libs usually prefer caret ranges so consumers can dedupe).
- 48c386b: First npm publish of `@skill-map/cli` — name registration. The package was previously private; flipping `private: false` plus adding `publishConfig.access: public` lets the next "Version Packages" merge publish to the npm registry under the `@skill-map` org alongside `@skill-map/spec`. Status remains preview / pre-1.0 (Steps 0a-3 done; full scan lands at Step 4). Subsequent releases follow the standard changeset flow.
- Updated dependencies [18d758a]
  - @skill-map/spec@0.5.1

## 0.3.0

### Minor Changes

- 128a678: Step 1a — Storage + migrations.

  Lands `SqliteStorageAdapter` behind `StoragePort`. Uses a bespoke `NodeSqliteDialect` for Kysely (Kysely's official `SqliteDialect` ships `better-sqlite3` — native, forbidden by Decision #7; the kernel runtime is Node 24+ with zero native deps). The dialect reuses Kysely's pure-JS `SqliteAdapter` / `SqliteIntrospector` / `SqliteQueryCompiler` and plugs a minimal Driver over `node:sqlite`'s `DatabaseSync`. CamelCasePlugin bridges camelCase TypeScript field names to the spec-mandated snake_case SQL.

  The migrations runner (`src/kernel/adapters/sqlite/migrations.ts`) discovers `NNN_snake_case.sql` files, diffs them against the `config_schema_versions` ledger (scope = `kernel`, owner = `kernel`), and applies pending files inside per-file `BEGIN / COMMIT` transactions. The ledger insert and `PRAGMA user_version` update share the migration's transaction so partial success can't drift the state. Auto-backup fires before any apply — WAL checkpoint then file copy to `.skill-map/backups/skill-map-pre-migrate-v<N>.db`. `tsup.config.ts` gained an `onSuccess` hook that copies `src/migrations/` to `dist/migrations/`; `package.json#files` now includes `migrations/` so published artifacts ship the SQL.

  `src/migrations/001_initial.sql` provisions every kernel table from `spec/db-schema.md`: 3 `scan_*`, 5 `state_*`, 3 `config_*` with full CHECK constraints (enum guards on kind / stability / confidence / severity / job status / failure reason / runner / execution kind / execution status / schema version scope / boolean verified flag / boolean config_plugins.enabled), every named index declared in the spec, and the unique partial index on `state_jobs(action_id, node_id, content_hash) WHERE status IN ('queued','running')` that enforces the duplicate-job detection contract from `spec/job-lifecycle.md`.

  `sm db` command surface (per `spec/cli-contract.md` §Database):

  - `sm db backup [--out <path>]` — WAL checkpoint + file copy.
  - `sm db restore <path> [--yes]` — copies source over target and clears stale WAL sidecars; destructive, prompts by default.
  - `sm db reset [--state] [--hard] [--yes]` — default truncates `scan_*` (non-destructive, no prompt); `--state` also truncates `state_*`; `--hard` removes the DB file and its sidecars. Destructive modes prompt by default.
  - `sm db shell` — spawns the system `sqlite3` binary with inherited stdio; ENOENT produces a pointed error pointing at the install steps for macOS / Debian / Ubuntu and the `sm db dump` fallback.
  - `sm db dump [--tables ...]` — `sqlite3 -readonly path .dump` to stdout.
  - `sm db migrate [--dry-run|--status|--to <n>|--no-backup]` — default applies pending; `--status` prints applied vs pending; `--dry-run` previews without writing; `--to` caps the applied range; `--no-backup` skips the pre-apply copy.

  `--kernel-only` and `--plugin <id>` from the CLI contract are deferred to Step 1b when the plugin loader introduces plugin-authored migrations; they would be no-ops today.

  Acceptance test (`src/test/storage.test.ts`) covers the ROADMAP §Step 1a round-trip — fresh scope → migrate --dry-run → apply → write a row → backup → "corrupt" the row → restore → verify the original row came back — plus narrower checks around CamelCasePlugin field mapping, CHECK constraint enforcement at the DB layer, and the unique partial index behaviour (duplicate queued job rejected, same tuple allowed once the blocking job completes). 24 of 24 tests pass.

  Classification: minor per `spec/versioning.md` §Pre-1.0 (`0.Y.Z`). First real feature surface after the Step 0b bootstrap; `skill-map` bumps `0.2.0 → 0.3.0`.

- a0e6578: Step 1b — Registry + plugin loader.

  Wires AJV Draft 2020-12 validation against the schemas published by `@skill-map/spec` and ships the default `PluginLoader` implementation on top of it.

  **`src/kernel/adapters/schema-validators.ts`** compiles 17 reusable validators from the spec (11 top-level + 6 extension-kind). A single Ajv instance is used so `$ref` resolution works across `allOf` composition (every extension kind extends `extensions/base` via `allOf`). Supporting schemas (frontmatter, summaries) register first so targets resolve during compile. Eager compilation at load time means a spec corruption is a hard boot error, not a deferred surprise. `ajv-formats` is enabled for `uri` / `date` / `date-time`. A dedicated `validatePluginManifest()` targets `plugins-registry.schema.json#/$defs/PluginManifest` so callers don't hand-filter the combined `oneOf`.

  **`src/kernel/types/plugin.ts`** hand-writes the plugin-surface types (`IPluginManifest`, `TPluginStorage`, `ILoadedExtension`, `IDiscoveredPlugin`, `TPluginLoadStatus`). Per the updated DTO-gap note, this hand-curated mirror stays in place until Step 2's real adapter arrives as a third consumer that justifies a canonical typed-DTO export from `@skill-map/spec`.

  **`src/kernel/adapters/plugin-loader.ts`** implements the full load pass:

  1. Discover plugin directories under the configured search paths; each direct child containing a `plugin.json` is a plugin root.
  2. Parse + AJV-validate the manifest — any failure (JSON parse error, schema mismatch, malformed `specCompat` range) returns `status: 'invalid-manifest'`.
  3. `semver.satisfies(installedSpecVersion, manifest.specCompat)` with `includePrerelease: true` — mismatch returns `status: 'incompatible-spec'` with the manifest preserved for diagnostics.
  4. Dynamic-import every path in `manifest.extensions[]`, expecting a default export with a string `kind` field. File missing, import failure, missing/unknown kind, or default export failing its kind schema all return `status: 'load-error'` with a precise reason.

  Never throws — the kernel always keeps booting, regardless of how broken a plugin is.

  **CLI: `sm plugins list / show / doctor`** land in `src/cli/commands/plugins.ts`:

  - `list` tabulates discovered plugins with a status glyph and either their extension list (on success) or their failure reason.
  - `show <id>` dumps a single plugin's manifest + extensions + load status; exit 5 when not found.
  - `doctor` returns exit 0 when every plugin loads, exit 1 otherwise — script-friendly readiness check.

  All three support `-g / --global` (global scope only), `--plugin-dir <p>` (explicit override, handy for tests), and `--json` on list / show. The `module` field on loaded extensions is omitted from JSON output to avoid circular-reference serialization errors.

  **Side fix** surfaced while wiring AJV against the extension-kind schemas: the six kind schemas paired `additionalProperties: false` with `allOf: [{ $ref: base.schema.json }]`, a Draft 2020-12 composition footgun where each sub-schema applies its closed-content rule independently. The fix (shipped as a `@skill-map/spec` patch in the same commit train) switches kind schemas to `unevaluatedProperties: false` and removes closure from base; closed-content now survives the allOf composition.

  **Spec resolution**: `@skill-map/spec`'s `exports` field does not expose `package.json`, so `require.resolve('@skill-map/spec/package.json')` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Both `resolveSpecRoot()` in the validators and `installedSpecVersion()` in the loader now resolve `@skill-map/spec/index.json` (always exported) and walk one directory up. Zero spec-side changes needed.

  **Acceptance test** (`src/test/plugin-loader.test.ts`) codifies the ROADMAP criterion across 8 cases: empty search paths return `[]`; a green-path plugin with one detector extension loads and reports its extensions; both `invalid-manifest` sub-cases (missing required fields, unparseable JSON) surface; `incompatible-spec` preserves the manifest for diagnostics; both `load-error` sub-cases (missing extension file, default export failing its kind schema) surface; and a mixed scenario proves the kernel keeps going when one plugin in the search path is bad.

  Classification: minor per `spec/versioning.md` §Pre-1.0. Second feature surface after Step 1a; `skill-map` bumps `0.3.0 → 0.4.0`.

  Deferred to Step 2: `sm db migrate --kernel-only` / `--plugin <id>` (wait for real plugin migrations + triple protection), plugin-authored migrations themselves (require SQL AST parsing + prefix injection), and closing the typed-DTO gap.

- 8bda522: Step 1c — Orchestrator + CLI dispatcher + introspection.

  Closes Step 1 (all three sub-steps done). Three deliverables land in this bump:

  **Real scan orchestrator.** `src/kernel/orchestrator.ts` replaces the Step 0b stub with a pipeline that actually walks the Registry — pulling adapters, detectors, and rules from the registered set, iterating in canonical order, and emitting `scan.started` / `scan.completed` through a `ProgressEmitterPort`. The kernel-empty-boot invariant is preserved because with zero extensions the iteration produces a zero-filled valid `ScanResult`. Concrete extension runtime interfaces (`adapter.walk()`, `detector.detect()`, `rule.evaluate()`) are not yet defined; the iteration sites carry `TODO(step-2)` markers so the Step 2 drop-in test stays honoured. New adapter `InMemoryProgressEmitter` handles default in-process event fan-out; WebSocket-backed emitter lands at Step 13.

  **Full CLI surface.** `src/cli/commands/stubs.ts` ships 35 Clipanion command classes covering every verb from `spec/cli-contract.md` that doesn't yet have a real implementation. Each stub registers the final path with the contract's declared flags typed correctly (boolean vs string vs array) and a `Usage` block carrying category / description / details — so `sm help` sees the full surface today and the drift-check script has something to diff against. `execute()` writes a one-liner pointing at the Step that will implement it and returns exit 2. Grouped by module in contract order: setup (init, doctor), config (5), browse (list/show/check/findings/graph/export/orphans*), actions, jobs (submit/list/show/preview/claim/run/status/cancel/prune), record, history, plugins toggle (enable/disable), audits, serve. Real commands from Step 1a (`sm db *`) and Step 1b (`sm plugins list/show/doctor`) + `sm scan`+`sm version` stay on their real implementations.

  **Introspection: `sm help --format human|md|json`.** `src/cli/commands/help.ts` walks `this.cli.definitions()` to introspect every registered verb. `human` delegates to Clipanion's own `cli.usage()` so the terminal output matches the built-in exactly. `json` emits a structured surface dump matching `cli-contract.md` §Help — `{ cliVersion, specVersion, globalFlags, verbs[] }` with each verb carrying `{ name, category, description, details, examples, flags[] }`. `md` emits canonical markdown grouped by category. Single-verb mode (`sm help scan --format json`) emits one block. Unknown verb returns exit 5; unknown format returns exit 2.

  **Auto-generated `docs/cli-reference.md`.** `scripts/build-cli-reference.mjs` runs `sm help --format md` via tsx and writes the result to `docs/cli-reference.md` (290 lines, 6.5 KB). Root package.json gains `cli:reference` (regenerate) and `cli:check` (CI drift check — exits 1 on mismatch with a pointer to the regenerate command). `cli-contract.md` mandates this file is NOT hand-edited in the reference impl; the CI check enforces that.

  **Acceptance test green.** The `kernel-empty-boot` conformance case runs end-to-end through the real `bin/sm.mjs` → real `runScan()` path (no longer via the stub). 36 of 36 tests pass — 32 prior + 4 new covering scan event emission, empty-registry orchestrator iteration, and InMemoryProgressEmitter subscribe/unsubscribe.

  Classification: minor per `spec/versioning.md` §Pre-1.0. Third feature surface after Steps 1a and 1b; `skill-map` bumps `0.4.0 → 0.5.0-pre` territory in the roadmap scheme, formally landing as a minor bump.

- eedaf90: Step 2 — First extension instances.

  Ships the reference implementation's eight built-in extensions and the orchestrator wiring that turns `sm scan` from a zero-filled stub into a real pipeline.

  **Runtime contracts** (`src/kernel/extensions/`): five TypeScript interfaces mirroring the six extension-kind manifest schemas — `IAdapter`, `IDetector`, `IAnalyzer`, `IRenderer`, `IAudit`. A plugin's default export IS the runtime instance: the manifest fields (`id`, `kind`, `version`, `stability`, …) and the callable method(s) (`walk`, `detect`, `evaluate`, `render`, `run`) live on the same object, so ESM dynamic imports don't need a `new` dance.

  **Shared utility `trigger-normalize`**: the six-step Unicode pipeline (NFD → strip `Mn` → lowercase → separator unification → whitespace collapse → trim) from `spec/architecture.md` §Detector trigger normalization. Every detector that emits invocation-style links uses it; the `trigger-collision` rule keys on its output.

  **Adapter: `claude`.** Walks Claude Code's on-disk conventions (`.claude/agents/`, `.claude/commands/`, `.claude/hooks/`, `.claude/skills/<name>/SKILL.md`, plus `notes/**/*.md` and a catch-all → `note`), parses frontmatter via js-yaml (tolerant of malformed YAML), uses an async iterator so large scopes don't buffer, and honours a default ignore set (`.git`, `node_modules`, `dist`, `.skill-map`) plus any extras the caller passes.

  **Detectors: `frontmatter`, `slash`, `at-directive`.** Frontmatter extracts structured refs from `metadata.supersedes[]`, `supersededBy` (inverted so the edge points from the new node), `requires[]`, `related[]`. Slash matches `/<command>` tokens in the body with namespace support (`/skill-map:explore`), dedupes on normalized trigger. At-directive matches `@<handle>` with email filtering (`foo@bar.com` skipped) and both scope/name and ns:verb namespaces.

  **Rules: `trigger-collision`, `broken-ref`, `superseded`.** Trigger-collision buckets links by `trigger.normalizedTrigger` and emits error for any bucket with ≥2 distinct targets. Broken-ref resolves path-style targets against `node.path` and trigger-style targets against `frontmatter.name` (normalized, with the leading sigil stripped) — warn severity because authors commonly reference external artifacts. Superseded surfaces every `metadata.supersededBy` as an info finding on the source node.

  **Renderer: `ascii`.** Plain-text dump grouped by node kind, then links, then issues. Minimal — mermaid/dot live as later drop-ins.

  **Audit: `validate-all`.** Post-scan consistency check via AJV against `node.schema.json` / `link.schema.json` / `issue.schema.json`. Plugin manifests are already validated at load time by the PluginLoader (Step 1b), so this audit focuses on user content.

  **Orchestrator wire-up.** `runScan()` now actually iterates: for each adapter, walk roots → classify → build Node (sha256 body/frontmatter hashes, triple-split bytes, stability/version/author denormalised), feed scope-appropriate detectors, collect links, denormalise `linksOutCount` / `linksInCount`, then run every rule over the graph. Links emitting a kind outside the detector's declared `emitsLinkKinds` allowlist are silently dropped.

  **`sm scan`** defaults to the built-in set and exits 1 when the scan surfaces issues (per `cli-contract.md` §Exit codes). A new `--no-built-ins` flag reproduces the kernel-empty-boot zero-filled parity for conformance.

  **Drop-in proof.** The orchestrator iterates `registry.all('<kind>')` — adding a 4th detector is one new file under `src/extensions/detectors/` plus one entry in `src/extensions/built-ins.ts`. Zero kernel edits. Step 4's `external-url-counter` ships as the live proof.

  **Tests.** 52 new tests across normalization, claude adapter, three detectors, three rules, ascii renderer, validate-all audit, and an end-to-end scan against a fixture — 88 of 88 passing. The test glob widened to pick up the colocated `extensions/**/*.test.ts` and `kernel/**/*.test.ts` files that match the `src/extensions/README.md` convention ("each extension is a directory with a manifest + implementation + a sibling `*.test.ts`").

  **Side touches.** `js-yaml` now runs on both sides of the workspace boundary (ui had it since Step 0c; the adapter brings it to src). `docs/cli-reference.md` regenerated to reflect the new `--no-built-ins` flag on `sm scan`.

  Classification: minor per `spec/versioning.md` §Pre-1.0. Fourth feature surface after Steps 1a / 1b / 1c; `skill-map` bumps to the next minor.

### Patch Changes

- Updated dependencies [69572fd]
- Updated dependencies [2699276]
  - @skill-map/spec@0.5.0

## 0.2.0

### Minor Changes

- 3e89d8f: Bump minimum Node version to **24+** (active LTS since October 2025).

  - `engines.node: ">=24.0"` in the reference-impl package.json (root + `src/`).
  - `@types/node` bumped to `^24.0.0`.
  - ROADMAP Decision #1, Stack conventions, and AGENTS.md aligned.

  Rationale: Node 22.5 gave us stable `node:sqlite` but 24 is now the active LTS (Node 22 enters maintenance Oct 2026). The jump buys built-in WebSocket (unblocks Step 13 without a `ws` dependency), the modern ESM loader API, and several runtime improvements Kysely / Clipanion already rely on. No known dependency blocks the bump. Users still on Node 20 are already outside LTS and are not supported.

### Patch Changes

- 5935948: Align kernel domain types with `spec/schemas/`. The Step 0b stub types for `Node`, `Link`, `Issue`, `Extension`, and `PluginManifest` were invented names that diverged from the normative schemas; they compiled only because the `runScan` stub never materialized any instance. This patch closes the drift before Step 4 starts consuming the types in earnest.

  - **`Node`** now matches `node.schema.json`: `path`, `kind`, `adapter`, `bodyHash`, `frontmatterHash`, `bytes` (triple-split `{ frontmatter, body, total }`), `linksOutCount`, `linksInCount`, `externalRefsCount` required; `title`, `description`, `stability`, `version`, `author`, `frontmatter`, `tokens` optional. Removed ad-hoc `name` / `metadata`.
  - **`Link`** now matches `link.schema.json`: `source` (was `from`), `target` (was `to`), `kind` (new discriminator `invokes | references | mentions | supersedes`), `confidence: 'high' | 'medium' | 'low'` (was `exact | fuzzy`), `sources: string[]` (was singular `detector`), `trigger: { originalTrigger, normalizedTrigger } | null` (was flat top-level), plus optional `location`, `raw`.
  - **`Issue`** now matches `issue.schema.json`: `analyzerId` (was `rule`), `severity: 'error' | 'warn' | 'info'` (was `'warning'`), `nodeIds` (was `nodes`), plus optional `linkIndices`, `detail`, `fix`, `data`. Removed top-level `id` (DB-only autoincrement, not in the schema).
  - **`Extension`** extended with `version` (required), plus optional `description`, `stability`, `preconditions`, `entry` — matches `spec/schemas/extensions/base.schema.json`.
  - **`PluginManifest`** renamed `entries` → `extensions` (string paths); added `description`, `storage` (`oneOf` `kv | dedicated`), `author`, `license`, `homepage`, `repository` — matches `spec/schemas/plugins-registry.schema.json`.
  - New exported types: `NodeKind`, `LinkKind`, `Confidence`, `Severity`, `Stability`, `TripleSplit`, `LinkTrigger`, `LinkLocation`, `IssueFix`, `PluginStorage`.
  - **Tests**: imports normalized from `.ts` → `.js` (runtime-correct with `verbatimModuleSyntax`). `tsconfig.include` now lists `test/**/*`; `exclude` no longer skips `test` — typecheck covers tests going forward. Added coverage for `sm scan <roots...> --json` passing custom roots through. Dead copy-paste (`void k`) removed from the ISO-8601 test.
  - **Conformance runner cleanup**: removed `PATH_SEP` re-export (consumers import `sep` from `node:path` directly) and `caseFixturePath` helper (dead parameter, zero consumers). `assertSpecRoot` retained as defensive API.

  Classification: patch. Public types were unreleased Step 0b stubs; no consumer relied on the old shapes. The changes are corrections toward the already-published spec contract, not new behaviour.

- 1455cb1: Fix `sm version`: the `spec` line now reports the `@skill-map/spec` npm package version (e.g. `0.2.0`) instead of the `index.json` payload-shape version (which was `0.0.1` in every release).

  The CLI was reading `specIndex.specVersion`, which the spec renamed to `indexPayloadVersion` in the same release and was never the right field for this purpose — the payload version tracks changes to `index.json`'s own shape, not the spec a user is running against. `sm version` now reads `specIndex.specPackageVersion` (new top-level field in `@skill-map/spec`, populated from `spec/package.json.version`).

  Requires `@skill-map/spec` ≥ the release that introduces `specPackageVersion`. No CLI surface change; only the value changes in the output line.

- Updated dependencies [334c51a]
- Updated dependencies [3e89d8f]
- Updated dependencies [334c51a]
- Updated dependencies [d41b9ae]
- Updated dependencies [93ffe34]
- Updated dependencies [d41b9ae]
- Updated dependencies [5935948]
- Updated dependencies [1455cb1]
- Updated dependencies [1455cb1]
- Updated dependencies [93ffe34]
- Updated dependencies [1455cb1]
- Updated dependencies [334c51a]
- Updated dependencies [93ffe34]
- Updated dependencies [93ffe34]
- Updated dependencies [d41b9ae]
- Updated dependencies [93ffe34]
- Updated dependencies [93ffe34]
  - @skill-map/spec@0.3.0

## 0.1.0

### Minor Changes

- 5b3829a: Step 0b — Implementation bootstrap:

  - `src/` workspace scaffolded (TypeScript strict, Node ESM, tsup build, tsx test loader).
  - Hexagonal skeleton: 5 ports (`StoragePort`, `FilesystemPort`, `PluginLoaderPort`, `RunnerPort`, `ProgressEmitterPort`) + `Registry` covering the six extension kinds + kernel shell + `runScan` stub that returns a well-formed empty `ScanResult`.
  - CLI (Clipanion v4): `sm --version`, `sm --help`, `sm scan [roots...] [--json]`. Binary wrapper at `bin/sm.mjs`.
  - Contract test runner (`src/conformance/index.ts`): loads a case JSON, provisions a tmp scope, invokes the binary, evaluates 5 of 6 assertion types (`file-matches-schema` marked NYI — lands with Step 2 when ajv is introduced).
  - Unit + integration tests with `node:test`: 13 tests covering the Registry, kernel, CLI surface, and conformance runner.
  - CI extended with `build-test` job (typecheck + tsup + tests).

  First cut of the reference implementation.

### Patch Changes

- Updated dependencies [5b3829a]
- Updated dependencies [4e0aec4]
  - @skill-map/spec@0.1.0
