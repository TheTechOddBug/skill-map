---
name: source
description: Fixture for the `backtick-trigger-extraction` conformance case. The backticked triggers below must reach the graph as FOUR resolved Links (agent mention deduped against the fenced repeat, skill mention, markdown mention, skill invocation), with the npm-scope and shell-path baits pruned by the resolution gate.
---

When the draft is ready, hand it to `@reviewer` for the final pass.

Prompt template (the duplicate mention below must dedupe into the same link):

```text
@reviewer check the attached draft against the style rules.
```

Start with `@deploy-site` and keep `@playbook` at hand. Then run `/deploy-site`.

Install the release tooling with `@changesets/cli` and never write to `/killdb`.
