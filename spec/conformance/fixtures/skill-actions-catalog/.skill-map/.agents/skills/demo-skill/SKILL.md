---
name: demo-skill
description: Reviews one file for outdated steps and reports what it found.
metadata:
  version: 1.2.3
---

# Demo skill

Read the target file top to bottom. Flag any step that references
infrastructure that no longer exists, and propose the smallest wording
update for each flagged step. Do not rewrite sections that are accurate.
