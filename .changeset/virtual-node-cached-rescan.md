---
"@skill-map/cli": patch
"@skill-map/spec": minor
---

Virtual nodes (e.g. `mcp://<server>` derived from a skill's `tools:` frontmatter by `core/mcp-tools`) now survive a cached rescan. `scan_nodes` gains `virtual` + `derived_from_json` columns so a DB-loaded prior recognises synthetic nodes, and the walker carries them forward when their source is a cache hit (the source's extractor is skipped, so nothing re-emits the node). Previously such a node vanished on the first incremental / `sm serve` rescan even though its source still referenced it.

## User-facing

An MCP node drawn from a skill's tool list (with no separate MCP config file, as under the Antigravity lens) no longer disappears from the map after the live watcher's first rescan.
