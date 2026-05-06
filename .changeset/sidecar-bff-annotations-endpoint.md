---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Step 9.6.6 (BFF half) — `GET /api/annotations/registered` over the Hono BFF. Read-only catalog of plugin-contributed annotation keys, surfaced so a future UI autocomplete can offer plugin-namespaced and root-exclusive contributions the UI can't otherwise discover at runtime. The endpoint is a pure projection of `kernel.getRegisteredAnnotationKeys()` — populated once by `registerEnabledExtensions` after every plugin loads at server boot, frozen, surfaced unchanged. Built-in catalog keys (from `annotations.schema.json`) are NOT included; the UI knows the built-in set via the bundled spec.

**Wire contract.** Method + path: `GET /api/annotations/registered`. No query params, no body, no auth (matches `/api/plugins`, `/api/config`). 200 envelope: `{ "schemaVersion": "1", "kind": "annotations.registered", "items": IRegisteredAnnotationKey[], "counts": { "total": <int> } }`. Item shape per `src/kernel/types/annotation-catalog.ts`: `{ pluginId, key, location: 'namespaced' | 'root', ownership: 'exclusive' | 'shared', schema: Record<string, unknown> }` — the inline JSON Schema as declared in the contributing plugin's manifest, not the AJV-compiled validator. Catalog is small (typically 0–50 entries) so no pagination, no filters, no caching headers; mutating the returned `items` array does not affect subsequent calls (kernel view stays frozen).

**Composition.** `server/index.ts` now instantiates a kernel at boot (`createKernel()`), stamps `pluginRuntime.annotationContributions` onto it via `setRegisteredAnnotationKeys`, and threads the kernel through `IAppDeps.kernel` to the route factory. Routes that need the catalog read it off this kernel via closure — no shared mutable state, no DI container, factory only.

**Refresh policy.** Same as the rest of the BFF's plugin surface — discovery happens once at `sm serve` boot. An operator that installs a new plugin restarts the server, matching the watcher's documented "loaded ONCE at boot" contract.

**Spec contract.** Documented in `spec/cli-contract.md` §Sidecar bump → BFF endpoint subsection (sibling of `POST /api/sidecar/bump` from 9.6.5). The new `kind` discriminator (`annotations.registered`) is reserved at 9.6.6 and joins R7 alongside `sidecar.bumped` as the canonical `rest-envelope.schema.json#/properties/kind/enum` gap to close in one batch — same divergence stance as 9.6.5; closing the enum is part of the §Step 9.6 review-queue walk.

Tests at `src/test/server-annotations-endpoint.test.ts`: empty catalog (real `createServer()` boot with `--no-plugins`), populated catalog with a `namespaced` + a `root + exclusive` contribution surfaced through `createApp` directly (bypasses the loader's `process.cwd()` resolution which `loadPluginRuntime` reads via `defaultRuntimeContext()`), and a mutation guard that asserts the second call still sees the original frozen view. 3 cases pass.

UI half (autocomplete dropdown wired into the annotation editor) is post-Step-9.6 work and lands once the parent step's review queue walks to ✅.
