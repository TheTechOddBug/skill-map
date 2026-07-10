---
name: fetch-docs
description: |
  Fetches up-to-date documentation for a library from Context7 (a remote
  MCP), so answers use current API syntax instead of stale training data.
  Use when the portfolio build needs current docs for a framework or
  library.
tools: [mcp__context7__resolve-library-id]
---

# fetch-docs

Pulls current docs from the Context7 MCP instead of guessing from memory.

## Steps
1. Call `mcp__context7__resolve-library-id` to resolve the library the
   user named (for example "the WHATWG URL parser" or "Vite config") into
   a Context7 library id.
2. Fetch that library's docs and answer the question from them.

Calling the tool fires the `PreToolUse` hook, which lights the
`mcp://context7` node on the map in real time. Context7 is public, so it
works locally with no extra authentication.
