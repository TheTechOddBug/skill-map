---
"@skill-map/cli": minor
---

`core/ai-summarizer-action` drops its `kind: ['markdown']` precondition and becomes the universal node summarizer: `sm job submit ai-summarizer-action --all` now fans out to every non-virtual node regardless of kind, and single-node submits accept skills, agents, commands and hooks. The kernel AJV registry drops the removed per-kind summary schemas; the write-through detection is unchanged (any report schema extending the `summaries/` namespace).

## User-facing

**Summarize anything.** `sm job submit ai-summarizer-action` now works on every node (skills, agents, commands, hooks, plain markdown), and `--all` queues a summary job for your whole map.
