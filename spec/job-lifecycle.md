# Job lifecycle

Normative state machine for jobs. A `Job` (see [`schemas/job.schema.json`](./schemas/job.schema.json)) is the runtime instance of an `Action` applied to one or more `Node`s, moving through this lifecycle exactly once.

---

## State machine

```
             submit
                │
                ▼
        ┌──────────┐   atomic claim   ┌──────────┐
        │  queued  │ ───────────────▶ │ running  │
        └────┬─────┘                  └─────┬────┘
             │                              │
             │ cancel                       │
             │                              │
             │              record success  │
             │              ┌───────────────┤
             │              │               │ record failure
             │              │               │ TTL expires (reap)
             │              │               │ runner error
             ▼              ▼               ▼
        ┌────────┐   ┌──────────┐     ┌──────────┐
        │ failed │   │ completed│     │  failed  │
        └────────┘   └──────────┘     └──────────┘
```

Terminal states: `completed`, `failed`. Once terminal, a job MUST NOT transition again.

---

## Allowed transitions

| From | To | Trigger |
|---|---|---|
| (none) | `queued` | `sm job submit` succeeds. |
| `queued` | `running` | Atomic claim by a runner. |
| `queued` | `failed` | `sm job cancel <id>` (reason `user-cancelled`). |
| `running` | `completed` | `sm record --status completed` with valid nonce. |
| `running` | `failed` | `sm record --status failed`, OR TTL expired (reason `abandoned`), OR runner subprocess returned non-zero (reason `runner-error`), OR report failed schema validation (reason `report-invalid`), OR rendered content row missing at runtime (reason `job-file-missing`, historically named for the on-disk artifact; now a missing `state_job_contents` row, a DB-corruption-only state since the runtime invariant is that `state_jobs.content_hash` always resolves). |

Any other transition attempt MUST be rejected and MUST NOT mutate state. Implementations SHOULD log it.

---

## Submit

`sm job submit <action> -n <node.path>`:

1. Resolve the action (`actionId`, `actionVersion`, `promptTemplateHash`).
2. Resolve the target node (`bodyHash`, `frontmatterHash`). Fail with exit 5 if the node does not exist.
3. Compute `contentHash = sha256(actionId + actionVersion + bodyHash + frontmatterHash + promptTemplateHash)`.
4. **Duplicate check**: query `state_jobs` for any row with `(actionId, actionVersion, nodeId, contentHash)` AND `status IN ('queued', 'running')`. If found, refuse with exit 3 and print the existing job id (unless `--force`).
5. Compute `ttlSeconds` per §TTL resolution below. Frozen on `state_jobs.ttlSeconds` for the life of this job.
6. Resolve `priority` (integer, default `0`). Precedence (lowest → highest): action manifest `defaultPriority` → user config `jobs.perActionPriority.<actionId>` → flag `--priority <n>`. Higher runs first; ties broken by `createdAt ASC`. Negative values are permitted and run after the default bucket. Frozen on `state_jobs.priority` at submit time, immutable for the life of the job.
7. Generate `nonce` (implementation-chosen; MUST be cryptographically random, ≥ 128 bits of entropy).
8. Render the job content (canonical preamble + action template + interpolated user content per [`prompt-preamble.md`](./prompt-preamble.md)) and write it to `state_job_contents` via `INSERT OR IGNORE` keyed by `content_hash`. Multiple `state_jobs` rows MAY share one `content_hash` row: stored once, refcounted by reference. Implementations MUST NOT persist the rendered content to a filesystem path, the DB row is the canonical artifact.
9. Insert a row in `state_jobs` with `status = 'queued'`, `createdAt = now`. Its `content_hash` references the just-stored `state_job_contents.content_hash`. Steps 8 and 9 MUST run inside one transaction.
10. Return the job id.

`--all` fans out one job per node matching the action's `preconditions`. Each fan-out job is independent: some may be refused as duplicates, others succeed. The CLI reports a summary.

---

## Atomic claim

A runner acquires the next queued job with a single atomic operation:

```sql
UPDATE state_jobs
   SET status     = 'running',
       claimedAt  = <now>,
       runner     = <runner-id>,
       expiresAt  = <now> + ttlSeconds * 1000
 WHERE id = (
     SELECT id FROM state_jobs
      WHERE status = 'queued'
        AND (<filter>)
      ORDER BY priority DESC, createdAt ASC
      LIMIT 1
 )
   AND status = 'queued'
 RETURNING id;
```

The second `AND status = 'queued'` guards against a race where two runners select the same id at the same instant; only one succeeds.

**Non-SQLite implementations**: MUST provide an equivalent single-statement atomic transition. A two-step `SELECT then UPDATE` is NOT acceptable, observable as a double-claim bug.

`sm job claim` exposes this primitive to Skill agents (and any driving adapter draining from outside a CLI-runner loop): returns the id on stdout (exit 0) or exits 1 if the queue is empty.

In `--json` mode, `sm job claim` instead returns `{ "id": "<id>", "nonce": "<nonce>", "content": "<rendered MD content>" }`. Drivers MUST use the `--json` form when they intend to call `sm record` afterwards: the nonce is the sole credential the callback verb checks, and embedding it in the response is the contracted handover. The plain stdout form (id only) is kept for legacy scripts that just want the claimed id.

---

## TTL and auto-reap

Every `running` job has `expiresAt = claimedAt + ttlSeconds × 1000`. Once real time passes `expiresAt`, the job is abandoned.

### Reap procedure

Run at the **start of every `sm job run`**, before the first claim:

```sql
UPDATE state_jobs
   SET status        = 'failed',
       failureReason = 'abandoned',
       finishedAt    = <now>
 WHERE status = 'running'
   AND expiresAt < <now>;
```

Rows affected is reported as `run.reap.completed.reapedCount` in the event stream.

Implementations MAY expose `sm job reap` as an explicit diagnostics verb, but MUST perform reaping automatically inside `sm job run`.

### TTL resolution

The kernel resolves the effective TTL for a new job in three steps. The resolved value is written to `state_jobs.ttlSeconds` at submit time, immutable thereafter.

#### Step 1, Base duration

A seconds integer for how long the action is expected to run before the grace multiplier applies:

1. Action manifest `expectedDurationSeconds`, if declared.
2. Otherwise, config `jobs.ttlSeconds` (default: `3600`).

The base duration exists even for actions that cannot estimate their own runtime (typically `mode: local`); the global config value keeps the formula below well-defined.

#### Step 2, Computed TTL

```
computed = max(base × jobs.graceMultiplier, jobs.minimumTtlSeconds)
```

Config defaults: `jobs.graceMultiplier = 3`, `jobs.minimumTtlSeconds = 60`.

`minimumTtlSeconds` is a **floor**, not a default: it guarantees no job is claimed with a sub-minute deadline however small the base duration, and never acts as an initial value.

#### Step 3, User overrides

Two optional overrides, evaluated in order; the later one wins and replaces everything above it:

1. Config `jobs.perActionTtl.<actionId>`, integer seconds. Replaces the computed TTL entirely; the formula is skipped for that action id.
2. Flag `sm job submit --ttl <seconds>`, integer seconds. Highest precedence; replaces anything.

Negative or zero values MUST be rejected with exit 2 at submit time.

#### Worked examples

| Action manifest | Config | Flag | Result |
|---|---|---|---|
| `expectedDurationSeconds: 120` | defaults |, | `max(120 × 3, 60) = 360` |
| none | defaults |, | `max(3600 × 3, 60) = 10800` |
| `expectedDurationSeconds: 10` | defaults |, | `max(10 × 3, 60) = 60` (floor bites) |
| `expectedDurationSeconds: 120` | `jobs.perActionTtl.foo: 900` |, | `900` (override skips formula) |
| any | any | `--ttl 45` | `45` (flag wins outright) |

---

## Record (callback)

`sm record --id <id> --nonce <n> --status completed|failed ...`:

1. Load the job by id. If not found → exit 5.
2. Compare the supplied nonce against `state_jobs.nonce`. Mismatch → exit 4 without mutation.
3. If `state_jobs.status != 'running'` → exit 2 with message "job not in running state". This catches late callbacks after a reap.
4. If `--status completed`: read the report payload from the path passed to `--report` (implementation-input only, no canonical on-disk report artifact), validate the parsed JSON against the action's declared report schema. On validation failure → transition to `failed` with reason `report-invalid`; DO NOT stay `running`.
5. Write the execution record (see [`schemas/execution-record.schema.json`](./schemas/execution-record.schema.json)) with full metrics. The report payload (if any) is stored inline in `state_executions.report_json` as the parsed JSON; the input path is NOT retained.
6. Transition the job to the terminal state.
7. Emit `job.callback.received` followed by `job.completed` or `job.failed` (see [`job-events.md`](./job-events.md)).

The nonce is the sole authentication factor; a compromised nonce allows forged callbacks for that single job. Nonces MUST be generated per-job, never reused, never logged at info level or above.

`--report` accepts a file path or `-` (stdin); the kernel ingests both into `report_json` identically. The on-disk file the runner authored is ephemeral, implementations SHOULD remove it after the kernel acknowledges the callback (courtesy GC, not normative).

---

## Duplicate prevention rationale

The deduplication key `(actionId, actionVersion, nodeId, contentHash)` prevents accidental double-submit on re-run, race conditions where two processes submit the same action over the same node at the same content hash, and wasted LLM tokens re-computing an unchanged result.

Post-completion, the check is NOT performed: resubmitting a completed job is always allowed (the previous result is kept in history).

`--force` bypasses the check for legitimate reruns (e.g., re-testing an action after debugging).

---

## Concurrency

Through `v1.0` (spec `v0.x`): **one job at a time**. `sm job run --all` drains sequentially, enforced by the claim semantics above; no pool or scheduler.

The event schema carries a `jobId` on every event so parallel execution becomes a non-breaking extension. A future implementation MAY spawn multiple claim/run loops concurrently and interleave events; consumers identify an event's job by `jobId`.

Parallelism is NOT a v1.0 commitment. Implementations that offer it MUST still emit the canonical event stream correctly.

---

## Atomicity edge cases

Implementations MUST handle each of the following:

| Scenario | Required handling |
|---|---|
| `state_jobs` row exists but its `content_hash` is missing from `state_job_contents` (DB corruption, the content row deleted by external means). | Mark `failed` with `failureReason = job-file-missing`. `sm doctor` MUST report these proactively. The kernel does NOT produce this state under normal operation; submit and prune both keep the two tables consistent. The legacy enum name `job-file-missing` is preserved across the disk-to-DB shift for backward-compatibility; it now refers to a missing content row rather than a missing on-disk file. |
| `state_job_contents` row references no live `state_jobs` row (GC straggler). | `sm doctor` MUST list them. `sm job prune` MUST collect them in the same transaction that prunes terminal jobs. |
| Runner crashes between `claim` and reading the content. | Covered by TTL/reap: when `expiresAt` passes, the next reap marks the job `failed` with `abandoned`. |
| Callback arrives after reap already failed the job. | Reject with exit 2 (see Record step 3). The runner should treat this as an error and log it. |

---

## Cancellation

`sm job cancel <id>` is the only user-facing transition outside the normal flow. Effects:

| From | Effect |
|---|---|
| `queued` | Transition to `failed` with `failureReason = user-cancelled`. |
| `running` | Transition to `failed` with `failureReason = user-cancelled`. DOES NOT interrupt a subprocess runner; the runner discovers the failed state on its next callback and exits cleanly. Implementations MAY additionally signal the subprocess, not normative. |
| Terminal | Reject with exit 2 ("already terminal"). |

---

## Retention and GC

Config controls (`jobs.retention.completed`, `jobs.retention.failed`):

- `completed` default 30 days (2592000 seconds).
- `failed` default `null` = never auto-purge (preserves failure history for analysis).

`sm job prune` applies retention. Implementations MAY run this on a schedule (e.g., on `sm doctor`, or in a cron adapter) but MUST NOT prune implicitly during normal verb execution.

`sm job prune` MUST also collect orphaned `state_job_contents` rows (no live `state_jobs` references) in the same transaction that prunes terminal jobs. Ordering: delete terminal `state_jobs` rows in the retention window, then delete `state_job_contents` rows whose `content_hash` no longer appears in any `state_jobs` row.

---

## See also

- [`architecture.md`](./architecture.md), `RunnerPort` definition; driving-adapter peer analyzer for Skill agents.
- [`job-events.md`](./job-events.md), canonical event stream emitted during job execution.
- [`prompt-preamble.md`](./prompt-preamble.md), verbatim preamble prepended to every rendered job content row.
- [`db-schema.md`](./db-schema.md), `state_jobs` and `state_executions` table catalogs.
- [`cli-contract.md`](./cli-contract.md), `sm job` verb surface and exit codes.

---

## Stability

The state machine diagram above is **stable** as of spec v1.0.0. Adding a new state is a major bump; adding a new terminal reason (`failureReason` enum value) a minor bump.

The `contentHash` formula is **stable**. Changing what goes into the hash breaks duplicate detection across versions and is a major bump.

The atomic-claim semantics are **stable**. A double-claim would be a silent correctness bug observable through event-stream anomalies.

The TTL resolution procedure (§TTL resolution) is **stable** as of the next spec release. The three-step structure (base → computed → overrides) and the four config keys (`jobs.ttlSeconds`, `jobs.graceMultiplier`, `jobs.minimumTtlSeconds`, `jobs.perActionTtl`) are locked; adding a new override source is a minor bump, changing the formula shape a major bump.
