---
"@skill-map/cli": patch
---

The global rendered-markdown prose family in `ui/src/styles.css` is renamed from `.inspector__body-rendered` to the shared `.sm-md-prose` and now also styles the conversation dialog's bubbles, whose `pre` blocks previously kept browser-default `white-space: pre` and forced horizontal scroll on the whole dialog; the prose `pre { overflow-x: auto }` confines long lines to their own scrollable block.

## User-facing

**Conversation dialog readability.** Code blocks in agent prompts and responses now scroll inside their own box instead of stretching the dialog sideways, and messages render with proper markdown styling (headings, tables, code).
