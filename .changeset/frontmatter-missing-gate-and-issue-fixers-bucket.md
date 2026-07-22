---
"@skill-map/spec": minor
---

The Action manifest's `precondition` gains a `frontmatterMissing` gate (the action applies only while the node's frontmatter is missing at least one listed field), and the `node.prob-extensions` envelope now carries a third `issueFixers` bucket (`IssueFixerEntry`) for probabilistic Actions whose `analyzerIds` resolve to a deterministic analyzer; the `standalone` bucket no longer lists them.
