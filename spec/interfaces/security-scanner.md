# Security scanner interface

Normative convention for third-party security-scanning plugins (Snyk, Socket, custom rulesets, similar). A security scanner is NOT a new extension kind, it is a **convention over the existing kinds**, defined so that:

- Multiple vendors can ship interoperable scanners.
- `sm findings` aggregates findings across scanners uniformly, with per-row provenance.
- The UI can present a single security surface regardless of which scanners are present.

> **Reconciled with the findings pipeline.** The original draft of this document predated `state_findings` and specified a bespoke `SecurityReport` envelope aggregated from `state_executions`, stable cross-run finding ids, and a planned `schemas/summaries/security.schema.json`. All of that is superseded: scanners now ride the standard findings pipeline ([`db-schema.md` §state_findings](../db-schema.md), [`job-lifecycle.md` §Record](../job-lifecycle.md)), which provides the aggregation, provenance, staleness, and dismissal semantics this document used to define ad hoc.

---

## Why a convention, not a new kind

The six extension kinds are locked ([`architecture.md`](../architecture.md)). A seventh for "security" would conflate concerns: a scanner is a judgment producer, and the judgment surface already exists. A convention lets any conforming extension opt into the security surface with no kernel changes.

---

## The shape: a finder Analyzer

A security scanner that produces judgments is a probabilistic **Analyzer** (a finder, [`architecture.md` §Modelo B](../architecture.md)):

- Its `report.schema.json` extends the canonical findings envelope ([`schemas/findings/report.schema.json`](../schemas/findings/report.schema.json)) via `$ref`, like every finder (enforced at manifest load).
- It is submitted, claimed, and recorded through the standard queue (`sm jobs submit security-<vendor> -n <node.path>` or `--all`); the processing-agent gate and every other submit rule apply unchanged.
- At record, its `findings[]` land in `state_findings` (finder lane, `origin = 'extension'`), stamped with the scanner's `extension_id` / `extension_version`, the recording agent's self-reported `model`, and `body_hash_at_generation` for staleness.

Everything downstream is inherited, not scanner-specific: `sm findings` filters and rendering, per-`(node, extension)` replace semantics, the body-hash stale rule, `sm findings dismiss` (sidecar suppression, grain `(extension, type)`), resolution states, and fixer chaining via `precondition.analyzerIds` when a vendor also ships a remediation Action.

**Identification.** The extension id SHOULD start with `security-` (lowercase kebab-case, e.g. `security-snyk`). Consumers (a `--security` style filter, the UI security grouping) identify scanners by that prefix. The kernel does not enforce the prefix; conforming to the findings envelope is what unlocks the shared surface.

---

## Finding types (categories)

The old draft's `category` maps onto the finding `type` slug. For interoperability a scanner SHOULD use one of:

- `vulnerability`, known CVE, dependency advisory, version range with known exploit.
- `misconfiguration`, insecure default, exposed secret surface, weak permission.
- `credential-leak`, secret material (API key, token, password) detected in content.
- `injection-risk`, pattern likely to enable prompt/SQL/command injection.
- `license-violation`, incompatible license terms for a dependency or referenced asset.
- `outdated`, version pinned well below current, not exploited but due for upgrade.
- `policy-violation`, organization-level rule (naming, banned words, required disclaimer).

Vendor-specific types use a `vendor-<slug>` prefix (kebab, envelope-legal). Consumers that do not understand a type MUST treat it as opaque but still display it. Because the `type` is also the dismissal grain, scanners SHOULD keep types stable across versions: renaming a type silently re-arms judgments the operator already dismissed.

**Reserved kernel slugs.** `injection-detected`, `content-suspicious`, and `content-malformed` belong to the kernel safety lane (synthesized from any probabilistic report's `safety` block, `origin = 'kernel'`); extensions MUST NOT emit them. A scanner reporting an injection PATTERN uses its own `injection-risk` type; the kernel lane reports that the scanned content attacked the scan itself.

**Vendor detail.** CVE ids, CVSS scores, advisory URLs, and remediation guidance travel in the finding's `detail` string today (markdown-friendly). Structured vendor fields (a `meta` object, typed locations) are an OPEN pre-1.0 envelope question, see §Stability.

---

## No stable cross-run identity

The old draft required stable finding ids (`<scannerId>:<vendorFindingId>`) for dedup and `--since` diffing. The findings pipeline deliberately has no cross-run identity: a re-recorded scanner REPLACES its previous rows for the node, and durable operator decisions attach to the judgment CLASS (`(extension, type)` sidecar suppressions), not to an occurrence. Vendors MAY embed their stable id inside `detail` for reference, but no kernel surface keys on it.

---

## Deterministic / vendor-API scanners (open)

A scanner backed by a vendor HTTP API (dependency lookup, advisory feed) is deterministic in spirit, but has no findings-lane home yet:

- Deterministic **Analyzers** run on the synchronous scan path, which MUST stay fast, free, and offline (no network); their output is scan-time issues (`sm check`), not findings.
- Deterministic network **Actions** run via `sm refresh` into the enrichment layer, which does not feed `state_findings`.

Routing vendor-API results into the findings surface (a deterministic findings lane at record? an enrichment-to-findings projection?) is an explicit OPEN design question, deferred until a real vendor implementation ships. Until then, API-backed scanners are best modeled as probabilistic Analyzers whose processing agent performs the vendor call and reports through the findings envelope.

---

## See also

- [`../architecture.md`](../architecture.md), extension kinds, Modelo B, execution handover.
- [`../job-lifecycle.md`](../job-lifecycle.md), submit/claim/record flow, processing-agent gate, findings write-through.
- [`../db-schema.md`](../db-schema.md), `state_findings` columns, replace semantics, suppression filter.
- [`../schemas/findings/report.schema.json`](../schemas/findings/report.schema.json), the canonical envelope scanner reports extend.

---

## Stability

**Stability: experimental** as of spec v0.x. Locked for v0:

- Scanners are finder Analyzers over the canonical findings envelope; no bespoke report shape.
- The reserved kernel slugs are never emitted by extensions.
- The recommended type list above.

Open (may change pre-v1.0):

- Structured vendor fields (locations, CVSS, remediation) as an envelope extension vs. `detail`-only.
- The deterministic / vendor-API findings lane (§above).
- Whether the `security-` prefix graduates from recommendation to an enforced filter surface (e.g. `sm findings --security`).
