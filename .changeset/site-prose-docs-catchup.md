---
'@skill-map/web': patch
---

The site's AI-ingestion and spec-index surfaces catch up with the spec: `PROSE_DOCS` in `build-site.js` gains the five normative prose contracts that had shipped without being listed (`mcp-server.md`, `provider-activity.md`, `telemetry.md`, `view-slots.md`, `input-types.md`), so they now appear on the `/spec/v0/` index page and in the generated `llms.txt` / `llms-full.txt`.
