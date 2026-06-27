---
name: Project handbook
description: Standing rules for agents working in this Antigravity project.
---

# Project handbook

This project is driven by Antigravity workflows (`.agent/workflows/`) and
shared Agent Skills (`.agents/skills/`). Workflows are slash-invocable
recipes; skills are reusable capabilities. Both are invoked by `/<name>`.

To ship, invoke /deploy. To promote a staging build, invoke /go-live
(workflows are always invoked by their file name). Always invoke
/run-tests before either.

This file is plain Markdown (the open AGENTS.md rules standard), so it is
classified by the universal `core/markdown` fallback, not by a vendor
provider. Under the antigravity lens its `/deploy` and `/go-live` tokens
still resolve, because the slash extractor runs on every node body.
