---
"@skill-map/cli": patch
---

Two sm-tutorial fixes from tester feedback: the first-agent chapter no longer repeats its framing (the redundant `Context` field is dropped, so the tester sees the agent-created message once instead of twice), and the scaffolded `.skillmapignore` guidance now guards against broadening the ignore to the whole `.claude/`, which would hide the harness agents and commands the tester builds.
