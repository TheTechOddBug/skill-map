---
"@skill-map/spec": minor
---

Identifier agreement reworked in `architecture.md`: every built-in kind now declares `identifierMismatch: 'warn'` (a node answering to two names is ambiguity worth a warning even where the runtime documents the override as legal), while the `info` tier stays in the enum for external providers. The `core/contribution-orphan` bullet is gone from the analyzer catalog and `IAnalyzerContext.viewContributions` is now described as a generic context surface.
