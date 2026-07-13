---
"@skill-map/spec": minor
---

Lands the deferred `preamble-bitwise-match` conformance case: a `markdown-summarizer` job submitted over a scanned markdown node must render content containing `preamble-v1.txt` byte-for-byte, read back via `sm job preview --last`. The case format grows `setup.priorInvokes` (ordered staging invocations that must exit 0, run after the fixture copy) and the `stdout-contains-verbatim` assertion; the CLI contract adds the `--last` selector to `sm job preview`.
