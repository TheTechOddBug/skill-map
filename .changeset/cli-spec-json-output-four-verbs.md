---
"@skill-map/spec": patch
"@skill-map/cli": patch
---

Add `--json` output to four verbs that previously emitted only human-formatted text: `sm refresh` (and `sm refresh --stale`), `sm plugins doctor`, `sm conformance run`, plus `--format json` on `sm graph` (`sm graph` uses the formatter catalog rather than the global `--json` flag). Closes the spec drift where the global `--json` flag was advertised but ignored on these verbs, and unblocks CI / scripting consumers that parse the output.

New JSON schemas under `spec/schemas/`:

- `refresh-report.schema.json`, `{ ok: true, kind: 'refresh.report', refreshed, nodes[], elapsedMs }`. Error envelope codes: `not-found` (missing node), `db-missing` (absent project DB), `internal` (read / persist failure).
- `plugins-doctor.schema.json`, `{ ok: true, kind: 'plugins.doctor', counts, issues[], warnings[], elapsedMs }`. `counts` collapses the raw discovery enum into the four error buckets (`loaded` / `incompatible` / `invalid` / `loadError`) so consumers do not have to track the kernel-side label catalog.
- `conformance-result.schema.json`, `{ ok: true, kind: 'conformance.result', totals, scopes[], elapsedMs }`. Error envelope codes: `bad-query` (unknown scope), `internal` (missing binary). A run that surfaces failing cases still returns `ok: true`; failures live under `scopes[].cases[].status === 'fail'` and gate the exit code.

`sm graph` gains a built-in `json` formatter (`built-in-plugins/formatters/json/`) that stringifies the persisted `ScanResult` (`scan-result.schema.json`), byte-equivalent to `sm scan --json` modulo whitespace. The formatter is registered alongside `ascii` in `built-in-plugins/built-ins.ts`, picked up automatically by the BFF's `GET /api/graph?format=json` (which previously documented JSON but had no formatter to back it). `IFormatterContext` gains an optional `scanResult` field so formatters whose output mirrors a full `ScanResult` envelope read it verbatim; existing formatters (today: `ascii`) ignore it.

Built-in extension count: 26 → 27 (the new `core/json` formatter). Spec `coverage.md` matrix grows three rows (`refresh-report`, `plugins-doctor`, `conformance-result`).

## User-facing

`sm refresh`, `sm plugins doctor`, and `sm conformance run` now respect `--json` for machine-readable output. `sm graph --format json` is a new format that emits the full ScanResult. CI / scripts can parse these instead of the human text.
