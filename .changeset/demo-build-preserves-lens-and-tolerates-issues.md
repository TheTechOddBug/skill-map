---
"@skill-map/web": patch
---

The public demo build now preserves the demo fixture's pinned active lens (it wipes only the scan cache instead of the whole `.skill-map/` directory) and treats an issues-found scan (`sm scan` exit 1) as a successful build, aborting only on an operational error (exit >= 2). This keeps the non-interactive demo dataset build deterministic for a fixture that ships both a root `AGENTS.md` and a `.claude/` marker plus deliberate findings.
