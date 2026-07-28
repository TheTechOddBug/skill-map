---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Errors escaping a verb now render a concise error block on stderr and exit 2 instead of Clipanion's generic exit 1 (which collided with the public `1 = issues found` contract); declining a destructive confirmation (`sm db reset` / `db restore` / `orphans undo-rename`) is now a voluntary no-op (exit 0, info line) per the new spec §Destructive confirmation; and the operations log now covers `refresh`, `db.*`, `orphans.*`, and `config.*` (key only, never the value).

## User-facing

**Cleaner exits.** Answering "no" to a destructive prompt (like `sm db reset`) now cancels cleanly with an info line instead of an error, and an unexpected crash prints one concise error message instead of a stack dump.
