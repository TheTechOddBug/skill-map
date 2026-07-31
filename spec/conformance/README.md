# Conformance suite

Language-neutral test suite the specification demands. A conforming implementation passes every case; failing any case is a conformance bug.

The suite splits across two ownership boundaries:

- **Spec-owned cases**, kernel-agnostic. They live in [`cases/`](./cases/) in this directory and ship with `@skill-map/spec` (`kernel-empty-boot` guards the boot invariant, `preamble-bitwise-match` the preamble bytes, `no-global-scope` the project-local scope rule, and so on). The universal preamble fixture (`preamble-v2.txt`) lives here too.
- **Provider-owned cases**, exercise a Provider's own `kinds` catalog. They live next to the Provider's manifest, under `<plugin-dir>/conformance/`. The reference impl ships one such suite per built-in Provider, e.g. [`src/plugins/claude/providers/claude/conformance/`](../../src/plugins/claude/providers/claude/conformance/) covering Claude's four kinds (`agent` / `command` / `skill` / `mcp`).

The shape below is normative; the case count in either bucket grows as the suite does (see [`../versioning.md`](../versioning.md)). Neither inventory is transcribed here, a hand-copied list goes stale the moment a case lands: the directories themselves are the authoritative enumeration, [`coverage.md`](./coverage.md) is the spec-owned schema-to-case matrix, and each Provider's own coverage file (e.g. `src/plugins/claude/providers/claude/conformance/coverage.md`) is the Provider-owned one. `sm conformance run --json` prints every case the installed implementation actually resolves.

The reference CLI exposes both buckets via `sm conformance run`:

```
sm conformance run --scope spec               # spec-owned cases only
sm conformance run --scope provider:<id>      # one Provider's own cases
sm conformance run --scope all                # every visible scope (default)
```

The `provider:<id>` scopes are **discovered**, not enumerated by this document: the implementation walks each Provider for a `conformance/` directory and offers one scope per suite it finds.

External consumers (alt-impl authors, Provider authors validating their own work) can drive the suite without bespoke scripting; the verb provisions the same isolated tmp scope per case as the in-process reference runner does.

---

## Layout

```
spec/conformance/
├── README.md                 ← this file
├── coverage.md               ← schema-to-case coverage matrix (authoritative inventory)
├── fixtures/
│   ├── preamble-v2.txt       ← verbatim preamble text for bitwise-match checks
│   └── <name>/               ← one controlled corpus per case that needs one
└── cases/
    └── <id>.json             ← one declarative case per file (see "Case format" below),
                                filename MUST equal the case `id`
```

```
src/plugins/<plugin>/providers/<id>/conformance/   ← Provider-owned, mirrors the layout
├── coverage.md
├── cases/
│   └── *.json
└── fixtures/
    └── ...
```

Fixtures are read-only inputs. Cases declare what to invoke and what to assert. A conformance runner is implementation-specific code that:

1. Reads every file under `cases/`.
2. For each case: provisions a clean scope, copies the referenced fixture into it, invokes the implementation, compares output against the assertions.
3. Emits a pass/fail summary.

---

## Case format

Cases are validated against [`conformance-case.schema.json`](../schemas/conformance-case.schema.json), the normative shape; this section is the human-readable walkthrough. Include `"$schema": "https://skill-map.ai/spec/v1/conformance-case.schema.json"` in every case file for IDE support.

A case is a JSON document with this shape:

```jsonc
{
  "id": "string, kebab-case, globally unique among cases.",
  "description": "string, one-to-three sentences, what the case verifies.",

  "fixture": "string, folder under fixtures/ used as the scope root.",

  "setup": {
    "disableAllProviders": false,
    "disableAllExtractors": false,
    "disableAllAnalyzers": false,
    "priorScans": [{ "fixture": "some-folder", "flags": [] }],
    "priorInvokes": [
      { "verb": "job", "sub": "submit", "args": ["ai-summarizer-action"], "flags": ["-n", "notes.md"] }
    ]
  },

  "invoke": {
    "verb": "scan | list | show | check | findings | graph | export | job | record | ...",
    "sub": "submit | run | ...",
    "args": ["positional", "args"],
    "flags": ["--json", "--all", "..."]
  },

  "assertions": [
    { "type": "exit-code", "value": 0 },
    { "type": "json-path", "path": "$.schemaVersion", "equals": 1 },
    { "type": "stdout-contains-verbatim", "fixture": "preamble-v2.txt" }
  ]
}
```

### Field reference

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable identifier. Used in reports. MUST match the filename: `cases/<id>.json`. |
| `description` | yes | Human-readable, short. |
| `fixture` | sometimes | Folder name under `fixtures/`. Omit for cases that do not need a corpus (e.g. empty-boot). |
| `setup` | no | Pre-invocation flags and staging steps. All boolean toggles default to `false`. `priorScans` are ordered fixture-swap + `sm scan` steps (prior snapshots for heuristic verbs); `priorInvokes` are ordered arbitrary invocations run after the top-level `fixture` copy and before the main `invoke` (state a scan cannot establish, e.g. a submitted job). |
| `setup.serve` | no | When `true`, the runner starts the implementation's server (the `sm serve` equivalent) on an EPHEMERAL port inside the scope, after the top-level `fixture` copy and plugin trust and before `setup.priorInvokes`. Readiness is observed via `.skill-map/serve.json` (the discovery file the serve contract mandates); the server stays up through the main `invoke` AND assertion evaluation, then is torn down. That ordering is the point: `file-matches-schema` can observe files that exist only while the server runs, and `http-matches-schema` depends on it. |
| `setup.staticServe` | no | `{ "fixture": "<dir>" }`. The recorded-fixture network transport: the runner serves that directory read-only over loopback HTTP on an ephemeral port for the case's lifetime (up before `setup.priorInvokes`, torn down after assertion evaluation) and binds the base URL as `{{staticServeUrl}}`, available everywhere `capture` variables are. The fixture holds RECORDED responses as plain files whose relative paths mirror the request paths, so a network-fetching extension exercises its real fetch path against deterministic bytes while the scope stays offline. Containment-guarded like every other fixture reference; no directory listings; unknown paths answer 404. |
| `setup.priorInvokes[].expectExit` | no | Exit code the step MUST return; defaults to 0. Declare it to stage a REFUSAL, e.g. a duplicate submit that must be rejected before the queue state it leaves behind can be asserted. |
| `setup.priorInvokes[].capture` | no | Map of variable name to JSONPath, extracted from that step's stdout and substituted into every later step and the main `invoke` wherever `{{name}}` appears. Exists for credentials minted at runtime: `sm jobs claim --json` issues the nonce `sm record` then requires, and no static case could carry it. `setup.staticServe` binds `{{staticServeUrl}}` through the same map (before any staged step runs), so a recorded-transport base URL is spliced exactly like a captured value. Substitution touches `args` and `flags` only, never `verb` / `sub`, so a captured value can never redirect which command runs. Stdout MUST parse as JSON, every expression MUST match, and every placeholder MUST be bound; each failure aborts the case rather than passing the token through verbatim. |
| `setup.priorInvokes[].sleepAfterMs` | no | Milliseconds (0 to 30000) the runner sleeps AFTER the step completes and before the next one. Exists solely to let TTL-expiry contracts become observable (`sm jobs submit --ttl 1`, a sleep, then the reap); arm at least 3x the TTL the case staged so wall-clock noise cannot flip the outcome. NOT a general pacing tool. |
| `invoke.verb` | yes | First-level CLI verb. |
| `invoke.sub` | no | Subcommand for verbs that have them (e.g. `job submit`). |
| `invoke.args` | no | Positional arguments. |
| `invoke.flags` | no | Flags. Order-significant iff the CLI defines it (the reference impl accepts them in any order). |
| `invoke.parallel` | no | Integer 2 to 8. The runner spawns this many IDENTICAL invocations CONCURRENTLY (all started before any is awaited), the only way a case can express a race; capture substitution applies to each copy identically. When set, the per-result assertion types are AUTHORING ERRORS ("the" result is ambiguous across N); only the `parallel-*` set assertions may be used, and the runner MUST fail loudly on a violation rather than picking a result silently. |
| `assertions` | yes | Array, ≥ 1 item. Ordering matters for reporting only. |

### Assertion types

| `type` | Fields | Meaning |
|---|---|---|
| `exit-code` | `value: integer` | Exit code of the invocation MUST equal `value`. |
| `json-path` | `path: string`, one of `equals` / `greaterThan` / `lessThan` / `matches` | JSONPath (RFC 9535 subset) evaluated against stdout (parsed as JSON); the extracted value MUST satisfy the comparator. `matches` uses ECMAScript regex. |
| `file-exists` | `path: string` | Path MUST exist after invocation, relative to the scope root. |
| `file-contains-verbatim` | `path: string`, `fixture: string` | File at `path` MUST contain the bytes of `fixtures/<fixture>` verbatim. |
| `stdout-contains-verbatim` | `fixture: string` | stdout of the invocation MUST contain the bytes of `fixtures/<fixture>` verbatim. Used for preamble bitwise checks. |
| `file-matches-schema` | `path: string`, `schema: string`, optional `schemaPointer` / `each` | File at `path` MUST be valid JSON and MUST validate against `schemas/<schema>`. |
| `stdout-matches-schema` | `schema: string`, optional `schemaPointer` / `each` | stdout MUST parse as JSON and validate against `schemas/<schema>`. The form most coverage rows need: a CLI's machine-readable surface is `--json` on stdout, not a file it happens to leave behind. |
| `http-matches-schema` | `request: { path, method? }`, `schema: string`, optional `status` (default 200) / `schemaPointer` / `each` | Issues the request against the server `setup.serve` started (loopback, port resolved from `serve.json`); the response status MUST equal `status` and the body MUST parse as JSON and validate against `schemas/<schema>`. Declaring it without `setup.serve: true` is an authoring error the runner fails loudly, never skips. |
| `ndjson-line` | `match: object`, optional `path` + one of `equals` / `greaterThan` / `lessThan` / `matches` | stdout is parsed as NDJSON; every non-empty line MUST parse as JSON. The FIRST line whose document deep-equals every top-level key/value in `match` is selected (no match fails); `path` + a comparator are then evaluated against that line's document. For event-stream surfaces (`sm record --json`) a whole-document assertion cannot parse. |
| `stderr-matches` | `pattern: string` | stderr MUST match the regex (ECMAScript). |
| `parallel-exit-codes` | `sorted: integer[]` | Requires `invoke.parallel`. The multiset of the N invocations' exit codes, sorted ascending, MUST deep-equal `sorted`. Canonical use: one queued job, two concurrent claims, `[0, 1]` IS the atomicity proof (two zeros = double handout, two ones = lost job). |
| `parallel-json-path-count` | `path: string`, one of `equals` / `greaterThan` / `lessThan` / `matches`, `count: integer` | Requires `invoke.parallel`. Of the N results, the number whose stdout parses as JSON AND satisfies the comparator at `path` MUST equal `count`; a non-JSON stdout simply does not count (the losing claim prints nothing, and that is the point). |

Both schema assertions accept two optional narrowing fields:

- **`schemaPointer`**: a JSON Pointer (leading `/`) resolved INSIDE the named schema, selecting the subschema to validate against, e.g. `/$defs/PluginManifest`. For schemas whose ROOT models an aggregate no implementation writes while a `$def` describes the real on-disk artifact. The pointer navigates within the named document only; it cannot reach another file, and one that resolves to nothing fails the assertion. Without it such a row could only be backed by a validation against the permissive root, which passes while checking nothing.
- **`each`**: when true, the payload MUST be a NON-EMPTY array and every element MUST validate; the report names the first offending index. An empty array fails deliberately: validating zero elements proves nothing, and list surfaces are where that vacuous pass hides.

Assertion types beyond this list MAY be proposed via spec-vX.Y.Z minor bumps. Implementations MUST reject unknown assertion types loudly; silently skipping a check is itself a conformance violation.

---

## Case inventory

**There is no transcribed inventory in this document, by design.** A hand-maintained table of case ids is stale the day a case lands, and this section used to be exactly that. The authoritative enumerations are:

- **Spec-owned**: every `*.json` file in [`cases/`](./cases/), shipped inside `@skill-map/spec`. Each file's `id` equals its filename and its `description` states what it verifies, so `ls` plus the file itself is the inventory. [`coverage.md`](./coverage.md) maps them onto the schemas and invariants they cover, and is the document to read (and to update) when judging whether the suite covers a given contract.
- **Provider-owned**: every `*.json` under each Provider's `conformance/cases/`, one suite per Provider that ships one (in the reference impl, `src/plugins/<plugin>/providers/<id>/conformance/`). Each suite carries its own `coverage.md`.
- **Resolved at runtime**: `sm conformance run --json` reports every case the installed implementation actually found, per scope, which is the only inventory that can never drift.

A few named cases recur throughout the prose contracts and are worth knowing by name:

| Id | Bucket | Verifies |
|---|---|---|
| `kernel-empty-boot` | spec-owned | With every Provider/Extractor/Analyzer disabled, scanning an empty scope returns a valid empty graph. Referenced by [`../architecture.md`](../architecture.md). |
| `preamble-bitwise-match` | spec-owned | Rendered job content contains `preamble-v2.txt` byte-for-byte: a `ai-summarizer-action` job submitted over a scanned markdown node (via `setup.priorInvokes`), read back with `sm jobs preview --last`. Guards [`../prompt-preamble.md`](../prompt-preamble.md) §Stability. |
| `no-global-scope` | spec-owned | The `-g/--global` flag does not exist. Implementations MUST reject it on every verb (exit `2`, "unknown option"). Guards [`../cli-contract.md`](../cli-contract.md) §Scope is always project-local. |
| `basic-scan` | provider-owned | Each Provider's baseline: scanning its minimal corpus yields the expected node count with no issues, implicitly validating its per-kind frontmatter schemas. The Claude suite asserts exactly **four** nodes (`agent`, `command`, `skill`, plus the `notes/architecture.md` node the universal `core/markdown` fallback claims). |

---

## Runner (reference pseudocode)

Implementations may write their runner in any language. A minimal Node ESM version:

```js
import { readdir, readFile, cp, rm, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

for (const caseFile of await readdir('spec/conformance/cases')) {
  const c = JSON.parse(await readFile(`spec/conformance/cases/${caseFile}`, 'utf8'));
  const scope = await provisionTmpScope(c.fixture);
  const result = spawnSync('sm', [c.invoke.verb, ...(c.invoke.flags ?? [])], { cwd: scope });
  const passed = c.assertions.every((a) => evaluate(a, result, scope));
  report(c.id, passed);
  await rm(scope, { recursive: true });
}
```

A Provider-owned runner mirrors the loop with a different cases / fixtures root, `<plugin-dir>/conformance/cases/` and `<plugin-dir>/conformance/fixtures/`. The reference CLI ships both as `sm conformance run`; the verb resolves the spec scope via `@skill-map/spec` and discovers Provider scopes by walking each built-in plugin's `conformance/` directory.

The reference runner ships under `src/conformance/index.ts`; the verb lives at `src/cli/commands/conformance.ts` and uses the runner one case at a time.

---

## See also

- [`coverage.md`](./coverage.md), schema-to-case coverage matrix and release gates.
- [`../versioning.md`](../versioning.md), what constitutes a major/minor/patch change to the suite.
- [`../architecture.md`](../architecture.md), kernel empty-boot invariant exercised by `kernel-empty-boot`.
- [`../prompt-preamble.md`](../prompt-preamble.md), verbatim text checked by `preamble-bitwise-match`.

---

## Stability

- The **case format** above is stable as of the first spec release that includes the suite. Adding an assertion type is a minor bump. Removing or changing one is a major bump. The same rule governs the optional fields on an existing assertion (`schemaPointer`, `each`) and the staging controls (`expectExit`, `capture`, `setup.staticServe`): adding one is a minor bump because a case that omits it behaves exactly as before, while changing what an existing field means is a major bump.
- Adding a case is a minor bump. The old justification here ("a new conforming implementation must now pass it, so it is a compat break") was wrong: the suite VERIFIES the contract, it does not define it, and per `versioning.md` failing a case is a bug report rather than a spec violation. An implementation that fails a newly added case was already non-conforming; the case only made that measurable.
- Removing or weakening a case is a patch bump; nothing is required that was not required before.
- A case that demands MORE than the contract states is not a suite change at all: the contract text has to change with it, and THAT change sets the bump. A case cannot quietly raise the bar on its own.
- Changing a fixture's contents is a major bump iff the fixture is referenced by any case, since fixture bytes are the input a case computes its expectations against.
- The full table lives in [`../versioning.md`](../versioning.md) §Conformance suite changes; this list is its summary.
