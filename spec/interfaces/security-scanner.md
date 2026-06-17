# Security scanner interface

Normative contract for third-party security-scanning plugins (Snyk, Socket, custom rulesets, similar). A security scanner is NOT a new extension kind, it is a **convention over the existing `Action` kind**, defined so that:

- Multiple vendors can ship interoperable scanners.
- `sm findings` can aggregate findings across scanners uniformly.
- The UI can present a single "Security" panel regardless of which scanners are present.

---

## Why a convention, not a new kind

The six extension kinds are locked ([`architecture.md`](../architecture.md)). A seventh for "security" would conflate concerns: scanners are actions that produce a specialized report. A convention lets any Action opt into the scanner surface with no kernel changes.

---

## Identifying a scanner

A plugin-provided Action is treated as a security scanner when both:

1. Its `id` starts with `security-` (lowercase kebab-case).
2. Its manifest declares `"kind": "scanner"` under `"tags"` (future-proof label; non-normative today but RECOMMENDED).

Example manifest:

```json
{
  "id": "security-snyk",
  "version": "1.0.0",
  "specCompat": "^1.0.0",
  "extensions": ["extensions/snyk.action.js"],
  "tags": ["kind:scanner", "vendor:snyk"]
}
```

The kernel does NOT enforce the `security-` prefix, any Action may produce findings conforming to this schema. But `sm findings --security` and the UI's Security panel filter by prefix **OR** the `tags` label.

---

## Input

The Action receives a standard invocation: a single node, or (via `--all`) the set of nodes matching the Action's `preconditions`. Scanners typically set:

```json
{
  "preconditions": { "kind": ["skill", "agent", "command", "hook", "note"] }
}
```

i.e. applies to every node. A scanner MAY narrow to specific kinds if the vendor's check only applies to, e.g., shell-hook content.

Scanners are **deterministic-mode** Actions by default: no LLM involvement. The Action runs its own logic (HTTP request to a vendor API, local regex scan, dependency check) and writes a report. Scanners MAY also be `probabilistic` Actions if they rely on model analysis; the same report shape applies.

---

## Output: the `SecurityReport` shape

Every scanner MUST produce a report conforming to this shape, extending [`report-base.schema.json`](../schemas/report-base.schema.json) with scanner-specific fields.

```jsonc
{
  "confidence": 0.9,
  "safety": {
    "injectionDetected": false,
    "contentQuality": "clean"
  },

  "scanner": {
    "id": "security-snyk",
    "version": "1.0.0",
    "vendor": "Snyk",
    "ranAt": 1745159465000,
    "durationMs": 240
  },

  "findings": [
    {
      "id": "security-snyk:SNYK-JS-LODASH-567746",
      "severity": "error",
      "category": "vulnerability",
      "title": "Prototype Pollution in lodash",
      "description": "...",
      "nodePath": "skills/my-skill.md",
      "locations": [
        { "line": 42, "column": 5, "length": 12, "raw": "lodash@4.17.15" }
      ],
      "references": [
        "https://snyk.io/vuln/SNYK-JS-LODASH-567746",
        "https://github.com/advisories/GHSA-..."
      ],
      "remediation": {
        "summary": "Upgrade to lodash >= 4.17.21.",
        "autofixable": false
      },
      "meta": { "cvss": 7.3, "cwe": "CWE-1321" }
    }
  ],

  "stats": {
    "totalFindings": 1,
    "bySeverity": { "error": 1, "warn": 0, "info": 0 }
  }
}
```

### Field reference

**Scanner envelope** (`scanner.*`), REQUIRED:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Matches the Action's id. |
| `version` | string (semver) | Scanner version at run time. |
| `vendor` | string | Human-readable vendor name. |
| `ranAt` | integer | Unix ms. |
| `durationMs` | integer | Scan duration. |

**Finding** (`findings[]`), ZERO OR MORE. Each finding MUST include:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Globally unique finding id. Convention: `<scannerId>:<vendorFindingId>`. |
| `severity` | enum | `error` / `warn` / `info`. Maps to deterministic issue severity for aggregation. |
| `category` | string | A normative category below, or a vendor-specific string prefixed `vendor:`. |
| `title` | string | Short human-readable summary. |
| `description` | string | Longer explanation; markdown-friendly. |
| `nodePath` | string | The `node.path` this finding references. |
| `locations` | array\|null | Optional in-file locations. Each has `line` (required), `column`, `length`, `raw`. |
| `references` | array\|null | External URLs (CVE, advisory, blog post). |
| `remediation` | object\|null | `summary` (string), `autofixable` (boolean). Autofix is advisory, the kernel does not invoke it. |
| `meta` | object\|null | Vendor-specific free-form: CVSS, CWE, CPE, etc. |

**Stats** (`stats.*`), REQUIRED summary:

| Field | Type | Meaning |
|---|---|---|
| `totalFindings` | integer | MUST equal `findings.length`. |
| `bySeverity` | object | Map `severity → count`. All three severities MUST be present even if zero. |

### Normative finding categories

A `category` value SHOULD be one of these for interoperability:

- `vulnerability`, known CVE, dependency advisory, version range with known exploit.
- `misconfiguration`, insecure default, exposed secret, weak permission, missing header.
- `credential-leak`, secret material (API key, token, password) detected in content.
- `injection-risk`, pattern likely to enable prompt injection, SQL injection, command injection.
- `license-violation`, incompatible license terms for a dependency or referenced asset.
- `outdated`, version pinned well below current, not exploited but due for upgrade.
- `policy-violation`, organization-level analyzer (naming, banned words, required disclaimer).

Vendors MAY introduce their own category prefixed `vendor:<slug>` (e.g. `vendor:socket:supply-chain`). Consumers that don't understand a vendor category MUST treat it as opaque but still display it.

---

## Runtime model

- Scanners are invoked through the standard job system: `sm job submit security-snyk -n <node.path>` or `sm job submit security-snyk --all`.
- The report is persisted through the normal action report mechanism ([`state_executions`](../db-schema.md)`.report_path` points to the JSON).
- `sm findings --security` aggregates findings from reports whose action id starts with `security-`, merging across scanners, deduplicating by `finding.id`.
- Implementations MAY also surface findings at scan time via a companion Analyzer (e.g. `security-findings-stale` flags nodes whose last scan exceeds a threshold). Recommended but not normative.

---

## Deduplication

Finding ids MUST be stable: re-running the same scanner against unchanged input MUST produce the same `finding.id` values. This lets:

- `sm findings --since <date>` show only new findings.
- The UI diff scan-to-scan.
- Aggregators dedupe identical reports from multiple provider instances.

The convention `<scannerId>:<vendorFindingId>` ensures cross-scanner uniqueness while staying readable.

---

## Aggregation into `sm findings`

On `sm findings --security`, the kernel:

1. Queries `state_executions` for actions whose id starts with `security-`.
2. For each, loads the most recent report (per `(actionId, nodeId)`).
3. Merges finding arrays.
4. Emits a normalized list: each entry includes `scanner`, `finding`, and `lastRanAt`.
5. Applies optional filters: `--severity`, `--category`, `--node`, `--since`.

The consumer sees a flat list regardless of how many scanners produced it.

---

## UI surface

The Web UI's Security panel:

- Groups findings by `severity` first, then by `category`.
- Displays `scanner.vendor` as the provenance line.
- Links `references[]` inline.
- Exposes `remediation.summary` when present.
- Does NOT auto-run scanners. Invocation is user-initiated.

---

## Schema file location

The JSON Schema for `SecurityReport` lives at `spec/schemas/summaries/security.schema.json` once Step 4 of the spec bootstrap completes. Until then, this document is the normative source and vendors SHOULD derive their validator from it.

This is the only `summaries/*` schema that does NOT correspond to a node kind; it corresponds to an action category.

---

## Compliance

A scanner whose report does NOT conform to `SecurityReport` is still a valid Action, but does NOT show up in `sm findings --security` or the UI Security panel; conforming is what unlocks the aggregation surface.

`sm plugins doctor` MAY emit a warning for Actions prefixed `security-` whose most recent report does not parse as `SecurityReport`.

---

## See also

- [`../architecture.md`](../architecture.md), extension kinds (Action) and the kernel contract.
- [`../job-lifecycle.md`](../job-lifecycle.md), job submit/claim/record flow for scanner invocations.
- [`../prompt-preamble.md`](../prompt-preamble.md), `report-base` shape (safety + confidence) that scanner reports extend.
- [`../db-schema.md`](../db-schema.md), `state_executions`, where scanner reports are persisted.

---

## Stability

**Stability: experimental** as of spec v0.x. Field names and conventions MAY tighten before v1.0 once real scanner implementations (Snyk, Socket, custom) ship and reveal shape needs.

Locked for v0:

- The report envelope (`scanner`, `findings`, `stats`).
- The required fields on `scanner` and on each finding.
- The severity enum (`error` / `warn` / `info`).

Open (may change pre-v1.0):

- The exact category enum, may grow or consolidate.
- Whether `tags: ["kind:scanner"]` in the manifest becomes normative (vs. just recommended).
- Whether scanners gain a dedicated CLI verb (`sm security scan`) in addition to `sm job submit security-<id>`.
