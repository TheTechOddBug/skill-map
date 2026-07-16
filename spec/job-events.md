# Job events

Canonical event stream emitted around job execution. skill-map never executes a job itself (an external agent processes the queue via `sm jobs claim` + `sm record`, see `architecture.md` §Execution handover), so the canonical emitter is the RECORD path: closing a job emits the synthetic run envelope below. Every implementation MUST emit these events in the order described, with the shapes below. Consumers: the CLI pretty printer, the `--json` ndjson output, the Server's WebSocket broadcaster, any third-party integration.

This document is **normative**. The event types, payload shapes, and ordering analyzers are stable contracts.

---

## Transport

Events are records the kernel produces through `ProgressEmitterPort` (see [`architecture.md`](./architecture.md)). An implementation MUST provide two output adapters:

| Adapter | Purpose | Format |
|---|---|---|
| `pretty` | Default TTY output. Human-readable, colored, line-based progress. | Free-form; not normative. |
| `json` | Machine-readable ndjson. One event per line, each a complete JSON object. | **Normative.** Matches the shapes below. |

The Server exposes the same events over WebSocket (`/ws`) using the same JSON shapes; each event is a single WS text frame.

---

## Common envelope

Every event is a JSON object with this envelope:

```json
{
  "type": "<event-type>",
  "timestamp": <unix-ms>,
  "runId": "<run-id>",
  "jobId": "<job-id> | null",
  "data": { ... }
}
```

| Field | Required | Meaning |
|---|---|---|
| `type` | always | One of the canonical event types below. |
| `timestamp` | always | Unix milliseconds when the event was emitted. |
| `runId` | always | Identifier of the invocation that emitted the event: `r-<mode>-YYYYMMDD-HHMMSS-XXXX`. Canonical modes: `ext` (agent-driven claim/record runs, the ONLY job-run flavor), `scan` (scan runs), `check` (standalone issue recomputations). |
| `jobId` | when job-scoped | The job the event refers to. Null for run-level events (`run.*`). |
| `data` | per-event | Event-specific payload, shape below. |

Implementations MUST include every envelope field in every event, even if `jobId` is null.

Unknown fields in `data` MUST be ignored by consumers (forward compatibility).

---

## Event catalog

Emitted in this order by `sm record --json` when it closes a job (the synthetic envelope wraps exactly one job). Parallel agents each produce their own envelopes; sequences never interleave within one envelope.

### `run.started`

Opens the synthetic envelope. `mode` is always `external`: the run was driven by an external agent's claim.

```json
{
  "type": "run.started",
  "timestamp": 1745159455123,
  "runId": "r-ext-20260420-143055-a3f2",
  "jobId": null,
  "data": {
    "mode": "external"
  }
}
```

### `job.claimed`

The claim leg of the envelope. `sm jobs claim`'s own stdout is the `{ id, nonce, content }` handover contract (never ndjson), so the claim is REPLAYED into the synthetic envelope when `sm record` closes the job, with the claim data read from the job row. The claim itself is the spawn signal: there is no separate spawning event.

```json
{
  "type": "job.claimed",
  "timestamp": 1745159455300,
  "runId": "...",
  "jobId": "d-20260420-143055-b001",
  "data": {
    "extensionId": "skill-summarizer",
    "extensionVersion": "1.2.0",
    "nodeId": "skills/my-skill.md",
    "ttlSeconds": 180,
    "priority": 0
  }
}
```

### `job.callback.received`

Emitted inside `sm record` when the callback arrives and passes nonce validation.

```json
{
  "type": "job.callback.received",
  "timestamp": 1745159465000,
  "runId": "...",
  "jobId": "...",
  "data": {
    "status": "completed | failed",
    "model": "claude-opus-4-7",
    "executionId": "e-20260420-143104-b001"
  }
}
```

`executionId` references the just-written `state_executions` row whose `report_json` carries the report payload. Consumers needing the content fetch it via `sm history --json` or the DB; the event stays small.

The kernel synthesizes the `runId` at record time: `r-ext-YYYYMMDD-HHMMSS-XXXX` (`ext` = externally-driven claim, the only job-run flavor).

Synthetic-run envelope, the canonical emission (`sm record --json` stdout, and the server's WebSocket when active):

```
run.started (mode="external")
  → job.claimed          (replayed from the job row)
  → job.callback.received
  → (job.completed | job.failed)
  → run.summary
```

`run.summary` closes the synthetic run as soon as the callback is processed; one synthetic run always wraps exactly one job, so every job event lives inside a run envelope.

### `job.completed`

Emitted when a job transitions to `completed`.

```json
{
  "type": "job.completed",
  "timestamp": 1745159465100,
  "runId": "...",
  "jobId": "...",
  "data": {
    "extensionId": "core/node-contradiction",
    "extensionKind": "analyzer",
    "durationMs": 9700,
    "tokensIn": 2431,
    "tokensOut": 1072,
    "model": "claude-opus-4-7",
    "executionId": "e-20260420-143104-b001"
  }
}
```

`executionId` references the `state_executions` row holding the report payload (in `report_json`). The full report is intentionally NOT inlined; events stay small, consumers query the row.

> **Hookable**, see [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set). `extensionId` / `extensionKind` let a hook filter to a kind (`kind: 'analyzer'`) or a specific extension; this is what the opt-in `core/auto-fix` hook keys on to chain finder -> fixer. Common uses: notification, billing, auto-fix.

### `job.failed`

Emitted when a job transitions to `failed` by any path.

```json
{
  "type": "job.failed",
  "timestamp": 1745159465200,
  "runId": "...",
  "jobId": "...",
  "data": {
    "reason": "runner-error | report-invalid | timeout | abandoned | job-file-missing | user-failed",
    "message": "Subprocess exited with code 127",
    "exitCode": 127,
    "durationMs": 180000
  }
}
```

`reason` enum matches [`execution-record.schema.json`](./schemas/execution-record.schema.json) `failureReason`. `message` is human-readable free-form, MAY be truncated for display.

> **Hookable**, see [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set). Common use: alerting and retry triggers. Filter by `data.reason` to narrow to a specific failure mode.

### `run.summary`

Closes the envelope, after the terminal job event. A synthetic run wraps exactly one job, so the counts are 0/1-valued; the shape stays aggregate-ready for transports that batch envelopes.

```json
{
  "type": "run.summary",
  "timestamp": 1745159475000,
  "runId": "...",
  "jobId": null,
  "data": {
    "jobsAttempted": 1,
    "jobsCompleted": 1,
    "jobsFailed": 0,
    "totalDurationMs": 9700,
    "totalTokensIn": 2431,
    "totalTokensOut": 1072
  }
}
```

`jobsAttempted = jobsCompleted + jobsFailed` always.

---

## Ordering analyzers

For each envelope (one job), the normative order is:

```
run.started → job.claimed → job.callback.received → (job.completed | job.failed) → run.summary
```

Envelopes never interleave: each is emitted atomically when `sm record` closes its job. Distinct jobs recorded by parallel agents produce distinct envelopes with distinct `runId`s.

The claim-side reap (`sm jobs claim` reaps expired running jobs before claiming, `job-lifecycle.md` §Reap procedure) emits NO events from the CLI: the claim verb's stdout is the `{ id, nonce, content }` handover contract, never ndjson. An implementation with a live event transport (the server's WebSocket) SHOULD emit a minimal `run.started → job.failed(reason=abandoned) → run.summary` envelope per reaped job, with no `job.claimed` replay (the original claimant never reported back); reaped jobs are always visible via `sm jobs list --status failed`.

---

## Non-job events (Stability: experimental)

These event families cover kernel activity other than job execution. They share the common envelope (`type`, `timestamp`, `runId`, `jobId`, `data`). For non-job events `jobId` is always `null`; `runId` identifies the invocation: a scan gets an `r-scan-YYYYMMDD-HHMMSS-XXXX` id, an issue recomputation outside a scan an `r-check-...` id, following the same `r-<mode>-...` shape as the external-Skill envelope (`r-ext-...`).

The **shapes below are experimental through spec v0.x**. The reference impl starts emitting them at Step 13 alongside the WebSocket broadcaster; once real consumers exercise the stream, the fields lock. Bumping to `stable` is a minor spec bump; field-shape changes before `stable` are allowed without a major bump (per [`versioning.md`](./versioning.md) §Pre-1.0).

### Scan events

#### `scan.started`

Emitted once when a scan begins (full, `--changed`, or `-n <node.path>`).

```json
{
  "type": "scan.started",
  "timestamp": 1745159455123,
  "runId": "r-scan-20260420-143055-a3f2",
  "jobId": null,
  "data": {
    "mode": "full | changed | single",
    "target": "<node.path> | null",
    "rootsCount": 1
  }
}
```

> **Hookable**, see [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set). Pre-scan setup, telemetry init.

#### `scan.progress`

Emitted periodically during a scan (implementation-defined cadence; SHOULD throttle to ≥250 ms apart to keep WS traffic cheap).

```json
{
  "type": "scan.progress",
  "timestamp": 1745159455500,
  "runId": "...",
  "jobId": null,
  "data": {
    "filesSeen": 128,
    "filesProcessed": 64,
    "filesSkipped": 3
  }
}
```

#### `scan.completed`

Emitted once at scan end.

```json
{
  "type": "scan.completed",
  "timestamp": 1745159456000,
  "runId": "...",
  "jobId": null,
  "data": {
    "nodes": 187,
    "links": 421,
    "issues": 12,
    "durationMs": 877
  }
}
```

> **Hookable**, see [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set). Post-scan reaction (Slack notification, CI gate).

#### `extractor.completed`

Emitted once per registered Extractor, after the full walk. Aggregated, NOT per-node; per-node fan-out lives in `scan.progress`, which is intentionally not hookable.

```json
{
  "type": "extractor.completed",
  "timestamp": 1745159455900,
  "runId": "...",
  "jobId": null,
  "data": {
    "extractorId": "core/external-url-counter"
  }
}
```

`extractorId` is the qualified extension id (`<plugin-id>/<id>`).

> **Hookable**, see [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set). Per-Extractor metrics. Filter by `data.extractorId` to scope to one Extractor.

#### `analyzer.completed`

Emitted once per registered Analyzer, after every issue is validated.

```json
{
  "type": "analyzer.completed",
  "timestamp": 1745159455950,
  "runId": "...",
  "jobId": null,
  "data": {
    "analyzerId": "core/node-stability"
  }
}
```

`analyzerId` is the qualified extension id.

> **Hookable**, see [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set). Per-Analyzer alerting. Filter by `data.analyzerId`.

#### `action.completed`

Emitted once per Action invocation, after the report is recorded.

```json
{
  "type": "action.completed",
  "timestamp": 1745159465500,
  "runId": "...",
  "jobId": "...",
  "data": {
    "actionId": "claude/skill-summarizer",
    "node": { "path": "skills/my-skill.md", "kind": "skill" },
    "jobResult": { "tokensIn": 2431, "tokensOut": 1072 }
  }
}
```

`actionId` is the qualified extension id; `node` carries the target node summary (full `Node` shape per [`schemas/node.schema.json`](./schemas/node.schema.json) is forward-compatible). Lands at Step 10 with the job subsystem.

> **Hookable**, see [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set). Per-Action notification. Filter by `data.actionId`.

### Issue events

Emitted by the scan after `scan.completed` when the new scan's issue set differs from the previous. Lets a UI "issue inbox" update incrementally without re-fetching the full list.

#### `issue.added`

```json
{
  "type": "issue.added",
  "timestamp": 1745159456100,
  "runId": "...",
  "jobId": null,
  "data": {
    "analyzerId": "name-collision",
    "severity": "warn",
    "nodeIds": ["skills/a.md", "skills/b.md"],
    "message": "..."
  }
}
```

#### `issue.resolved`

Emitted when an issue present in the previous scan is absent from the new.

```json
{
  "type": "issue.resolved",
  "timestamp": 1745159456101,
  "runId": "...",
  "jobId": null,
  "data": {
    "analyzerId": "broken-ref",
    "nodeIds": ["skills/c.md"]
  }
}
```

Issue diffing is keyed on `(analyzerId, nodeIds sorted, message)`: same key → same issue. A payload change on the same key emits no event; consumers re-read full issue detail from `sm check`.

---

## Error handling

If an event payload cannot be serialized (internal bug), the implementation MUST emit a synthetic event:

```json
{
  "type": "emitter.error",
  "timestamp": <now>,
  "runId": "<runId>",
  "jobId": null,
  "data": {
    "message": "failed to emit event of type '<type>': <reason>"
  }
}
```

Consumers MAY treat `emitter.error` as a soft failure (log and continue). Implementations MUST NOT crash the run on a serialization failure.

---

## See also

- [`architecture.md`](./architecture.md), `ProgressEmitterPort` definition.
- [`job-lifecycle.md`](./job-lifecycle.md), state machine that drives these events.
- [`cli-contract.md`](./cli-contract.md), `--json` flag semantics.

---

## Stability

The **job event type list** (`run.started`, `run.summary`, `job.claimed`, `job.callback.received`, `job.completed`, `job.failed`, `emitter.error`) is stable as of spec v1.0.0. Adding a new event type is a minor bump; removing or renaming one is a major bump.

**Adding** fields to `data` is a minor bump; changing a field's type or removing a field is a major bump.

Consumers MUST ignore unknown fields (forward compatibility).

The envelope (`type`, `timestamp`, `runId`, `jobId`, `data`) is stable. Adding an envelope field is a major bump because every consumer would need to handle it.

The **non-job event families** (`scan.*`, `issue.*`, `extractor.completed`, `analyzer.completed`, `action.completed`) are **experimental** across spec v0.x. They ship alongside the WebSocket broadcaster at Step 13 of the reference impl; shapes may tighten before a stable tag lands. Once promoted to `stable` (a minor spec bump), the same add/remove/rename semantics as the job events apply.

The **Hook curated trigger set** (eight hookable lifecycle events; see [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set)) is stable as of the minor in which it lands: adding a hookable trigger is a minor bump, removing or renaming one is a major bump. The curation policy ("a hook subscribes only to a deliberately small set") is normative; surface noise reduction is the point.
