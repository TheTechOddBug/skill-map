---
"@skill-map/cli": minor
---

`core/ai-summarizer-action` drops its `kind: ['markdown']` precondition and becomes the universal node summarizer: `sm job submit ai-summarizer-action --all` fans out to every non-virtual node regardless of kind. The Action ships experimental / disabled by default (opt-in via `sm plugins enable core/ai-summarizer-action`). The kernel AJV registry drops the removed per-kind summary schemas; write-through detection is unchanged (any report schema extending the `summaries/` namespace).

## User-facing

**Summarize anything (opt-in).** Enable it with `sm plugins enable core/ai-summarizer-action`, then `sm job submit ai-summarizer-action` works on every node (skills, agents, commands, hooks, markdown); `--all` queues a summary for your whole map.
