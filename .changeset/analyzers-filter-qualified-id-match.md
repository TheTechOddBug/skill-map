---
"@skill-map/cli": patch
---

Fix the `--analyzers` (CLI) and `?analyzerId=` (BFF) filter so a qualified `<plugin>/<id>` form matches the persisted short analyzer id (issues store the short kebab id with no slash, per `issue.schema.json`). Before, only a short filter matched, so `sm check --analyzers core/node-stability` returned nothing while the bare `node-stability` worked. Both `matchesAnalyzerFilter` and the `/api/issues` SQL now reduce a qualified filter entry to its suffix; the short form is unchanged.

## User-facing
`sm check --analyzers core/<id>` now matches issues, not only the bare `<id>` form.
