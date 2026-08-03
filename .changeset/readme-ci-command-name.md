---
"@skill-map/cli": patch
---

Correct the published README's developer-commands block: `pnpm validate` is described by what it does (every workspace, compile phase then test phase) instead of claiming CI runs it, which stopped being true when CI split into parallel `cli` and `ui` lanes. Documentation-only change, no runtime behaviour affected.
