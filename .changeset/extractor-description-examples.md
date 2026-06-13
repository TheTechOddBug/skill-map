---
"@skill-map/cli": patch
---

Every built-in extractor description now ends with a concrete usage example. The `markdown-link`, `external-url-counter`, `annotations`, `mcp-tools`, `backtick-path`, `tools-counter`, and `slash-command` manifests keep their existing leading sentence and append a short `Example: ...` clause, so the text shown in `sm plugins list`, `sm plugins show`, and the Settings plugins panel illustrates what each extractor matches.

## User-facing

Extractor descriptions in `sm plugins list` and Settings now include a usage example.
