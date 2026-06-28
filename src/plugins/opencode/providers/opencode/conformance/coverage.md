# Conformance coverage, `opencode` Provider

Authoritative map of the Provider-owned schemas at
[`../schemas/`](../schemas/) to the conformance cases that exercise them.
Mirrors the format used by the `claude`, `codex`, and `agent-skills` Providers.

This file is hand-maintained. CI runs the cases via
`sm conformance run --scope provider:opencode`; a separate inventory check
before each Provider release compares the schema set under `schemas/` against
the matrix below and fails on drift.

## Coverage matrix

| # | Schema | Case(s) | Status | Notes |
|---|---|---|---|---|
| 1 | `schemas/agent.schema.json` | `basic-scan` | 🟢 covered | `demo-opencode/.opencode/agent/opencode-agent-review.md` exercises the OpenCode agent shape: required `description`, plus optional `mode` (`subagent`), `model`, and the `permission` map (`edit`/`bash`). Classified as `opencode`/`agent` under the lens pinned in `.skill-map/settings.json`. |
| 2 | `schemas/command.schema.json` | `basic-scan` | 🟢 covered | `demo-opencode/.opencode/commands/opencode-cmd-deploy.md` exercises the OpenCode command shape (`description`, `agent`), classified as `opencode`/`command`. The agent body invokes it via `/opencode-cmd-deploy`, resolving an `invokes` -> `command` edge. |

Status legend: 🟢 covered (at least one case asserts the schema end-to-end) ·
🟡 partial (covered only indirectly or via a sub-shape) · 🔴 missing.

The `skill` kind is NOT opencode-owned: opencode composes the open-standard
`skill` classification from the `agent-skills` Provider (kind, schema,
resolution) and routes the THREE skill homes OpenCode reads
(`.opencode/skills/`, `.claude/skills/`, `.agents/skills/`) into it, so the
skill schema itself is exercised by `agent-skills`'s own conformance suite.
The `basic-scan` case below proves the composition (and the asymmetric
Claude-compat) end to end under the opencode lens.

## Cases shipped with this Provider

| Id | Verifies | Fixture(s) |
|---|---|---|
| `basic-scan` | Scanning the `demo-opencode` corpus under the pinned opencode lens classifies `.opencode/agent/*.md` as `opencode`/`agent`, `.opencode/commands/*.md` as `opencode`/`command`, and skills from all three homes (`.opencode/skills/`, `.claude/skills/`, `.agents/skills/`) as `opencode`/`skill`, while the Claude-only `.claude/agents/` and `.claude/commands/` files, the skill support file, and `AGENTS.md` fall through to `core/markdown` (the asymmetric Claude-compat: skills cross over, agents/commands do not). Lens pinned via `.skill-map/settings.json` (the fixture carries `.opencode/`, `.claude/`, and `.agents/` markers, so auto-detect would be ambiguous). | `demo-opencode` |

Each case file under [`cases/`](./cases/) is self-describing, see
[`spec/conformance/README.md`](../../../../../../spec/conformance/README.md)
for the case format and assertion catalog.

## Release gates

- **Provider v0.x**: partial coverage acceptable. Every case added as the
  Provider lands the kind that makes it runnable.
- **Provider v1.0.0 release**: all rows above MUST be 🟢 covered or explicitly
  🟠 deferred to a future minor with a linked issue.
- **CI check**: `sm conformance run --scope provider:opencode` on every PR. A
  schema without a row here, or a row pointing at a missing schema, fails the
  release gate.
