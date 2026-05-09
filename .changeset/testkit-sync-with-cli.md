---
"@skill-map/testkit": patch
---

Sync `@skill-map/testkit` with recent CLI surface changes.

Two upstream commits left the testkit's typecheck red:

- `b3ba3de` — `Node.title` / `description` / `stability` / `version` were dropped from the public surface (only `frontmatter` and `tokens` remain optional). `node()` builder kept attaching the removed fields; the test fixtures kept asserting them.
- `496fb72` — `IRuleContext` gained a required `emitContribution(nodePath, contributionId, payload)` callback. `makeRuleContext()` returned a 2-key object that no longer satisfies the interface.

This patch:

- `testkit/src/builders.ts` — `node()` only attaches `frontmatter` / `tokens` overrides; the four removed optionals are gone.
- `testkit/src/context.ts` — `makeRuleContext()` supplies a no-op `emitContribution`, plus optional pass-through for `orphanSidecars` / `sidecarRoots` / `annotationContributions` / `viewContributions` so callers can populate any of them.
- `testkit/test/{builders,context,run}.test.ts` — assertions updated to use `frontmatter.name` / `frontmatter.description` instead of the removed top-level fields.

No public API removal that wasn't already removed at the CLI level. This is a "make the testkit compile against current CLI" patch — its consumers either upgrade the CLI dep too (in which case the old fields didn't exist anyway), or they pin the prior testkit version.
