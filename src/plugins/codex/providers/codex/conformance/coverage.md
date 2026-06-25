# Conformance coverage, `codex` Provider

Authoritative map of the Provider-owned schemas at
[`../schemas/`](../schemas/) to the conformance cases that exercise them.
Mirrors the format used by the `claude` and `agent-skills` Providers.

This file is hand-maintained. CI runs the cases via
`sm conformance run --scope provider:codex`; a separate inventory check
before each Provider release compares the schema set under `schemas/`
against the matrix below and fails on drift.

## Coverage matrix

| # | Schema | Case(s) | Status | Notes |
|---|---|---|---|---|
| 1 | `schemas/agent.schema.json` | `basic-scan`, `body-links` | 🟢 covered | `demo-codex/.codex/agents/{deployer,builder,reviewer}.toml` exercise the real Codex sub-agent shape: the required `name` + `description` + `developer_instructions`, plus the optional `model`, `model_reasoning_effort`, `sandbox_mode`, `nickname_candidates`, the `[mcp_servers.<name>]` table (deployer) and the `[[skills.config]]` array (reviewer). Classified as `codex`/`agent` under the auto-detected codex lens. `body-links` additionally drives the `developer_instructions` field through the body pipeline via `read.bodyField`. |

Status legend: 🟢 covered (at least one case asserts the schema
end-to-end) · 🟡 partial (covered only indirectly or via a sub-shape) ·
🔴 missing.

The `skill` kind is NOT codex-owned: codex composes the open-standard
`.agents/skills/<name>/SKILL.md` classification from the `agent-skills`
Provider (read rule, kind, schema, resolution, reserved names), so its
schema is exercised by `agent-skills`'s own conformance suite. The
`skills-scan` case below proves the composition end to end under the
codex lens (skills classify as `codex`/`skill`, agent `/skill` invocations
resolve).

## Cases shipped with this Provider

| Id | Verifies | Fixture(s) |
|---|---|---|
| `basic-scan` | Scanning the `demo-codex` corpus classifies three `.codex/agents/*.toml` files as `codex`/`agent` and four markdown files (`AGENTS.md`, two docs, one note) via the `core/markdown` fallback, seven nodes with no issues. | `demo-codex` |
| `body-links` | The Codex body extractor feeds each agent's TOML `developer_instructions` field through the link pipeline (`read.bodyField: 'developer_instructions'`), producing six resolved edges (`@mention` agent-to-agent links via the lens-gated `at-directive`, plus markdown links to the docs), so a TOML-only corpus with no file bodies still yields a connected graph. | `demo-codex` |
| `skills-scan` | Codex's multi-rule `read` classifies `.agents/skills/<name>/SKILL.md` as `codex`/`skill` (open-standard composition) next to a `.codex/agents/*.toml` agent, three nodes with no `provider-ambiguous`, and resolves both an `invokes` -> `skill` edge (agent `/run-tests`) and a `mentions` -> `agent` edge (skill `@builder`). Lens pinned via `.skill-map/settings.json` (the fixture carries both a `.codex/` and a `.agents/` marker). | `demo-codex-skills` |

Each case file under [`cases/`](./cases/) is self-describing, see
[`spec/conformance/README.md`](../../../../../../spec/conformance/README.md)
for the case format and assertion catalog.

## Release gates

- **Provider v0.x**: partial coverage acceptable. Every case added as
  the Provider lands the kind that makes it runnable.
- **Provider v1.0.0 release**: all rows above MUST be 🟢 covered or
  explicitly 🟠 deferred to a future minor with a linked issue.
- **CI check**: `sm conformance run --scope provider:codex` on every
  PR. A schema without a row here, or a row pointing at a missing
  schema, fails the release gate.
