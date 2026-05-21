---
'@skill-map/cli': patch
---

Implement the spec'd active-provider auto-detect at scan entry (`spec/cli-contract.md` §Auto-detect on first scan), closing the gap where `activeProvider` only flowed when the operator typed `sm config set activeProvider <id>` manually.

**Behaviour:**

- Settings has `activeProvider` → use it verbatim (no-op).
- Filesystem markers detected with exactly one provider (`.claude/` → `claude`, `.gemini/` → `gemini`, `.codex/` or root `AGENTS.md` → `openai`, `.cursor/` → `cursor`) → persist to `.skill-map/settings.json` (project layer) and proceed. A one-line `info` surfaces the side effect.
- Multiple markers detected and `--yes` set → exit non-zero (`ExitCode.Error` / 2) with instructions to disambiguate via `sm config set activeProvider <id>`.
- Multiple markers detected and `--yes` not set → interactive prompt on stderr ("pick 1) claude  2) gemini" by number or name); persist the choice.
- No markers anywhere → soft warning ("scanning as universal markdown only"); the scan continues with `activeProvider: null`, which gates every provider-specific extractor off (per the spec-strict lens semantics from the previous change).

**Surface changes:**

- `sm scan` learns a new `--yes` flag (`Option.Boolean`). CLI verbs that already invoke the runner pass it through; init / BFF pass `yes: true` since they have no TTY.
- `IScanRunResult` gains a new `kind: 'ambiguous-provider'` variant. CLI `renderFailure` maps it to exit 2.
- `IScanRunOpts` gains `yes?: boolean` and `stdin?: NodeJS.ReadableStream`.
- New helper `core/runtime/active-provider-bootstrap.ts` encapsulates the detect / persist / prompt logic. Eight new unit tests cover the matrix (config / no-marker / single / ambiguous-with-yes / ambiguous-with-number / ambiguous-with-name / ambiguous-with-invalid-input / detection in effective roots when cwd is unrelated).

**Caveats:**

- The "no markers anywhere" branch diverges from the spec's literal "exit non-zero" wording. Project decision (re-pass 2026-05-21): plain-markdown projects must keep scanning, so we degrade with a warning instead of failing. The warning surfaces the gap and points at the fix.
- The interactive prompt requires a real stdin. BFF callers pass `yes: true` to avoid blocking; if the operator wants the lens disambiguated from the UI, the Settings page already wires `PATCH /api/active-provider` and runs BEFORE the scan.

## User-facing

First `sm scan` now auto-persists `activeProvider` to `.skill-map/settings.json` when exactly one provider folder is present. Multiple folders → interactive picker (or exit 2 under `--yes`). Plain markdown projects keep scanning with a soft warning.
