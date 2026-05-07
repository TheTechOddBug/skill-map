# Conformance coverage — `gemini` Provider

Authoritative map of the Provider-owned schemas at
[`../schemas/`](../schemas/) to the conformance cases that exercise them.
Mirrors the format used by the `claude` Provider's coverage file.

CI runs the cases via `sm conformance run --scope provider:gemini`; a
separate inventory check before each Provider release compares the
schema set under `schemas/` against the matrix below and fails on
drift.

## Coverage matrix

| # | Schema | Case(s) | Status | Notes |
|---|---|---|---|---|
| 1 | `schemas/agent.schema.json` | `basic-scan` | 🟢 covered | `minimal-gemini/.gemini/agents/reviewer.md` carries `model` + `tools` + `temperature` + `max_turns` per Google's documented frontmatter (https://geminicli.com/docs/core/subagents/). |
| 2 | `schemas/skill.schema.json` | `basic-scan` | 🟢 covered | `minimal-gemini/.gemini/skills/code-review/SKILL.md` exercises the minimal `name` + `description` shape. |
| 3 | `schemas/markdown.schema.json` | `basic-scan` | 🟢 covered | `minimal-gemini/GEMINI.md` exercises the no-extras kind (the format-named generic fallback). |

Status legend: 🟢 covered (at least one case asserts the schema
end-to-end) · 🟡 partial (covered only indirectly or via a sub-shape) ·
🔴 missing.

## Cases shipped with this Provider

| Id | Verifies | Fixture(s) |
|---|---|---|
| `basic-scan` | Scanning the `minimal-gemini` corpus detects exactly three nodes (one per kind: agent, skill, markdown) with no issues. Implicitly validates each per-kind schema via the kernel's frontmatter-validation flow. | `minimal-gemini` |

Each case file under [`cases/`](./cases/) is self-describing — see
[`spec/conformance/README.md`](../../../../../spec/conformance/README.md)
for the case format and assertion catalog.

## Release gates

- **Provider v0.x**: partial coverage acceptable. Every case added as
  the Provider lands the kind that makes it runnable.
- **Provider v1.0.0 release**: all rows above MUST be 🟢 covered or
  explicitly 🟠 deferred to a future minor with a linked issue.
- **CI check**: `sm conformance run --scope provider:gemini` on every
  PR. A schema without a row here, or a row pointing at a missing
  schema, fails the release gate.
