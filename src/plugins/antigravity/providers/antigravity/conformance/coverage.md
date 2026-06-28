# Conformance coverage, `antigravity` Provider

Authoritative map of the Provider-owned schemas at
[`../schemas/`](../schemas/) to the conformance cases that exercise them.
Mirrors the format used by the `claude`, `codex`, and `agent-skills`
Providers.

This file is hand-maintained. CI runs the cases via
`sm conformance run --scope provider:antigravity`; a separate inventory
check before each Provider release compares the schema set under
`schemas/` against the matrix below and fails on drift.

## Coverage matrix

| # | Schema | Case(s) | Status | Notes |
|---|---|---|---|---|
| 1 | `schemas/workflow.schema.json` | `basic-scan`, `workflow-links` | 🟢 covered | `demo-antigravity/.agent/workflows/{deploy,release}.md` exercise the real Antigravity workflow shape: the required `description` (the only workflow frontmatter field, no `name`, the handle is the filename) plus the body `// turbo` / `// turbo-all` markup. Classified as `antigravity`/`workflow` under the pinned antigravity lens. `workflow-links` additionally drives the `/name` slash invocations through the resolution matrix. |

Status legend: 🟢 covered (at least one case asserts the schema
end-to-end) · 🟡 partial (covered only indirectly or via a sub-shape) ·
🔴 missing.

The `skill` kind is NOT antigravity-owned: antigravity composes the
open-standard `.agents/skills/<name>/SKILL.md` classification from the
`agent-skills` Provider (read rule, kind, schema, resolution, reserved
names), so its schema is exercised by `agent-skills`'s own conformance
suite. The `basic-scan` and `workflow-links` cases prove the composition
end to end under the antigravity lens (skills classify as
`antigravity`/`skill`, and a workflow's `/skill-name` invocation resolves
to one).

## Cases shipped with this Provider

| Id | Verifies | Fixture(s) |
|---|---|---|
| `basic-scan` | Scanning the `demo-antigravity` corpus classifies the two `.agent/workflows/*.md` files as `antigravity`/`workflow` (own kind), the two `.agents/skills/*/SKILL.md` files as `antigravity`/`skill` (open-standard composition), and the four markdown files (`AGENTS.md`, three docs) via the `core/markdown` fallback, eight nodes with no issues. Lens pinned via `.skill-map/settings.json` (the fixture carries both `.agent/workflows/` and `.agents/` markers). | `demo-antigravity` |
| `workflow-links` | Under the antigravity lens the slash extractor resolves `/name` invocations across BOTH kinds (`invokes: ['skill', 'workflow']`): a workflow's `/run-tests` / `/changelog-entry` resolve to skills, a workflow's `/deploy` resolves to another workflow, and AGENTS.md's `/deploy` (a `core/markdown` node) resolves to the deploy workflow. With the markdown links to the docs, eight resolved edges. | `demo-antigravity` |
| `reserved-names` | The reserved-name catalog covers both slash-invocable kinds: a workflow named `tasks` and a skill named `goal` each shadow an `agy` built-in, so `core/name-reserved` flags both via self scope, two nodes, two warn issues. | `demo-antigravity-reserved` |
| `at-file-references` | Under the antigravity lens the vendor-neutral `core/at-file` extractor (gated to claude / codex / antigravity) turns a file-shaped `@<path>` token in a workflow / skill body into a path-resolved `references` edge, Antigravity's `@filename` file pointer (file-picker grammar like Codex's, not Claude's agent mention): a workflow `@test.md`, a workflow `@../../docs/guide.md` (multi-level relative prefix), and a skill `@../notify/SKILL.md`, five nodes, three resolved edges, no issues. | `demo-antigravity-at-file` |

Each case file under [`cases/`](./cases/) is self-describing, see
[`spec/conformance/README.md`](../../../../../../spec/conformance/README.md)
for the case format and assertion catalog.

## Release gates

- **Provider v0.x**: partial coverage acceptable. Every case added as
  the Provider lands the kind that makes it runnable.
- **Provider v1.0.0 release**: all rows above MUST be 🟢 covered or
  explicitly 🟠 deferred to a future minor with a linked issue.
- **CI check**: `sm conformance run --scope provider:antigravity` on
  every PR. A schema without a row here, or a row pointing at a missing
  schema, fails the release gate.
