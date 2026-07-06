# Built-in extensions (built-in plugins)

The reference implementation's bundled extensions live here, organized by extension kind. Each is a directory with a manifest + implementation + a sibling `*.test.ts` (the kernel treats a missing test as a contract-check failure for built-ins).

The built-in **plugins** are declared in [`built-ins.ts`](./built-ins.ts):

- **`claude`** / **`antigravity`** / **`codex`** / **`agent-skills`** group the vendor Provider extensions (and, for `claude`, the two vendor-specific extractors that decode its `@`-directive and `/`-slash grammar). Today `antigravity`, `codex`, and `agent-skills` each ship just their Provider; `claude` ships its Provider plus the two extractors.
- **`core`** ships the kernel-internal primitives (every Rule, the Formatter, the markdown / URL-counter Extractors, the `core-markdown` fallback Provider).

Every extension is independently toggle-able by its qualified id `<plugin>/<ext-id>`, satisfying §Boot invariant: "no extension is privileged". Plugins are presentational grouping only; the bare plugin id maps to a CLI / BFF cascade macro (`sm plugins disable claude` fans out across every extension inside `claude`; multi-extension plugins need `--yes` in non-TTY contexts).

## Current built-in inventory

| Kind | Plugin | Id | Notes |
|---|---|---|---|
| Provider | `claude` | `claude` | Walks `.claude/{agents,commands,skills}/*.md` + `notes/**/*.md`; classifies into the four Claude node kinds (agent, command, skill, markdown, the last is the format-named generic fallback). |
| Provider | `antigravity` | `antigravity` | Metadata-only Provider for Google Antigravity CLI (released 2026-05-19, replaces the retired Gemini CLI). Adopts the open-standard `.agents/` via the `agent-skills` Provider; contributes lens identity + a reserved-name seed catalog. |
| Provider | `agent-skills` | `agent-skills` | Walks the agent-skills convention. |
| Provider | `core` | `markdown` | Universal `.md` fallback, claims any markdown file no vendor-specific Provider classifies. Last in iteration order. |
| Extractor | `core` | `slash` | Detects `/skill-map:explore`-style invocations in node bodies. |
| Extractor | `core` | `at-directive` | Detects `@agent-name` mentions. |
| Extractor | `core` | `markdown-link` | Detects `[text](path)` markdown links and emits one `references` link per resolved file path. |
| Extractor | `core` | `external-url-counter` | Counts external URLs per node; result lands on `node.externalRefsCount` (never persisted as a graph link). |
| Rule | `core` | `name-collision` | Two or more nodes claim the same normalized name? `error` when two or more declare it via `frontmatter.name`; `warn` when a declared name collides with another node's filename / dirname handle (mixed bucket). One Issue per colliding name. |
| Rule | `core` | `name-mismatch` | A node's declared `frontmatter.name` diverges from its path-derived handle (filename stem / parent dirname)? Severity from the kind's `identifierMismatch` knob: `warn` for open-standard skills (the spec requires name == dirname), `info` where the vendor documents the override as legal. |
| Rule | `core` | `reference-broken` | Invocation links pointing at a target that doesn't exist? Emits an `error` Issue. |
| Rule | `core` | `link-kind-conflict` | Two Extractors emit a link for the same `(source, target)` pair with different `kind` values? Emits a `warn` Issue per pair. |
| Rule | `core` | `schema-violation` | Post-scan AJV revalidation of every persisted node / link / issue against the spec schemas. (Pre-0.8.0 this was an `Audit` kind; absorbed into Rule when Audit was removed.) |
| Formatter | `core` | `ascii` | Plain-text dump grouped by node kind, then links, then issues. |
| Hook | `core` | `update-check` | Subscribes to `boot`. Runs the once-per-day "update available" probe + banner that lived inline on `cli/entry.ts` before the Hook kind had concrete consumers. Cache + bail conditions are unchanged from the inline call site. |

The `boot` and `shutdown` triggers fire from `cli/entry.ts`, not from `runScan`. Hooks that subscribe to `boot` / `shutdown` are dispatched by the entry-side dispatcher built over `builtIns().hooks`; pipeline-driven triggers (`scan.*`, `extractor.completed`, `analyzer.completed`, `action.completed`, `job.*`) flow through the orchestrator dispatcher inside `runScan`. Both dispatchers share `kernel/extensions/hook-dispatcher.ts` so the indexing / filter / error-handling semantics stay symmetric across the two entry points.

### Internal-only parsers

`parsers/{frontmatter-yaml,plain}/` ship as built-in modules but are **not** registered in any plugin and are deliberately absent from the table above, they have no `kind: 'parser'` user-facing surface. Provider manifests reference them by id (`read.parser`) and the kernel-internal registry in [`../kernel/scan/parsers/index.ts`](../kernel/scan/parsers/index.ts) is the only resolution seam (frozen at seed time, not re-exported from `src/kernel/index.ts`). They live here for layout consistency with the rest of the built-ins; user plugins cannot add parsers.

## Boot invariant

The kernel-empty-boot conformance case (`kernel-empty-boot`) asserts that with **zero registered extensions** the kernel still boots and returns an empty graph. The built-ins listed above are loaded on top of that empty boot, they are indistinguishable from drop-in plugins from the kernel's point of view. `--no-built-ins` strips them all and exercises the empty-boot path at runtime.

See [`ROADMAP.md`](../../ROADMAP.md) §Plugin system for the full kind catalog. Extension kind contracts are normative in [`spec/architecture.md`](../../spec/architecture.md); the toggle model is documented in [`spec/plugin-author-guide.md` §Toggle model](../../spec/plugin-author-guide.md#toggle-model).
