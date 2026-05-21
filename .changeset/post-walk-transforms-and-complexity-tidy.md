---
'@skill-map/cli': patch
---

Unify the orchestrator's post-walk link transforms under a single internal seam, and pay down two complexity-rule hot-spots flagged by lint.

**1. Post-walk transforms (closes `bd-1ul`).**

Two loose calls in `runScanInternal` (`dedupeLinks` followed by `liftMentionConfidence`) used to live as stand-alone statements at the tail of the merge phase. Each is a polish pass over the merged link graph: cross-extractor edge dedup with `sources[]` union + confidence-max, then post-resolution confidence bump for `mentions` links. With more transforms inbound (the `bd-owi` discussion already hinted at provider-kind-driven confidence bumps), the orchestrator was acquiring a creep of loose post-walk calls that would have grown without bound.

This change introduces `src/kernel/orchestrator/post-walk-transforms.ts` with:

- `IPostWalkTransform`, internal-only interface (`id`, `description`, `run(links, nodes)`). Transforms MAY mutate in place or return a fresh array, the runner honours either style by threading the returned value when present and falling back to the input otherwise. Matches the existing functions: `dedupeLinks` returns fresh, `liftMentionConfidence` mutates.
- `POST_WALK_TRANSFORMS`, the ordered registry. Sequence is load-bearing: `dedupe-links` first so cross-extractor `sources[]` are unioned BEFORE downstream passes read final per-edge state, then `lift-mention-confidence` so a `mentions` link emitted by two extractors arrives already merged and the bump runs once against the final edge.
- `applyPostWalkTransforms(links, nodes)`, the runner. Single call site in `runScanInternal` replaces the previous two statements. Inline comment in the orchestrator clarifies this is NOT the spec's Signal IR resolver phase (which materialises Signal -> Link); these transforms run AFTER both Signal-resolved and direct-emit links have converged.

The existing `dedupeLinks` (in `extractors.ts`) and `liftMentionConfidence` (in `lift-mention-confidence.ts`) stay exported with their current shapes, so the direct-import unit tests in their respective `__tests__/` folders keep passing unchanged.

No spec change: the resolver phase contract stays Signal -> Link only, post-walk transforms are kernel-internal polish over the already-merged graph and never reach plugin authors (the five-extension-kind catalog is unchanged).

New tests in `src/kernel/orchestrator/__tests__/post-walk-transforms.spec.ts` cover the runner's ordering guarantee, return-vs-void threading, and the default registry sequence (6 cases). Combined with the existing 18 tests for `dedupeLinks` and `liftMentionConfidence`, the post-walk surface is fully pinned.

**2. Complexity hot-spots (lint debt).**

Two functions had drifted past the project's complexity rule and were being held open with `eslint-disable` margins. Pure mechanical extracts, no behaviour change:

- `src/cli/commands/config.ts`: pulled the lookup-then-runtime-resolver-then-undefined chain in `ConfigGetCommand.run` into a `resolveConfigGetValue(lookupValue, key, cwd)` helper. The command body reads as a flat pipeline now (load, validate, resolve, render).
- `src/core/runtime/scan-runner.ts`: extracted `loadScanInputs(opts, ctx)` (bundles the cfg load + ignore filter + strict flag + effective-roots resolution under a single try/catch that returns either a `config-error` result or the bundle) and `resolveActiveLens(opts, ctx, roots, pluginRuntime)` (bootstrap + lens-disabled warning + early-return on ambiguous). Removed an obsolete rationale comment that justified the old monolithic shape.

**3. Reference drift.**

`context/cli-reference.md` was out of sync with `main`: the prior commit `0da1ab2` shipped `--yes` on `sm scan` but did not regenerate the reference. Regenerated via `sm help --format md` per the AGENTS.md rule; the only diff is the missing `--yes` line under the `scan` verb.

**Validation:** `pnpm --filter @skill-map/cli validate:compile` (typecheck + lint + build + reference:check + built-ins:check) and `pnpm --filter @skill-map/cli test` (1639 pass, 0 fail).
