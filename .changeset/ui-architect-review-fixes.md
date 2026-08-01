---
"@skill-map/cli": patch
---

An architecture review pass over the bundled UI: the graph camera's deferred fits now key on a reconciled-layout tick instead of sibling-effect creation order, the topbar update chip surfaces the literal install command when a clipboard write is blocked instead of failing silently, branch-scoped live refreshes queued behind an in-flight fetch no longer escalate to a full reload, and the Queue tab loads as its own lazy chunk.
