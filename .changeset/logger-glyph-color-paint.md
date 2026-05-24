---
'@skill-map/cli': patch
---

The CLI logger's `defaultFormat` now paints each line with the project's standard glyph + color per level, matching the rest of the output surface (see `context/cli-output-style.md` §Glyph catalog). Previously every level emitted as a plain `HH:MM:SS | LEVEL | message` row, so warnings the user is supposed to read scanned the same as low-noise debug lines.

- `src/cli/util/logger.ts`: `TLogFormatter` signature now takes a second `IAnsi` argument; `Logger` resolves the paint helper once per instance from the configured stream's `isTTY` (plus the new optional `noColorFlag` option mirroring the rest of the CLI) and threads it into every `#emit` call. `defaultFormat` renders `<dim time>  <painted glyph> <painted level>  message [<dim | {context}>]`:
  - `error` → red `✕ ERROR`
  - `warn` → yellow `⚠ WARN`
  - `info` → cyan `ℹ INFO`
  - `debug` / `trace` → dim `· DEBUG` / `· TRACE` (developer-mode noise stays visually quiet so the eye picks out the louder lines first)
- The pipe-separated `HH:MM:SS | LEVEL | message` shape is gone in the default formatter; consumers depending on it should opt out via a custom `format` (the API takes `(record, ansi)`, ignore `ansi` if you don't need the paint helper).
- Custom formatters keep working: the second arg is optional in user code, the no-op `IAnsi` is always supplied so destructuring is safe.
- The BFF's `sm serve` scan-path redirects `printer.warn` / `printer.error` into `log.warn` (see `src/server/routes/scan.ts:296-298`), so warnings from the runtime, the active-provider lens check, plugin-runtime advisories, all pick up the new paint without per-call-site changes.

## User-facing

`sm` log lines now lead with a coloured glyph per level (`⚠ WARN`, `✕ ERROR`, `ℹ INFO`) so advisories stand out from the rest of the output.
