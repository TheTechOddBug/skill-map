# Conformance suite

Language-neutral test suite the specification demands. A conforming implementation passes every case; failing any case is a conformance bug.

The suite splits across two ownership boundaries:

- **Spec-owned cases**, kernel-agnostic. They live in this directory and ship with `@skill-map/spec` (see the inventory below; `kernel-empty-boot` guards the boot invariant, `preamble-bitwise-match` the preamble bytes). The universal preamble fixture (`preamble-v2.txt`) lives here too.
- **Provider-owned cases**, exercise a Provider's own `kinds` catalog. They live next to the Provider's manifest, under `<plugin-dir>/conformance/`. The reference impl ships one such suite at [`src/extensions/providers/claude/conformance/`](../../src/extensions/providers/claude/conformance/) covering Claude's five kinds (`skill` / `agent` / `command` / `hook` / `note`) via cases `basic-scan`, `rename-high`, `orphan-detection`.

The shape below is normative; the case count in either bucket expands before spec-v1.0.0 (see [`../versioning.md`](../versioning.md)). See [`coverage.md`](./coverage.md) for the spec-owned matrix and the Provider's own coverage file (e.g. `src/extensions/providers/claude/conformance/coverage.md`) for the Provider-owned matrix.

The reference CLI exposes both buckets via `sm conformance run`:

```
sm conformance run --scope spec               # spec-owned cases only
sm conformance run --scope provider:claude    # the Claude Provider's cases
sm conformance run --scope all                # both (default)
```

External consumers (alt-impl authors, Provider authors validating their own work) can drive the suite without bespoke scripting; the verb provisions the same isolated tmp scope per case as the in-process reference runner does.

---

## Layout

```
spec/conformance/
├── README.md                 ← this file
├── fixtures/
│   └── preamble-v2.txt       ← verbatim preamble text for bitwise-match checks
└── cases/
    └── kernel-empty-boot.json ← declarative case (see "Case format" below)
```

```
src/extensions/providers/<id>/conformance/   ← Provider-owned, mirrors the layout
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
| `setup.priorInvokes[].expectExit` | no | Exit code the step MUST return; defaults to 0. Declare it to stage a REFUSAL, e.g. a duplicate submit that must be rejected before the queue state it leaves behind can be asserted. |
| `setup.priorInvokes[].capture` | no | Map of variable name to JSONPath, extracted from that step's stdout and substituted into every later step and the main `invoke` wherever `{{name}}` appears. Exists for credentials minted at runtime: `sm jobs claim --json` issues the nonce `sm record` then requires, and no static case could carry it. Substitution touches `args` and `flags` only, never `verb` / `sub`, so a captured value can never redirect which command runs. Stdout MUST parse as JSON, every expression MUST match, and every placeholder MUST be bound; each failure aborts the case rather than passing the token through verbatim. |
| `invoke.verb` | yes | First-level CLI verb. |
| `invoke.sub` | no | Subcommand for verbs that have them (e.g. `job submit`). |
| `invoke.args` | no | Positional arguments. |
| `invoke.flags` | no | Flags. Order-significant iff the CLI defines it (the reference impl accepts them in any order). |
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
| `stderr-matches` | `pattern: string` | stderr MUST match the regex (ECMAScript). |

Both schema assertions accept two optional narrowing fields:

- **`schemaPointer`**: a JSON Pointer (leading `/`) resolved INSIDE the named schema, selecting the subschema to validate against, e.g. `/$defs/PluginManifest`. For schemas whose ROOT models an aggregate no implementation writes while a `$def` describes the real on-disk artifact. The pointer navigates within the named document only; it cannot reach another file, and one that resolves to nothing fails the assertion. Without it such a row could only be backed by a validation against the permissive root, which passes while checking nothing.
- **`each`**: when true, the payload MUST be a NON-EMPTY array and every element MUST validate; the report names the first offending index. An empty array fails deliberately: validating zero elements proves nothing, and list surfaces are where that vacuous pass hides.

Assertion types beyond this list MAY be proposed via spec-vX.Y.Z minor bumps. Implementations MUST reject unknown assertion types loudly; silently skipping a check is itself a conformance violation.

---

## Current case inventory

### Spec-owned (this directory)

| Id | Verifies |
|---|---|
| `kernel-empty-boot` | With every Provider/Extractor/Analyzer disabled, scanning an empty scope returns a valid empty graph. |
| `no-global-scope` | The `-g/--global` flag does not exist. Implementations MUST reject it on every verb (exit `2`, "unknown option"). Guards `cli-contract.md` §Scope is always project-local. |
| `orphan-markdown-fallback` | Multi-Provider corpus where one node lands via the universal `core/markdown` fallback and another via vendor-specific claude classification. Locks the orchestrator's path-dedup contract. |
| `preamble-bitwise-match` | Rendered job content contains `preamble-v2.txt` byte-for-byte: a `ai-summarizer-action` job submitted over a scanned markdown node (via `setup.priorInvokes`), read back with `sm jobs preview --last`. Guards `prompt-preamble.md` §Stability. |
| `extension-mode-routing` | Dispatch routing follows the Action manifest `mode`: a probabilistic Action submitted via `sm jobs submit` lands as a queued `state_jobs` row (asserted through `sm jobs list --json`), never executing in-process. |
| `extension-mode-routing-deterministic` | The deterministic half: `sm jobs submit` refuses a deterministic Action with exit 2 and the in-process advisory. |
| `plugin-missing-ui-rejected` | Drop-in Provider whose `kinds[*]` entry omits the required `ui` block fails AJV validation with `invalid-manifest`; the rest of the pipeline keeps running. |
| `score-phase-confidence` | Drop-in analyzer declaring `phase: 'score'` composes a confidence adjustment (`delta -0.4`, then a no-op `floor 0.5`) on top of the kernel's 1.0 baseline (a clean resolved link keeps that baseline, no built-in op); the folded `scan_links.confidence` lands at exactly `0.6`. |
| `sidecar-end-to-end` | Co-located `.sm` sidecar shape, stale / orphan detection, populated `Node.sidecar` overlay, the `annotation-orphan` issue emitted (drift is icon-only, no `annotation-stale` issue). |
| `view-action-button` | An analyzer declaring the unified `inspector.header.badge` + the new `inspector.action.button` slots loads clean, while a sibling declaring the retired `inspector.header.badge.counter` slot fails as `invalid-manifest`; `sm scan` survives. |

### Provider-owned (per `<plugin-dir>/conformance/`)

| Provider | Id | Verifies |
|---|---|---|
| `claude` | `basic-scan` | Scanning the `minimal-claude` corpus detects exactly five nodes (one per kind) with no issues. Implicitly validates each per-kind schema. |
| `claude` | `rename-high` | High-confidence rename emits no issue; the new path is the sole node. |
| `claude` | `orphan-detection` | Deletion with no replacement triggers exactly one `orphan` issue (severity `info`). |

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

- The **case format** above is stable as of the first spec release that includes the suite. Adding an assertion type is a minor bump. Removing or changing one is a major bump. The same rule governs the optional fields on an existing assertion (`schemaPointer`, `each`) and the staging controls (`expectExit`, `capture`): adding one is a minor bump because a case that omits it behaves exactly as before, while changing what an existing field means is a major bump.
- Adding a case is a minor bump (new case required by a new conforming implementation → compat break).
- Removing or tightening a case is a major bump.
- Changing a fixture's contents is a major bump iff the fixture is referenced by any case.
