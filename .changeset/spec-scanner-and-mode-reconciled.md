---
'@skill-map/spec': minor
---

Two internal spec contradictions reconciled. `interfaces/security-scanner.md` is rewritten over the findings pipeline: scanners are finder Analyzers extending the findings envelope (categories become finding `type` slugs, stable cross-run ids retired, kernel safety slugs reserved). And the architecture mode matrix now matches the schemas and runtime: Action `mode` is optional, defaulting to `deterministic`; a probabilistic Action missing `mode` still fails at load via the `prompt.md` rule.
