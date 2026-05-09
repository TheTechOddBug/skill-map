# Built-in extensions (built-in plugin bundles)

The reference implementation's bundled extensions live here, organized by extension kind. Each is a directory with a manifest + implementation + a sibling `*.test.ts` (the kernel treats a missing test as a contract-check failure for built-ins).

The built-in **plugin bundles** are declared in [`built-ins.ts`](./built-ins.ts):

- **`claude`** / **`gemini`** / **`agent-skills`** — granularity `bundle` (vendor-level toggle). Each bundle ships only its Provider; the cross-vendor Extractors that any of these Providers' nodes can rely on live in `core`.
- **`core`** — granularity `extension` (every kernel built-in is independently removable, satisfying §Boot invariant: "no extension is privileged"). Ships the kernel-internal primitives (every Rule, the Formatter, the markdown / annotation / `slash` / `at-directive` / URL-counter Extractors, the `core-markdown` fallback Provider).

## Current built-in inventory

| Kind | Plugin | Id | Notes |
|---|---|---|---|
| Provider | `claude` | `claude` | Walks `.claude/{agents,commands,skills}/*.md` + `notes/**/*.md`; classifies into the four Claude node kinds (agent, command, skill, markdown — the last is the format-named generic fallback). |
| Provider | `gemini` | `gemini` | Walks Gemini's `.gemini/` territory; reuses the cross-vendor extractors registered under `core`. |
| Provider | `agent-skills` | `agent-skills` | Walks the agent-skills convention. |
| Provider | `core` | `markdown` | Universal `.md` fallback — claims any markdown file no vendor-specific Provider classifies. Last in iteration order. |
| Extractor | `core` | `annotations` | Reads sidecar `.sm` `annotations:` (canonical) and legacy frontmatter `metadata:` (transitional); emits `requires` / `related` / `supersedes` / `supersededBy` links. Surfaces parsed frontmatter scalars to the inspector via `node-key-values`. |
| Extractor | `core` | `slash` | Detects `/skill-map:explore`-style invocations in node bodies. |
| Extractor | `core` | `at-directive` | Detects `@agent-name` mentions. |
| Extractor | `core` | `markdown-link` | Detects `[text](path)` markdown links and emits one `references` link per resolved file path. |
| Extractor | `core` | `external-url-counter` | Counts external URLs per node; result lands on `node.externalRefsCount` (never persisted as a graph link). |
| Rule | `core` | `trigger-collision` | Two nodes claim the same normalized trigger? Emits a `warn` Issue. |
| Rule | `core` | `broken-ref` | Invocation links pointing at a target that doesn't exist? Emits an `error` Issue. |
| Rule | `core` | `superseded` | A node marked `supersededBy` another that exists? Emits an `info` Issue. |
| Rule | `core` | `link-conflict` | Two Extractors emit a link for the same `(source, target)` pair with different `kind` values? Emits a `warn` Issue per pair. |
| Rule | `core` | `validate-all` | Post-scan AJV revalidation of every persisted node / link / issue against the spec schemas. (Pre-0.8.0 this was an `Audit` kind; absorbed into Rule when Audit was removed.) |
| Formatter | `core` | `ascii` | Plain-text dump grouped by node kind, then links, then issues. |

The Hook kind has no built-ins yet; the kind exists so plugins can subscribe (concrete built-in Hooks land separately when demand surfaces).

## Boot invariant

The kernel-empty-boot conformance case (`kernel-empty-boot`) asserts that with **zero registered extensions** the kernel still boots and returns an empty graph. The built-ins listed above are loaded on top of that empty boot — they are indistinguishable from drop-in plugins from the kernel's point of view. `--no-built-ins` strips them all and exercises the empty-boot path at runtime.

See [`ROADMAP.md`](../../ROADMAP.md) §Plugin system for the full kind catalog and the granularity rules. Extension kind contracts are normative in [`spec/architecture.md`](../../spec/architecture.md).
