# Conformance coverage, `agent-skills` Provider

Authoritative map of the Provider-owned schemas at
[`../schemas/`](../schemas/) to the conformance cases that exercise them.
Mirrors the format used by the `claude` Provider.

## Coverage matrix

| # | Schema | Case(s) | Status | Notes |
|---|---|---|---|---|
| 1 | `schemas/skill.schema.json` | `basic-scan` | 🟢 covered | `minimal-agent-skills/.agents/skills/code-review/SKILL.md` exercises the open-standard `name` + `description` shape. |

Status legend: 🟢 covered (at least one case asserts the schema
end-to-end) · 🟡 partial (covered only indirectly or via a sub-shape) ·
🔴 missing.

## Cases shipped with this Provider

| Id | Verifies | Fixture(s) |
|---|---|---|
| `basic-scan` | Scanning the `minimal-agent-skills` corpus detects exactly one `skill` node at the open-standard path `.agents/skills/<name>/SKILL.md` with no issues. | `minimal-agent-skills` |

## Release gates

- **CI check**: `sm conformance run --scope provider:agent-skills` on
  every PR. A schema without a row here, or a row pointing at a
  missing schema, fails the release gate.
