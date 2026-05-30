# Contributing to skill-map

Thanks for your interest in `skill-map`. The project is in active pre-1.0 development, Steps 0a–9 are complete, Step 14 (Full Web UI) is in progress, and wave 2 (job subsystem + LLM verbs) follows. See [ROADMAP.md](./ROADMAP.md) for the full design narrative, decision log, and the canonical completeness marker.

## Project status: pre-1.0, external code contributions paused

skill-map is still under construction toward its first stable release (`v1.0`). The spec, kernel APIs, and internal architecture move week to week, so reviewing and merging outside code against a moving target costs more than it gives, for both sides.

**Until `v1.0` ships, external pull requests are not accepted.** PRs from outside the core team will be closed with a pointer to open a feature request instead. This is deliberate, not a judgement on the contribution.

What is open right now, and genuinely wanted:

- **Feature requests / new functionality**: [open a feature request](https://github.com/crystian/skill-map/issues/new/choose). These feed the roadmap directly.
- **Bug reports**: [open a bug report](https://github.com/crystian/skill-map/issues/new/choose).

Once `v1.0` lands this policy relaxes and the normal pull-request flow described below applies.

## Before contributing

- Read [ROADMAP.md](./ROADMAP.md) end-to-end. It captures the architectural non-negotiables (kernel-first, spec as public standard, deterministic by default, CLI-first, tests from commit 1).
- Read [AGENTS.md](./AGENTS.md) for the day-to-day operating rules (changeset discipline, version-bump policy, kernel boundaries, sanitization, i18n, lint).
- Check the decision log in the roadmap before proposing something that was already considered and deferred / discarded.

## Contribution channels

- **Bug reports + feature requests**: [GitHub Issues](https://github.com/crystian/skill-map/issues/new/choose). Pick the matching template. These are open and welcome at any time, including pre-1.0.
- **Pull requests**: **paused until `v1.0`** for external contributors (see Project status above). The flow below (changesets, bump policy, merge pipeline) documents how internal PRs work and how external PRs will work once the project opens up.

## Code standards

- TypeScript strict mode, Node ESM, Node ≥ 24.0.
- Every extension ships a sibling `*.test.ts`. Missing test → contract check fails → tool does not boot.
- No feature is added without updating `spec/` first (when normative). Spec > ROADMAP > AGENTS, in that authority order.
- Lint clean: `pnpm lint` (CI runs it via `pnpm validate`). Both errors AND warnings block CI, there are no `warn` rules in the config.
- All artifacts in English (code, commits, PRs, docs). Conversation language follows the activation rule in AGENTS.md.

## Versioning, changesets + integrity hashes

Every PR that touches a versioned workspace **must** include a changeset. CI blocks the merge otherwise.

Versioned workspaces, those whose version drives a publish or a public deploy:

- `spec/` → publishes `@skill-map/spec` to npm.
- `src/` → publishes `@skill-map/cli` to npm.
- `web/` → private, but a version bump retags the public site deploy.

Workspaces declared in `pnpm-workspace.yaml` but exempt from the changeset gate (private internals; their changes ride along the next versioned-workspace bump):

- `ui/`, bundled inside `@skill-map/cli`; user-visible UI changes that warrant a CHANGELOG entry are described in the CLI changeset that ships them.
- `e2e/`, Playwright suite, never published.

### Creating a changeset

```bash
pnpm release:changeset
```

Pick the affected package(s), the bump type, and write a **one short paragraph** summary. That single paragraph is the exact text published to the package `CHANGELOG.md`, so keep it terse (what changed, where a reader notices it) and put the deep design detail (why, how, which files) in the PR description, not the changeset. This is enforced: a pre-commit guard rejects a changeset body that has a table, a sub-heading, a sub-bullet, more than one paragraph, or exceeds 500 chars. Commit the generated `.changeset/*.md` with your change.

Editing a workspace's own `CHANGELOG.md` is release notes, not a releasable change, so it does **not** require a changeset of its own (the gate filters `CHANGELOG.md` out). Private workspaces (`ui/`, `web/`) ship no `CHANGELOG.md`: `ui/` gets no changeset, `web/` still bumps (its version tags the deploy) but `web/CHANGELOG.md` (and `ui/CHANGELOG.md`) are gitignored, so `changeset version` regenerates `web/CHANGELOG.md` only transiently (the changesets action reads it for the "Version Packages" PR body) and it never lands in a commit, since nobody installs or reads the private packages.

### Changelogs

The repo root `CHANGELOG.md` is the **generated consolidated release changelog**: one collapsible `<details>` per CLI release, newest first, with the CLI version + ISO `YYYY-MM-DD` date in the summary and `### CLI Minor` / `### CLI Patch` / `### Spec Minor (x.y.z)` / `### Spec Patch (x.y.z)` sections inside (no commit hashes, no dependency-update noise, one short bullet per changeset). It is generated at release time by `scripts/build-changelog.js`, wired into `release:version` right after `build-user-changelog.js` and before `changeset version`; do not hand-edit it. The per-package npm changelogs (`src/CHANGELOG.md`, `spec/CHANGELOG.md`) drop the commit-hash prefix and the `Updated dependencies` blocks going forward via the custom changesets module `scripts/changeset-changelog.cjs` (`.changeset/config.json` points `changelog` at it); they are also generated, not hand-edited. The Step-by-step execution narrative lives in [`context/execution-history.md`](./context/execution-history.md).

### Bump policy

- **Breaking change**:
  - Post-1.0: `major`.
  - **Pre-1.0** (workspace still in `0.Y.Z`): `minor`. Per [`spec/versioning.md`](./spec/versioning.md) § Pre-1.0, breakings are allowed inside minor bumps pre-1; the first `1.0.0` is a deliberate stabilization moment, not a side-effect of a normal PR. If a changeset proposes `major` while the workspace is pre-1, downgrade it to `minor` and document the breaking change in the workspace `CHANGELOG.md`.
- **Additive change** → `minor`.
- **Fix / internal** → `patch`.

### What happens on merge

1. PR to `main` → CI checks changeset presence + `spec/index.json` integrity + `context/cli-reference.md` integrity + lint + build + tests.
2. Merge to `main` → `release` workflow opens (or updates) a **"Version Packages"** PR that bumps `package.json` files, consumes the changesets, and updates CHANGELOGs.
3. Merge the Version Packages PR → publishes to npm and creates a git tag.

Nothing ships to npm without an explicit merge of the Version Packages PR.

### Integrity hashes

`spec/index.json` carries a sha256 per file shipped. Regenerate after any change under `spec/`:

```bash
pnpm --filter @skill-map/spec spec          # regenerate
pnpm --filter @skill-map/spec spec:check    # verify (used by CI via root validate)
```

The orchestrator (`pnpm validate`) runs `spec:check` for every PR through the spec workspace's `validate`. Drift → red build. A pre-commit hook (`.githooks/pre-commit`, wired automatically by `pnpm install` via the root `prepare` script that sets `core.hooksPath`) also runs the spec workspace's `validate` whenever a commit touches `spec/`, so an out-of-sync `index.json` fails locally before reaching CI.

Same discipline applies to the auto-generated CLI reference at `context/cli-reference.md`:

```bash
pnpm --filter @skill-map/cli reference         # regenerate from `sm help --format md`
pnpm --filter @skill-map/cli reference:check   # verify (used by CI via root validate)
```

### Version Packages PR exception

The bot-opened branch `changeset-release/*` is exempt from the "changeset required" check, it consumes changesets rather than adding them.

## See also

- [ROADMAP.md](./ROADMAP.md), design narrative, decisions, execution plan.
- [AGENTS.md](./AGENTS.md), operating manual for AI agents, spec editing rules, maintenance checklist, kernel boundary invariants.
- [spec/versioning.md](./spec/versioning.md), semver policy for the spec (patch/minor/major definitions).
- [spec/CHANGELOG.md](./spec/CHANGELOG.md), spec-specific release history.

## License

By contributing you agree that your contributions will be licensed under the [MIT License](./LICENSE).
