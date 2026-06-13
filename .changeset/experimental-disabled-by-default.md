---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Extensions declaring `stability: 'experimental'` now ship DISABLED by default: their installed default flips from enabled to disabled, so the extension does not run or register until the operator opts in (`sm plugins enable <plugin>/<ext>`, the Settings toggle, or a `settings.json` / `config_plugins` override). `beta` / `deprecated` / `stable` keep running. Built-ins flipped to experimental: `core/mcp-tools` and the Supersede declarer (`core/supersede` button + `core/node-supersede` action).

## User-facing

Experimental plugin extensions now start **disabled**: an off toggle (with the experimental badge) in Settings and `sm plugins list`, not running until you enable them. The MCP tools extractor and the Supersede button are experimental, so both are off until you turn them on.
