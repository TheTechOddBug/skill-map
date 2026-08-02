# Contributing to skill-map

Thanks for your interest in `skill-map`. For the current state of the work, read the completeness marker in [ROADMAP.md](./ROADMAP.md) (search for `YOU ARE HERE`), which is the canonical source alongside the full design narrative and decision log. This file deliberately does not restate the step status: a duplicated summary here went stale for months, still describing the job subsystem as upcoming long after it shipped.

## Project status: external code contributions paused

The spec, kernel APIs, and internal architecture still move week to week, so reviewing and merging outside code against a moving target costs more than it gives, for both sides.

**External pull requests are not accepted right now.** PRs from outside the core team will be closed with a pointer to open a feature request instead. This is deliberate, not a judgement on the contribution.

Note this is a standing policy, not one tied to a version number: shipping `1.0.0` freezes the SPEC, which is a different promise from opening the contribution flow. The policy changes when this section changes, and not before.

What is open right now, and genuinely wanted:

- **Feature requests / new functionality**: [open a feature request](https://github.com/crystian/skill-map/issues/new/choose). These feed the roadmap directly.
- **Bug reports**: [open a bug report](https://github.com/crystian/skill-map/issues/new/choose).

When the policy relaxes, the normal pull-request flow described below applies. Until this section says otherwise, it has not.

## Before contributing

- Read [ROADMAP.md](./ROADMAP.md) end-to-end. It captures the architectural non-negotiables (kernel-first, spec as public standard, deterministic by default, CLI-first, tests from commit 1).
- Read [AGENTS.md](./AGENTS.md) for the day-to-day operating rules (changeset discipline, version-bump policy, kernel boundaries, sanitization, i18n, lint).
- Check the decision log in the roadmap before proposing something that was already considered and deferred / discarded.

## Repo layout

```
skill-map/                     pnpm workspaces root (private)
├── spec/                      specification, published as @skill-map/spec
├── src/                       reference implementation, published as @skill-map/cli (bins: sm, skill-map)
├── ui/                        Angular SPA (graph, list, inspector), bundled into @skill-map/cli
├── web/                       public site (skill-map.ai), hosts the demo bundle
├── scripts/                   build & validation scripts (spec index, CLI reference, demo dataset, …)
├── ...
├── AGENTS.md                  agent operating manual
└── ROADMAP.md                 design narrative (decisions, phases, deferred)
```

## Contribution channels

- **Bug reports + feature requests**: [GitHub Issues](https://github.com/crystian/skill-map/issues/new/choose). Pick the matching template. These are open and welcome at any time, including pre-1.0.
- **Pull requests**: **paused until `v1.0`** for external contributors (see Project status above). The flow below (changesets, bump policy, merge pipeline) documents how internal PRs work and how external PRs will work once the project opens up.

## Reporting a bug: minimal reproduction

skill-map's whole job is scanning Markdown, so almost every bug is really about the `.md` files it read: how they are parsed, linked, or rendered. A report without those files is one we cannot reproduce. The single most useful thing you can attach is the **smallest set of `.md` files that still triggers the bug**, and nothing else.

Why minimal, not "my whole project": a 300-file tree buries the one file that matters, drags in private content you did not mean to share, and makes the maintainer guess which lens and which references are in play. Two or three focused files reproduce it in seconds and often drop straight into `fixtures/` as a regression test.

How to reduce a real project down to the minimum:

1. **Reproduce it in place first.** Note the exact command (`sm scan`, `sm scan ./some-root`, whatever it was) and what you saw versus what you expected.
2. **Copy the scanned tree out** to a throwaway folder: the `.skill-map/` directory plus the `.md` files it walks. Confirm the bug still reproduces from the copy.
3. **Delete in big chunks.** Remove whole folders and files, re-run the command, and if it still reproduces keep them deleted. Keep halving what is left until every remaining file is load-bearing.
4. **Shrink each survivor.** Strip frontmatter keys, links, and sections that are not needed. A file that still triggers the bug at 10 lines beats the original at 200.
5. **Re-run one last time** on the reduced tree to confirm it still fails, then capture `sm scan --json` on that tree.

Most reports land at one to three short files. Paste the file tree plus each file's contents into the bug report, or drag a `.zip` of the reduced tree into the form. Include the exact command and the `--json` output so we see the same thing you do.

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

The repo root `CHANGELOG.md` is the **generated consolidated release changelog**: one collapsible `<details>` per CLI release, newest first, with the CLI version + ISO `YYYY-MM-DD` date in the summary and `### CLI Minor` / `### CLI Patch` / `### Spec Minor (x.y.z)` / `### Spec Patch (x.y.z)` sections inside (no commit hashes, no dependency-update noise, one short bullet per changeset). It is generated at release time by `scripts/build-changelog.js`, wired into `release:version` right after `build-user-changelog.js` and before `changeset version`; do not hand-edit it. The per-package npm changelogs (`src/CHANGELOG.md`, `spec/CHANGELOG.md`) drop the commit-hash prefix and the `Updated dependencies` blocks going forward via the custom changesets module `scripts/changeset-changelog.cjs` (`.changeset/config.json` points `changelog` at it); they are also generated, not hand-edited.

### Bump policy

Both public workspaces shipped `1.0.0` in 2026-08, so the post-1.0 rows below are the live ones; classify strictly, always the smallest bump the diff honestly requires. While a workspace is pre-1.0 (`0.Y.Z`) the semver roles shift one position down, per [`spec/versioning.md`](./spec/versioning.md) § Pre-1.0: minor is reserved for incompatibility, everything backward-compatible is a patch.

- **Breaking change**:
  - Post-1.0: `major`.
  - Pre-1.0: `minor`. If a changeset proposes `major` while the workspace is pre-1, downgrade it to `minor` and document the breaking change in the workspace `CHANGELOG.md`. The first `1.0.0` is a deliberate stabilization moment, not a side-effect of a normal PR.
- **Additive change**:
  - Post-1.0: `minor`.
  - Pre-1.0: `patch`. A release made only of additions and fixes must not bump minor: a patch is always safe to take, a minor means something breaks.
- **Fix / internal** → `patch`.

### What happens on merge

1. PR to `main` → CI checks changeset presence + `spec/index.json` integrity + lint + build + tests.
2. Merge to `main` → `release` workflow opens (or updates) a **"Version Packages"** PR that bumps `package.json` files, consumes the changesets, and updates CHANGELOGs.
3. Merge the Version Packages PR → publishes to npm and creates a git tag.

Nothing ships to npm without an explicit merge of the Version Packages PR.

### Publish provenance

Both public packages publish with **npm provenance**: every tarball ships a signed attestation binding it to this repo, the `release` workflow, and the exact commit that built it (Sigstore keyless signing, recorded in the public Rekor transparency log). A stolen `NPM_TOKEN` no longer buys a convincing release, an attacker can publish but cannot forge an attestation without running inside the workflow, so a version lacking one is a visible anomaly.

This is a **commitment to publishing only from CI**. A manual `npm publish` from a laptop produces a version with no attestation, which is exactly the anomaly the mechanism teaches people to distrust. If an emergency manual publish is ever unavoidable, say so in the release notes rather than leaving the gap unexplained.

**Verify after a release** (the failure mode of the plumbing silently dropping the flag is a release everyone believes is signed):

```bash
npm view @skill-map/cli --json | grep -i provenance   # attestation present on the version
npm audit signatures                                   # verifies registry signatures + provenance
```

The npm package page also shows a "Provenance" panel naming the source commit and workflow run. Provenance is configured in two places on purpose: `publishConfig.provenance` in each package (declarative, travels with the package) and `NPM_CONFIG_PROVENANCE` in the workflow (guarantees it even if `changeset publish` does not forward the field). The `id-token: write` permission in `release.yml` is what makes either path work.

### Integrity hashes

`spec/index.json` carries a sha256 per file shipped. Regenerate after any change under `spec/`:

```bash
pnpm --filter @skill-map/spec spec          # regenerate
pnpm --filter @skill-map/spec spec:check    # verify (used by CI via root validate)
```

The orchestrator (`pnpm validate`) runs `spec:check` for every PR through the spec workspace's `validate`. Drift → red build. A pre-commit hook (`.githooks/pre-commit`, wired automatically by `pnpm install` via the root `prepare` script that sets `core.hooksPath`) also runs the spec workspace's `validate` whenever a commit touches `spec/`, so an out-of-sync `index.json` fails locally before reaching CI.

CLI documentation is not a committed artifact: `sm help --format md` emits canonical markdown for the full command surface on demand, so there is nothing to keep in sync.

### Version Packages PR exception

The bot-opened branch `changeset-release/*` is exempt from the "changeset required" check, it consumes changesets rather than adding them.

### Release candidates (prereleases)

Normal releases publish under the npm `latest` dist-tag, so `npm i -g @skill-map/cli` (and any bare `@skill-map/cli`) resolves them automatically. A release candidate must NOT reach those users: it publishes under a separate `rc` dist-tag, opt-in only (`npm i -g @skill-map/cli@rc`), and `latest` stays pinned to the last stable. Both public packages (`@skill-map/cli`, `@skill-map/spec`) move together while in prerelease mode.

The channel is cut from a dedicated `release/rc` branch, never from `main`. The `release` workflow is armed for both branches and enforces the invariant that keeps `latest` clean: `main` must never carry `.changeset/pre.json`, and `release/rc` must always carry it (a guard step fails the run otherwise).

**Cut an RC:**

1. Branch from the commit you want to ship: `git switch -c release/rc` (or `git switch release/rc` if it already exists).
2. Enter pre mode and commit the generated file: `pnpm changeset pre enter rc`, then commit `.changeset/pre.json`. From here every version becomes an `-rc.N` prerelease.
3. Confirm the `.changeset/*.md` you want in the RC are present, then push `release/rc`.
4. CI opens a "Version Packages" PR against `release/rc` with `-rc.0` versions (e.g. `0.86.0-rc.0`). Review and merge it.
5. The merge triggers the publish pass: `changeset publish` ships under the `rc` tag automatically (pre mode picks the tag from `pre.json`). Verify with `npm dist-tag ls @skill-map/cli`, `latest` unchanged and `rc` pointing at the new version.

Testers install with `npm i -g @skill-map/cli@rc`.

**Iterate (rc.1, rc.2, ...):** add another `.changeset/*.md` on `release/rc`, push, merge the refreshed Version Packages PR. Each cycle increments the prerelease number.

**Promote to stable:** the real feature commits and their changesets land on `main` through the normal flow, and `main` cuts the stable release to `latest`. Do NOT merge `release/rc` into `main` (it carries `pre.json` and the `-rc` bumps). On `release/rc`, run `pnpm changeset pre exit` when the channel is done. Optionally retire the tag once stable ships: `npm dist-tag rm @skill-map/cli rc`.

**Gotchas:**

- Pre mode is sticky and global: while `pre.json` lives on the branch, every versioned package publishes as `-rc.N`. You cannot mix a stable and an RC on the same branch.
- `.changeset/pre.json` must never reach `main`. The workflow guard fails the release if it does, but keep it off `main` by construction (do prerelease work only on `release/rc`).
- `changeset version` consumes (deletes) the `.md` files on the branch. Keep the changesets that drive the eventual stable release on `main`; the `release/rc` branch is disposable.
- `.npmrc` sets `minimum-release-age=4320` (72h), which delays INSTALLS, not publishes. To test a fresh RC immediately, install in a clean environment that does not inherit the repo `.npmrc` (the release workflow's smoke step already does this by installing from a `mktemp -d`).

## See also

- [ROADMAP.md](./ROADMAP.md), design narrative, decisions, execution plan.
- [AGENTS.md](./AGENTS.md), operating manual for AI agents, spec editing rules, maintenance checklist, kernel boundary invariants.
- [spec/versioning.md](./spec/versioning.md), semver policy for the spec (patch/minor/major definitions).
- [spec/CHANGELOG.md](./spec/CHANGELOG.md), spec-specific release history.

## License

By contributing you agree that your contributions will be licensed under the [MIT License](./LICENSE).
