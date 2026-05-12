# Built-in extensions (built-in plugin bundles)

The reference implementation's bundled extensions live here, organized by extension kind. Each is a directory with a manifest + implementation + a sibling `*.test.ts` (the kernel treats a missing test as a contract-check failure for built-ins).

The built-in **plugin bundles** are declared in [`built-ins.ts`](./built-ins.ts):

- **`claude`** / **`gemini`** / **`agent-skills`**, granularity `bundle` (vendor-level toggle). Each bundle ships only its Provider; the cross-vendor Extractors that any of these Providers' nodes can rely on live in `core`.
- **`core`**, granularity `extension` (every kernel built-in is independently removable, satisfying §Boot invariant: "no extension is privileged"). Ships the kernel-internal primitives (every Rule, the Formatter, the markdown / annotation / `slash` / `at-directive` / URL-counter Extractors, the `core-markdown` fallback Provider).

## Current built-in inventory

| Kind | Plugin | Id | Notes |
|---|---|---|---|
| Provider | `claude` | `claude` | Walks `.claude/{agents,commands,skills}/*.md` + `notes/**/*.md`; classifies into the four Claude node kinds (agent, command, skill, markdown, the last is the format-named generic fallback). |
| Provider | `gemini` | `gemini` | Walks Gemini's `.gemini/` territory; reuses the cross-vendor extractors registered under `core`. |
| Provider | `agent-skills` | `agent-skills` | Walks the agent-skills convention. |
| Provider | `core` | `markdown` | Universal `.md` fallback, claims any markdown file no vendor-specific Provider classifies. Last in iteration order. |
| Extractor | `core` | `annotations` | Reads sidecar `.sm` `annotations:` and emits `requires` / `related` / `supersedes` / `supersededBy` / `conflictsWith` links. |
| Extractor | `core` | `slash` | Detects `/skill-map:explore`-style invocations in node bodies. |
| Extractor | `core` | `at-directive` | Detects `@agent-name` mentions. |
| Extractor | `core` | `markdown-link` | Detects `[text](path)` markdown links and emits one `references` link per resolved file path. |
| Extractor | `core` | `external-url-counter` | Counts external URLs per node; result lands on `node.externalRefsCount` (never persisted as a graph link). |
| Rule | `core` | `trigger-collision` | Two nodes claim the same normalized trigger? Emits a `warn` Issue. |
| Rule | `core` | `broken-ref` | Invocation links pointing at a target that doesn't exist? Emits an `error` Issue. |
| Rule | `core` | `superseded` | A node marked `supersededBy` another that exists? Emits an `info` Issue. |
| Rule | `core` | `link-conflict` | Two Extractors emit a link for the same `(source, target)` pair with different `kind` values? Emits a `warn` Issue per pair. |
| Rule | `core` | `job-orphan-file` | A `*.md` file under `.skill-map/jobs/` that no `state_jobs.filePath` row references? Emits a `warn` Issue per orphan. Cleanup via `sm job prune --orphan-files`. |
| Rule | `core` | `validate-all` | Post-scan AJV revalidation of every persisted node / link / issue against the spec schemas. (Pre-0.8.0 this was an `Audit` kind; absorbed into Rule when Audit was removed.) |
| Formatter | `core` | `ascii` | Plain-text dump grouped by node kind, then links, then issues. |
| Hook | `core` | `update-check` | Subscribes to `boot`. Runs the once-per-day "update available" probe + banner that lived inline on `cli/entry.ts` before the Hook kind had concrete consumers. Cache + bail conditions are unchanged from the inline call site. |

The `boot` and `shutdown` triggers fire from `cli/entry.ts`, not from `runScan`. Hooks that subscribe to `boot` / `shutdown` are dispatched by the entry-side dispatcher built over `builtIns().hooks`; pipeline-driven triggers (`scan.*`, `extractor.completed`, `analyzer.completed`, `action.completed`, `job.*`) flow through the orchestrator dispatcher inside `runScan`. Both dispatchers share `kernel/extensions/hook-dispatcher.ts` so the indexing / filter / error-handling semantics stay symmetric across the two entry points.

### Internal-only parsers

`parsers/{frontmatter-yaml,plain}/` ship as built-in modules but are **not** registered in any bundle and are deliberately absent from the table above, they have no `kind: 'parser'` user-facing surface. Provider manifests reference them by id (`read.parser`) and the kernel-internal registry in [`../kernel/scan/parsers/index.ts`](../kernel/scan/parsers/index.ts) is the only resolution seam (frozen at seed time, not re-exported from `src/kernel/index.ts`). They live here for layout consistency with the rest of the built-ins; user plugins cannot add parsers.

## Boot invariant

The kernel-empty-boot conformance case (`kernel-empty-boot`) asserts that with **zero registered extensions** the kernel still boots and returns an empty graph. The built-ins listed above are loaded on top of that empty boot, they are indistinguishable from drop-in plugins from the kernel's point of view. `--no-built-ins` strips them all and exercises the empty-boot path at runtime.

See [`ROADMAP.md`](../../ROADMAP.md) §Plugin system for the full kind catalog and the granularity rules. Extension kind contracts are normative in [`spec/architecture.md`](../../spec/architecture.md).
