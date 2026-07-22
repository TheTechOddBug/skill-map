---
"@skill-map/cli": minor
---

Two new built-in probabilistic finders split the security lane: `core/ai-security-analyzer` finds hygiene problems the author fixes (plaintext credentials, piped-to-shell installs, unguarded destructive commands, over-broad permissions), while `core/ai-suspicion-analyzer` flags content designed to manipulate AI agents (instruction overrides, human-invisible instructions, purpose-foreign exfiltration) and never gets a fixer by design. Both ship stable and enabled after live playground passes.

## User-facing

**Two new AI security checks, on by default.** One finds security slip-ups in your files (pasted credentials, risky commands), the other flags content that tries to manipulate an AI agent (hidden instructions, data-leak requests). Findings appear alongside the other AI checks.
