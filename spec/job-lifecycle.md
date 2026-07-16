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
         └────┬─────┘                  └────┬─────┘
              │                             │
    cancel →  │  ← fail          cancel →   │   ← fail
              │                  record success / failure
              │                  TTL expires (reap) / runner error
              ▼                             ▼
   ┌─────────────────────┐      ┌─────────────────────────────────┐
   │ cancelled  ·  failed │      │ completed · failed · cancelled  │
   └─────────────────────┘      └─────────────────────────────────┘
```

Terminal states: `completed`, `failed`, `cancelled`. Once terminal, a job MUST NOT transition again. `cancelled` (via `sm job cancel`) and `failed` with reason `user-failed` (via `sm job fail`) are the two operator-driven terminal transitions outside the normal claim → record flow; `cancelled` is a distinct state, NOT a `failed` sub-reason.

---

## Allowed transitions

| From | To | Trigger |
|---|---|---|
| (none) | `queued` | `sm job submit` succeeds. |
| `queued` | `running` | Atomic claim by a runner. |
| `queued` | `cancelled` | `sm job cancel <id>` (no `failureReason`; `cancelled` is self-explanatory). |
| `queued` | `failed` | `sm job fail <id>` (reason `user-failed`). |
| `running` | `completed` | `sm record --status completed` with valid nonce. |
| `running` | `cancelled` | `sm job cancel <id>` (no `failureReason`). |
| `running` | `failed` | `sm record --status failed`, OR `sm job fail <id>` (reason `user-failed`), OR TTL expired (reason `abandoned`), OR runner subprocess returned non-zero (reason `runner-error`), OR report failed schema validation (reason `report-invalid`), OR rendered content row missing at runtime (reason `job-file-missing`, historically named for the on-disk artifact; now a missing `state_job_contents` row, a DB-corruption-only state since the runtime invariant is that `state_jobs.content_hash` always resolves). |

Any other transition attempt MUST be rejected and MUST NOT mutate state. Implementations SHOULD log it.

---

## Submit

`sm job submit <extension> -n <node.path>` (the target is any probabilistic extension, Action or Analyzer; see [`cli-contract.md` §Job queue](./cli-contract.md) for the id-matching and disambiguation rules):

1. Resolve the extension (`extensionId`, `extensionVersion`, `extensionKind`, `promptTemplateHash`). The resolved kind is frozen onto `state_jobs.extension_kind` (like the version); `sm record` routes on it. An id that matches no extension at all refuses with exit 5 (not found); an id whose only match is deterministic refuses with exit 2.
2. Resolve the target node (`bodyHash`, `frontmatterHash`). Fail with exit 5 if the node does not exist.
3. Compute `contentHash`: `sha256` over the NUL-joined (`0x00`) tuple `(extensionId, extensionVersion, node.path, bodyHash, frontmatterHash, promptTemplateHash)`. The delimiter prevents concatenation-ambiguity collisions. `node.path` is a hash input because the rendered content embeds it (the `<user-content id="<node.path>">` attribute per [`prompt-preamble.md`](./prompt-preamble.md)); omitting it would let two nodes with identical body and frontmatter but different paths share one content row while rendering different text, breaking the "same hash, same content" invariant.
4. **Duplicate check**: query `state_jobs` for any row with `(extensionId, extensionVersion, nodeId, contentHash)` AND `status IN ('queued', 'running')`. If found, refuse with exit 3 and print the existing job id (unless `--force`).
5. Resolve the OPTIONAL TTL per §TTL resolution below (explicit operator sources only; absent every source the job carries none). Frozen on `state_jobs.ttl_seconds` (NULL = never expires) for the life of this job.
6. Resolve `priority` (integer, default `0`). Precedence (lowest → highest): extension manifest `defaultPriority` → user config `jobs.perExtensionPriority.<extensionId>` → flag `--priority <n>`. Higher runs first; ties broken by `createdAt ASC`. Negative values are permitted and run after the default bucket. Frozen on `state_jobs.priority` at submit time, immutable for the life of the job.
7. Generate `nonce` (implementation-chosen; MUST be cryptographically random, ≥ 128 bits of entropy).
8. **Drift verification**: read the node's source file and recompute the body hash over the exact body bytes that will be rendered, applying the SAME body-extraction and hashing rules the scan applies (the Provider's declared parser / `bodyField` pipeline, then the scanner's body hash). The DB stores only hashes, never body text, so the render can only source the current disk bytes; implementations MUST verify the on-disk body still matches the scanned `bodyHash` before rendering. A recomputed hash that differs refuses with exit 2 and an advisory to re-scan ("node changed on disk since the last scan; run `sm scan`"): rendering drifted bytes would break the invariant that `contentHash` describes the stored content. A missing or unreadable file refuses with exit 2 the same way (clean error, no stack trace).
9. Render the job content: the canonical preamble, then the extension template (`prompt.md`) with two kernel-authored sections injected at the `{{userContent}}` seam, in this order, so both land immediately BEFORE the `<user-content>` block (after any template prose preceding the placeholder; template prose following the placeholder keeps its position after the block), per [`prompt-preamble.md`](./prompt-preamble.md): first the **findings-to-resolve** section (fixer jobs ONLY, see §Findings injection for fixers), then the **report contract**; write it to `state_job_contents` via `INSERT OR IGNORE` keyed by `content_hash`. The report contract makes every job self-contained (the draining agent never needs disk access or guesswork to learn the output shape, e.g. the `severity` enum): under a kernel-authored heading, the extension's own `report.schema.json` is inlined VERBATIM in a fenced `json` block, followed by each canonical spec schema it references (the namespace envelope under `summaries/` / `findings/` when one applies, then `report-base.schema.json`), one fenced block each, no dereferencing or rewriting (the blocks are byte-copies of the spec artifacts; `$id` / `$ref` URLs are identifiers, never fetched). The contract blocks are kernel-authored prelude, NEVER inside `<user-content>`, and hash into `promptTemplateHash` (see below), so a schema edit re-keys the content exactly like a template edit does. Multiple `state_jobs` rows MAY share one `content_hash` row: stored once, refcounted by reference. Implementations MUST NOT persist the rendered content to a filesystem path, the DB row is the canonical artifact.
10. Insert a row in `state_jobs` with `status = 'queued'`, `createdAt = now`. Its `content_hash` references the just-stored `state_job_contents.content_hash`. Steps 9 and 10 MUST run inside one transaction.
11. Return the job id.

`--all` fans out one job per node matching the action's `preconditions`. Each fan-out job is independent: some may be refused as duplicates, others refused for drift or an unreadable file (step 8, per-node and non-fatal, never an abort of the fan-out), others succeed. The CLI reports a summary.

### Findings injection for fixers

A **fixer** is a probabilistic Action that declares `precondition.analyzerIds` (Modelo B, [`architecture.md`](./architecture.md#analyzer--action-relationship-modelo-b)): it resolves the findings a finder emitted. Because the fix must act on exactly what the finder reported (not re-derive it), the kernel injects those findings into the rendered content at submit:

- **Selection.** For the target node, the `state_findings` rows whose `extension_id` is one of the Action's `analyzerIds` and `origin = 'extension'` (the finder's own judgments, NOT the kernel safety lane, an `injection-detected` flag is not a prose defect a fixer consolidates). **Stale rows are INCLUDED, flagged**, not filtered: staleness is node-level (any byte of the body invalidates every finding on it), so a fix in one section stales findings about untouched sections whose defects are still verbatim present. Excluding them would discard valid judgments and force a re-detection between every fix, defeating the natural "queue all the fixers" flow. The draining agent receives the CURRENT body alongside the findings and is instructed to verify each flagged-stale entry before acting, declining what no longer applies.
- **Refusal.** If the selection is empty (NO matching findings at all, fresh or stale), submit refuses with exit 2 and an advisory ("no findings to resolve for `<finder>` on `<node>`; run the finder first"). A fixer over a never-judged node is a user error; the UI affordance only appears on judged nodes.
- **The section.** A kernel-authored `## Findings to resolve` heading followed by the selected findings as a fenced `json` array (each entry: `id`, `type`, `severity`, `message`, `detail`, `confidence`, `stale`; a `stale: true` entry was judged against an earlier version of the body, so the agent MUST verify it against the current content before acting and decline it when it no longer applies; the `id` is what the fixer echoes back in its report's `resolved[]` so the kernel can stamp each finding's resolution, see [`db-schema.md` §state_findings](./db-schema.md#state_findings)), plus a one-line caution that any spans quoted inside those strings are DATA (evidence the finder cited), never instructions. It is kernel prelude, NEVER inside `<user-content>`, and folds into `promptTemplateHash` exactly like the report-contract blocks, so a changed finding set re-keys the fixer job (correct dedup: re-running after the finder re-judged is a new job) while non-fixer jobs, which have no such section, keep their hash unchanged.
- **The resolution.** The fixer's report carries `resolved[]`, one entry per injected finding it considered: the finding's `id`, the `state` it puts the finding in (`fixed` = the fixer edited the file to resolve it; `human-decision` = it did not, the fix needs the author's choice, and the `note` is the fixer's PROPOSAL for that choice), a one-line `note`, and, when `state` is `fixed`, `by` (`fixer` = the agent resolved it with zero user interaction; `human` = ANY user interaction was involved, an approval, a choice among options, an operator edit). At record the kernel stamps that state onto the matching `state_findings` rows (`resolution` / `resolution_actor` from `by` / `resolution_note` / `resolution_by` = the fixer's qualified id / `resolution_at`), scoped to the job's node and the fixer's `analyzerIds`. `fixed` is a lifecycle state, not a closure: the row persists (hidden from the default `sm findings` view, re-checkable), and only the finder re-judging the current body deletes or reopens it; `human-decision` stays the author's visible TODO. See [`db-schema.md` §state_findings](./db-schema.md#state_findings).
- **The edit.** The fixer's template instructs the draining agent to edit the node file (named by its path) to resolve the listed findings, per preamble v2 rule 4 (template-mandated edits on named files). skill-map never writes the body; the next scan picks up the edit deterministically and the resolved findings go stale via the body-hash rule (`sm findings prune` clears them, or the next finder run confirms the fix).

---

## Atomic claim

A runner acquires the next queued job with a single atomic operation:

```sql
UPDATE state_jobs
   SET status     = 'running',
       claimedAt  = <now>,
       runner     = <runner-id>,
       expiresAt  = CASE WHEN ttlSeconds IS NULL THEN NULL
                         ELSE <now> + ttlSeconds * 1000 END
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

**Nonce exposure.** The only surfaces that emit a job's nonce are `sm job submit --json` (the creator's envelope) and `sm job claim --json` (the handover above). Every other read surface (`sm job list --json`, `sm job show --json`, and any future job read) MUST omit the nonce: it is the sole record credential, and a passive reader of the queue must not be able to forge callbacks for jobs it never claimed.

**Missing content row at claim.** When the claim lands but the job's `content_hash` resolves to no `state_job_contents` row (the DB-corruption-only `job-file-missing` state, see §Atomicity edge cases), `sm job claim` MUST NOT hand out the claim: the job is marked `failed` with `failureReason = job-file-missing` (an execution record documenting the corruption is written), the corruption is reported on stderr, and the verb exits 2, in plain and `--json` modes alike (never exit 0 with a null `content`). The verb does NOT loop to claim the next queued job; corruption is an operator-attention state, not something to silently skip past, and the next invocation claims the next job anyway.

---

## TTL and auto-reap (opt-in)

**Jobs do NOT expire by default.** `state_jobs.ttl_seconds` is nullable; NULL means the job never expires, `expires_at` stays NULL at claim time, and the job remains `running` until an agent records it or the operator resolves it (`sm job fail` / `sm job cancel`). This is deliberate: the queue is drained by external agents, and an agent MAY be interactive, pausing mid-job to consult its user for minutes or hours ("how should I resolve this contradiction?"); an always-armed deadline would reap exactly the drains where a human is most involved. A TTL is operator POLICY, armed per case (see §TTL resolution).

A TTL-armed `running` job has `expiresAt = claimedAt + ttlSeconds × 1000`. Once real time passes `expiresAt`, the job is abandoned.

### Reap procedure

Run at the **start of every `sm job claim`**, before the claim statement (the claim verb is where every drain begins, so the safety net rides it). Only TTL-armed jobs are reapable; a NULL `expiresAt` never matches:

```sql
UPDATE state_jobs
   SET status        = 'failed',
       failureReason = 'abandoned',
       finishedAt    = <now>
 WHERE status = 'running'
   AND expiresAt IS NOT NULL
   AND expiresAt < <now>;
```

The claim-side reap is silent on the CLI (the claim verb's stdout is the handover contract); reaped jobs surface via `sm job list --status failed` and, when a live event transport exists, the minimal abandoned envelope of `job-events.md` §Ordering.

Implementations MAY expose `sm job reap` as an explicit diagnostics verb, but MUST perform reaping automatically inside `sm job claim`.

**TTL-less zombies are a diagnosed, operator-resolved condition.** A crashed agent holding a TTL-less claim leaves the job `running` indefinitely (blocking only the resubmission of that same `(extension, node, contentHash)` tuple via the duplicate index; other jobs are unaffected). The `jobs-overdue` check of `sm doctor` surfaces `running` jobs whose elapsed time exceeds their extension's advisory `probExpectedDurationSeconds` (resolved from the loaded extension; jobs whose extension is no longer loadable are skipped), status `warn`, message naming the actionable verbs (`sm job fail <id>` / `sm job cancel <id>`). The check never mutates state.

### TTL resolution

The optional TTL resolves at submit time from explicit operator sources ONLY, highest precedence first. The resolved value (or NULL) is written to `state_jobs.ttl_seconds`, immutable thereafter:

1. Flag `sm job submit --ttl <seconds>`: a positive integer arms the expiry; `0` explicitly DISARMS it (overriding any config below); negative values are rejected with exit 2.
2. Config `jobs.perExtensionTtl.<extensionId>`, integer seconds (positive).
3. Config `jobs.ttlSeconds`, integer seconds (positive): the global arm-everything policy for operators who prefer the old always-expiring behaviour. UNSET by default.
4. None of the above: no TTL.

The extension's `probExpectedDurationSeconds` (still REQUIRED on every probabilistic manifest) no longer arms or computes expiry: it is the advisory runtime estimate consumed by the `jobs-overdue` doctor check and display surfaces. The former grace formula and its config keys (`jobs.graceMultiplier`, `jobs.minimumTtlSeconds`) are retired with it: armed values are absolute seconds, chosen by the operator.

#### Worked examples

| Config | Flag | Result |
|---|---|---|
| none |, | no TTL (never expires; `jobs-overdue` advises) |
| `jobs.perExtensionTtl.foo: 900` |, | `900` for `foo` jobs, no TTL for the rest |
| `jobs.ttlSeconds: 3600` |, | `3600` for every job (global opt-in policy) |
| `jobs.ttlSeconds: 3600` | `--ttl 0` | no TTL for this job (flag disarms outright) |
| any | `--ttl 45` | `45` (flag wins outright) |

---

## Record (callback)

`sm record --id <id> --nonce <n> --status completed|failed ...`:

1. Load the job by id. If not found → exit 5.
2. Compare the supplied nonce against `state_jobs.nonce`. Mismatch → exit 4 without mutation.
3. If `state_jobs.status != 'running'` → exit 2 with message "job not in running state". This catches late callbacks after a reap.
4. If `--status completed`: read the report payload from the path passed to `--report` (implementation-input only, no canonical on-disk report artifact), validate the parsed JSON against the recorded extension's declared report schema (`<extension-dir>/report.schema.json`, Action or Analyzer alike). On validation failure → transition to `failed` with reason `report-invalid`; DO NOT stay `running`.
5. Write the execution record (see [`schemas/execution-record.schema.json`](./schemas/execution-record.schema.json)) with full metrics, including the agent's self-reported `--model` when declared. The report payload (if any) is stored inline in `state_executions.report_json` as the parsed JSON; the input path is NOT retained.
6. Transition the job to the terminal state.
7. Emit `job.callback.received` followed by `job.completed` or `job.failed` (see [`job-events.md`](./job-events.md)).

**Summary write-through.** When `--status completed` and the recorded job's Action is a summarizer, the validated report is ALSO upserted into `state_summaries` (keyed by `(node_id, extensionId)`) in the SAME transaction as the `state_executions` insert and the job transition (steps 5-6). The summarizer signal is the Action's report schema, not a manifest flag: an Action is a summarizer iff its `report.schema.json` extends a schema under the canonical summaries namespace ([`schemas/summaries/`](./schemas/summaries/), referenced via `$ref`, typically inside `allOf`; today the single universal `markdown.schema.json` node-summary shape, `markdown` names the body format, not the node kind). The upsert stamps the target node's current `scan_nodes.body_hash` into `body_hash_at_generation` so `sm show` can later flag staleness, mirrors the agent's self-reported `--model` onto `model` (NULL when undeclared), and mirrors the job's `extension_id` / `extension_version` onto `summarizer_action_id` / `summarizer_version`. If the target node is no longer present in `scan_nodes` (deleted or renamed since submit), the summary upsert is skipped: the execution record still lands and the job still transitions. An Action whose report schema does NOT extend a `summaries/` schema writes no `state_summaries` row (its report lives only on `state_executions.report_json`). See [`db-schema.md` § state_summaries](./db-schema.md).

**Findings write-through.** When `--status completed` and the recorded job's frozen `extension_kind` is `analyzer` (a finder), the validated report's `findings[]` array is written through to `state_findings` in the SAME transaction (steps 5-6): the finder's previous rows for `(node_id, extension_id)` are DELETEd first, then one row per finding lands with `origin = 'extension'`, so an empty array is a clean verdict that erases the prior judgment, not a no-op. The routing signal is the extension's KIND (an analyzer's report is findings by definition); the report shape contract is the canonical envelope ([`schemas/findings/report.schema.json`](./schemas/findings/report.schema.json)) the analyzer's own `report.schema.json` MUST extend via `$ref`, enforced at manifest load time. Additionally, for EVERY probabilistic report (Action or Analyzer) whose `safety` block flags trouble (`injectionDetected = true`, or `contentQuality != 'clean'`), the kernel synthesizes `origin = 'kernel'` rows under the reserved type slugs (`injection-detected` / `content-suspicious` / `content-malformed`) attributed to the reporting extension. Same skip rule as summaries when the target node has disappeared. Full column semantics, replace semantics, and the stale rule: [`db-schema.md` § state_findings](./db-schema.md).

The nonce is the sole authentication factor; a compromised nonce allows forged callbacks for that single job. Nonces MUST be generated per-job, never reused, never logged at info level or above.

`--report` accepts a file path or `-` (stdin); the kernel ingests both into `report_json` identically. The on-disk file the runner authored is ephemeral, implementations SHOULD remove it after the kernel acknowledges the callback (courtesy GC, not normative).

---

## Duplicate prevention rationale

The deduplication key `(extensionId, extensionVersion, nodeId, contentHash)` prevents accidental double-submit on re-run, race conditions where two processes submit the same extension over the same node at the same content hash, and wasted LLM tokens re-computing an unchanged result.

Post-completion, the check is NOT performed: resubmitting a completed job is always allowed (the previous result is kept in history).

`--force` bypasses the pre-check for legitimate reruns (e.g., re-testing an extension after debugging). It does NOT permit two concurrent `queued`/`running` jobs for the same `(extension_id, node_id, content_hash)`: the unique partial index `ix_state_jobs_extension_node_hash` (WHERE `status IN ('queued','running')`) is the hard invariant, so `--force` is only effective once the prior job has reached a terminal state. Attempting `--force` while a matching job is still active fails on the index constraint; it does not silently create a second live job.

---

## Concurrency

Multiple agents MAY drain in parallel; the atomic claim guarantees no two ever hold the same job. Each agent processes one claim at a time (claim -> execute -> record); skill-map ships no pool or scheduler, concurrency is however many agents the operator points at the queue.

The event schema carries a `jobId` on every event so parallel execution becomes a non-breaking extension. A future implementation MAY spawn multiple claim/run loops concurrently and interleave events; consumers identify an event's job by `jobId`.

Parallelism is NOT a v1.0 commitment. Implementations that offer it MUST still emit the canonical event stream correctly.

---

## Atomicity edge cases

Implementations MUST handle each of the following:

| Scenario | Required handling |
|---|---|
| `state_jobs` row exists but its `content_hash` is missing from `state_job_contents` (DB corruption, the content row deleted by external means). | Mark `failed` with `failureReason = job-file-missing`. `sm doctor` MUST report these proactively. The kernel does NOT produce this state under normal operation; submit and prune both keep the two tables consistent. The legacy enum name `job-file-missing` is preserved across the disk-to-DB shift for backward-compatibility; it now refers to a missing content row rather than a missing on-disk file. |
| `state_job_contents` row references no live `state_jobs` row (GC straggler). | `sm doctor` MUST list them. `sm job prune` MUST collect them in the same transaction that prunes terminal jobs. |
| Runner crashes between `claim` and reading the content. | TTL-armed jobs: covered by TTL/reap, when `expiresAt` passes, the next reap marks the job `failed` with `abandoned`. TTL-less jobs: surfaced by the `jobs-overdue` doctor check for operator resolution (`sm job fail <id>`). |
| Callback arrives after reap already failed the job. | Reject with exit 2 (see Record step 3). The runner should treat this as an error and log it. |

---

## Cancellation

`sm job cancel <job.id> | --all` transitions a `queued` or `running` job to the terminal `cancelled` state. `cancelled` is a distinct state, NOT a `failed` sub-reason, and carries NO `failureReason` (the state is self-explanatory). Effects:

| From | Effect |
|---|---|
| `queued` | Transition to `cancelled` (`finishedAt = now`, no `failureReason`). |
| `running` | Transition to `cancelled` (`finishedAt = now`, no `failureReason`). DOES NOT interrupt a subprocess runner; the runner discovers the terminal state on its next callback and exits cleanly. Implementations MAY additionally signal the subprocess, not normative. |
| Terminal | Reject with exit 2 ("already terminal"). |

`--all` cancels every `queued` and `running` job in one pass and reports the count. A missing `<job.id>` is exit 5. Passing neither `<job.id>` nor `--all` (or both) is a usage error (exit 2).

---

## Fail

`sm job fail <job.id> | --all` is the symmetric counterpart to cancel: it transitions a `queued` or `running` job to the terminal `failed` state with `failureReason = user-failed`. Use it to mark a job as failed by operator decision (distinct from a cancellation, which records no failure). Effects:

| From | Effect |
|---|---|
| `queued` | Transition to `failed` with `failureReason = user-failed` (`finishedAt = now`). |
| `running` | Transition to `failed` with `failureReason = user-failed` (`finishedAt = now`). DOES NOT interrupt a subprocess runner; the runner discovers the terminal state on its next callback and exits cleanly. |
| Terminal | Reject with exit 2 ("already terminal"). |

`--all` fails every `queued` and `running` job in one pass and reports the count. A missing `<job.id>` is exit 5. Passing neither `<job.id>` nor `--all` (or both) is a usage error (exit 2). Unlike cancel, a `user-failed` job is preserved by the default retention policy (`jobs.retention.failed = null`), so operator-marked failures stay in history for analysis.

---

## Retention and GC

Config controls (`jobs.retention.completed`, `jobs.retention.failed`, `jobs.retention.cancelled`):

- `completed` default 30 days (2592000 seconds).
- `failed` default `null` = never auto-purge (preserves failure history for analysis).
- `cancelled` default 30 days (2592000 seconds), mirroring `completed`: a cancellation is a routine terminal state with no failure to post-mortem, so it is prunable on the same schedule.

`sm job prune` applies retention across all three terminal states. Implementations MAY run this on a schedule (e.g., on `sm doctor`, or in a cron adapter) but MUST NOT prune implicitly during normal verb execution.

`sm job prune` MUST also collect orphaned `state_job_contents` rows (no live `state_jobs` references) in the same transaction that prunes terminal jobs. Ordering: delete terminal `state_jobs` rows in the retention window, then delete `state_job_contents` rows whose `content_hash` no longer appears in any `state_jobs` row.

---

## See also

- [`architecture.md`](./architecture.md), §Execution handover (agents drain via claim/record; there is no runner port).
- [`job-events.md`](./job-events.md), canonical event stream emitted during job execution.
- [`prompt-preamble.md`](./prompt-preamble.md), verbatim preamble prepended to every rendered job content row.
- [`db-schema.md`](./db-schema.md), `state_jobs` and `state_executions` table catalogs.
- [`cli-contract.md`](./cli-contract.md), `sm job` verb surface and exit codes.

---

## Stability

The state machine diagram above is **stable** as of spec v1.0.0. Adding a new state is a major bump; adding a new terminal reason (`failureReason` enum value) a minor bump.

The `cancelled` terminal state and the `user-failed` failure reason (and the paired `sm job cancel` → `cancelled` / `sm job fail` → `failed` semantics) landed **pre-1.0 as a MINOR bump**. Adding a state is normally a major change, but per [`versioning.md`](./versioning.md) §Pre-1.0 every breaking change ships inside a minor while the spec is `0.Y.Z`; the first `1.0.0` is the deliberate stabilization moment, not a side effect of this change. From that point on, the state-set is locked under the major-bump rule above.

The `contentHash` formula is **stable**. Changing what goes into the hash breaks duplicate detection across versions and is a major bump.

The atomic-claim semantics are **stable**. A double-claim would be a silent correctness bug observable through event-stream anomalies.

The TTL resolution procedure (§TTL resolution) is **stable** as of the next spec release: opt-in by construction (no TTL absent every explicit source), the precedence chain (flag → `jobs.perExtensionTtl` → `jobs.ttlSeconds`), and the `--ttl 0` disarm semantics are locked; adding a new override source is a minor bump, re-introducing a default-armed TTL a major bump. (The pre-#139 formula, `probExpectedDurationSeconds` × grace with floor, and its `jobs.graceMultiplier` / `jobs.minimumTtlSeconds` config keys were retired pre-1.0 by Decision #139; the estimate is advisory-only since.)
