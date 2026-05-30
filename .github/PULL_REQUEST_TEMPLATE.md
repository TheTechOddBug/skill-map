# Pull request

> **Heads up (pre-1.0):** skill-map is under active construction toward v1.0 and is **not accepting external pull requests** until v1.0 ships. PRs from outside the core team will be closed with a pointer to open a [feature request](https://github.com/crystian/skill-map/issues/new/choose) instead. See [CONTRIBUTING.md](./CONTRIBUTING.md). This template is for internal PRs.

## What and why

<!-- One or two sentences: what changed and where a reader notices it. The deep design detail (why, how, which files) lives here, not in the changeset. -->

## Checklist

- [ ] Spec updated first when the change is normative (authority order: `spec/` > ROADMAP > AGENTS).
- [ ] `.changeset/*.md` added for any versioned workspace touched (`spec/`, `src/`, `web/`), one short paragraph.
- [ ] `## User-facing` section added to the changeset when an operator who installed `sm` notices the change.
- [ ] Tests added or updated; `pnpm validate` is green.
- [ ] `spec/index.json` regenerated if affected.
- [ ] ROADMAP.md kept in sync (execution plan, decision log, completeness marker).
- [ ] English only, no em dashes in artifacts.
