---
"@skill-map/cli": minor
---

Every built-in `identifierMismatch` knob now declares `warn`, and the new built-in `core/ai-name-action` fixer (mirror of `ai-reference-action`, preconditioned on `core/name-mismatch`) queues a job that aligns the declared `name` with the file-derived handle. The never-implemented `core/contribution-orphan` stub was deleted, and `name-mismatch` plus `schema-violation` findings gained `fix.summary` remediation hints.

## User-facing

**Name mismatches are now warnings, with an AI fix.** A file whose declared name differs from its filename now shows as a warning everywhere, and a new AI fix can align the name for you. A diagnostic rule that could never produce results was removed.
