---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Step 9.6.6 — plugin annotation contributions + Tier-1 `unknown-field` rule. Closes the last sub-step of the Step 9.6 annotation system.

**Manifest extension.** `spec/schemas/extensions/base.schema.json` gains an optional `annotationContributions` map keyed by annotation key. Each entry declares an inline JSON Schema for the value plus two policy fields: `location` (`'namespaced'` default, `'root'` opt-in) and `ownership` (`'shared'` default, `'exclusive'` opt-in). Defaults route a contribution into the plugin's `<plugin-id>:` block at the sidecar root; `location: 'root'` lifts it to a top-level reserved key alongside `for` / `annotations` / `settings` / `audit` and REQUIRES `ownership: 'exclusive'`.

**Loader validation.** `kernel/adapters/plugin-loader.ts` rejects two single-plugin invariants as `invalid-manifest`: `location: 'root'` with non-`exclusive` ownership, and inline `schema`s that fail to AJV-compile. After every plugin has loaded, the runtime composer (`core/runtime/plugin-runtime.ts:loadPluginRuntime`) walks the aggregated catalog and **hard-fails** when two plugins claim the same `(key, location: 'root', ownership: 'exclusive')` tuple — `loadPluginRuntime` throws a new `AnnotationContributionConflictError` and the kernel does NOT boot. Stricter than the per-plugin `invalid-manifest` path because annotation-namespace conflicts are non-recoverable: annotated `.sm` files would otherwise be non-deterministically routed.

**Runtime catalog.** `Kernel` gains `getRegisteredAnnotationKeys(): readonly IRegisteredAnnotationKey[]`, populated once by `registerEnabledExtensions` after every plugin loads. Pure read; no side effects. Built-in catalog fields from `annotations.schema.json` are NOT included — this catalog is plugin-only. The BFF endpoint that wraps the catalog for UI autocomplete lands separately.

**`core/unknown-field` rule.** New built-in Tier-1 typo guard (`severity: warn`). Walks parsed `.sm` sidecars and emits a warning for: (1) keys inside `annotations:` not in the curated catalog, (2) top-level keys outside the four reserved blocks that are not a registered plugin namespace nor a registered root contribution, (3) plugin-namespaced values that fail their contributing plugin's schema. The orchestrator threads parsed sidecar roots into the rule pass via `IRuleContext.sidecarRoots` plus the runtime catalog via `IRuleContext.annotationContributions`.

**Conformance.** New end-to-end case `sidecar-end-to-end` with fixture `spec/conformance/fixtures/sidecar-end-to-end/`. Flips coverage rows 26 + 27 (`sidecar.schema.json` + `annotations.schema.json`) from 🟡 partial to 🟢 covered. Asserts a populated `Node.sidecar` overlay, `status: stale-*` drift, denormalised `annotations.version`, and both `annotation-stale` + `annotation-orphan` issues from the built-in core rules.

**Side-fix.** `core/annotation-orphan` now emits `nodeIds: [<expectedMdRelative>]` instead of an empty array, closing the pre-existing `issue.schema.json#/properties/nodeIds/minItems: 1` violation latent until the conformance corpus exercised it.

**Plugin author guide.** New section `## Annotation contributions` in `spec/plugin-author-guide.md` covers the manifest shape, namespacing default vs root opt-in, ownership rules, hard-fail collision behaviour, the Tier-1 typo guard, and the runtime catalog accessor with worked examples. The full guide rewrite for agent-first readability is deferred to a post-Step-9.6 follow-up.
