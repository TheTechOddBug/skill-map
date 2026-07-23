# Kernel & `src/` conventions

Annex of [`AGENTS.md`](../AGENTS.md). Read this file before editing anything under `src/` (kernel, CLI, built-in plugins, conformance runner). For BFF-specific layout see [`bff.md`](./bff.md); for lint policy see [`lint.md`](./lint.md).

## Type naming convention

The kernel uses five naming buckets for TypeScript types / interfaces. The full doc (with edge cases) lives in `src/kernel/types.ts`'s top docstring; the short version:

1. **Domain types**, mirror `spec/schemas/*.json`. **No prefix.** `Node`, `Link`, `Issue`, `ScanResult`, `ExecutionRecord`. The name tracks the schema verbatim because the spec is the source of truth.
2. **Hexagonal ports**, abstract boundaries with `Port` suffix: `StoragePort`, `RunnerPort`, `ProgressEmitterPort`. The suffix flags the architectural role and avoids clash with the concrete adapter (e.g. `SqliteStorageAdapter` implements `StoragePort`).
3. **Runtime extension contracts**, shapes a plugin author implements: `IProvider`, `IExtractor`, `IAnalyzer`, `IAction`, `IFormatter`. **`I` prefix.** Reads as "you supply this".
4. **Internal interfaces**, option bags, result records, config slices, structured shapes that live only in TS (never in JSON): `IPluginRuntime`, `IPruneResult`, `IDbLocationOptions`. **`I` prefix.** Always declared as `interface`.
5. **Internal type aliases**, string-literal unions, function types, mapped/derived types that live only in TS: `TLogLevel`, `TLogMethodLevel`, `TProgressListener`, `TLogFormatter`, `TActionWrite`, `TExecutionMode`, `THookFilter`, `THookTrigger`, `TNodeChangeReason`, `TPluginLoadStatus`, `TPluginStorage`, `TWatchEventKind`. **`T` prefix.** Always declared as `type`. Use this bucket when `interface` is the wrong shape (a union, a callback signature, an `Exclude<…>` derivation).

**Grandfathered exceptions**, pre-existing public-surface shapes that pre-date the `I*`/`T*` convention and would break downstream consumers if renamed. These are exempt from the prefix analyzer:

- **Category 4 option bags**: `RunScanOptions`, `RenameOp`.
- **Category 4 TS-only exports from `kernel/index.ts` / `kernel/ports/*`**: `Kernel`, `ProgressEvent`, `LogRecord`, `NodeStat`.

The list above is closed. New public option bags and new internal interfaces must still take `I*`; new internal type aliases (Category 5) must still take `T*`. Removing a name from this list (i.e. renaming the shape to `I*`/`T*`) is a breaking change and ships under the breaking-change analyzers in `spec/versioning.md`.

When in doubt: "does this shape exist in the spec?". Yes → no prefix, name from schema. No → `I*` if it's an `interface`, `T*` if it's a `type` alias.

## Kernel boundaries & adapter wiring

The kernel is NOT allowed to know about its drivers. Today there are two drivers: `src/cli/` (Clipanion verbs) and `src/server/` (Hono BFF). Future drivers (in-memory test harness, IDE plugin, …) drop in without the kernel changing. The lint config (`src/eslint.config.js`) enforces these invariants structurally, they cannot regress silently.

1. **No `console.*` in `src/kernel/**`**. Use the singleton logger: `import { log } from '<.../>kernel/util/logger.js'`. The CLI installs the active impl at boot via `configureLogger(new Logger({ level, stream }))`. The default is `SilentLogger`. Tests install a capture logger and call `resetLogger()` in `try/finally` (or `afterEach`) to avoid cross-test bleed. The port shape (`LoggerPort`, `TLogLevel`, `LogRecord`) lives in `src/kernel/ports/logger.ts`; the proxy + setters in `src/kernel/util/logger.ts`.

2. **No `process.cwd()` / `process.env` / `os.homedir()` in `src/kernel/**`**. Kernel APIs that need a runtime context take it through their options bag, **mandatory** (not optional with a fallback). The drivers bridge via `defaultRuntimeContext()` in `src/core/runtime/runtime-context.ts` (the historic `src/cli/util/runtime-context.ts` path is a re-export shim), which returns `{ cwd: process.cwd() }` only; `homedir` is deliberately not part of the context (closed caller list in `AGENTS.md` §Project invariants). Pattern: `loadConfig({ ...defaultRuntimeContext() })`.

3. **No imports from `src/cli/**` inside `src/kernel/**`**. The reverse direction is fine. Enforced by `no-restricted-imports`. The same analyzer applies to `src/server/**`, kernel never imports the BFF driver. Cross-driver borrowing (the BFF reaching into `src/cli/util/`) IS allowed and used today: `cli/commands/serve.ts` consumes `createServer` from `src/server/`, and `src/server/` consumes the kernel + a small set of CLI utilities (error reporter, sanitization, exit codes, runtime context). The BFF never adds kernel side effects of its own, it reads from / writes to the kernel via its public API.

4. **Adapter classes MUST `implements`-declare their port**: `class PluginLoader implements PluginLoaderPort`, `class SqliteStorageAdapter implements StoragePort`. Drift between port shape and concrete adapter becomes a TS compile error, not a hand-audit.

5. **The CLI consumes adapters via factory functions**, not `new` constructors. The factory returns the port type (the abstract contract), not the concrete class:
   - `createPluginLoader(opts): PluginLoaderPort` exported from `src/kernel/adapters/plugin-loader.ts`.
   - **Tests are the exception**: they construct the concrete class directly (`new PluginLoader(...)`) when they need to assert against implementation internals (timeouts, schema compilation, private state).
   - **Zero-options adapters are exempt**: when an adapter has no constructor arguments and no configuration knobs (today only `InMemoryProgressEmitter`), it MAY be instantiated with `new` directly from CLI / kernel call sites. A factory adds no behavioral value when the constructor takes no inputs. The moment such an adapter grows even one option, it MUST switch to a `create*` factory before that option lands, every CLI / kernel caller updates in the same change.

6. **CLI commands MUST receive their `stdin` / `stdout` / `stderr` from the Clipanion `this.context`**, not Node globals. Helpers that need streams take them as a parameter (`confirm(question, { stdin, stderr })`, etc.). This keeps every command testable with captured streams instead of monkey-patched `process.*`.

## Layer direction

There is a third source layer between the kernel and its drivers: **`src/core/`**, the **kernel-side runtime layer** (paths, sqlite wrappers, plugin runtime, scan runner, watcher runtime, layered-config helpers). It is consumed by BOTH `src/cli/` and `src/server/`. The dependency direction is strict and one-way:

```
kernel/  ◄── core/  ◄── cli/  ,  server/
(innermost)  (runtime)   (drivers)
```

- **`core/` imports `kernel/`**, never the reverse. The kernel is the innermost layer: it must not reach UP into `core/`. Enforced structurally by `no-restricted-imports` in `src/eslint.config.js` (the `kernel/**` block bans both `cli/` and `core/`; the `core/**` block bans `cli/`). Note the ban targets the sibling `src/core/` runtime layer, NOT `src/plugins/core/` (the built-in implementations the kernel legitimately registers).
- When a kernel file appears to need something from `core/`, the fix is one of two shapes, both used in the codebase:
  1. **Move the shared leaf DOWN into the kernel** when it is pure (no config read, no `core/` deps): e.g. `kernel/util/atomic-write.ts`, `kernel/update-check/`, `kernel/adapters/sqlite/schema-fingerprint.ts`, the `SKILL_MAP_DIR` literal in `kernel/util/skill-map-paths.ts` (re-exported by `core/paths/db-path.ts`), the filesystem provider detector in `kernel/scan/detect-providers.ts` (composed with a config read by `core/config/active-provider.ts`).
  2. **Inject it** when it genuinely reads layered config (which lives in `core/`): e.g. the sidecar write-consent gate is injected into `FilesystemSidecarStore` at construction (`TSidecarConsentGate`), wired to `core/config/sidecar-consent.ts:ensureSidecarWritesAllowed` by the CLI verb / BFF route.

## Source layout: built-ins vs extension contracts

Two directories with similar-sounding names; tell them apart by purpose:

- **`src/kernel/extensions/`**, the **contracts**: one file per extension kind (`provider.ts`, `extractor.ts`, `analyzer.ts`, `action.ts`, `formatter.ts`, `hook.ts`) plus a shared `base.ts` (`IExtensionBase`). Each kind file exports its main contract (`IProvider`, `IExtractor`, `IAnalyzer`, `IAction`, `IFormatter`, `IHook`) alongside the associated context / payload shapes that live next to it (`IRawNode` and `IProviderKind` in `provider.ts`; `IExtractorContext` / `IExtractorCallbacks` in `extractor.ts`; `IAnalyzerContext` in `analyzer.ts`; `IActionPrecondition` in `action.ts`; `IFormatterContext` in `formatter.ts`; `IHookContext` / `THookTrigger` / `THookFilter` in `hook.ts`). Defines the shape any extension author (built-in or user plugin) must implement. Pure types + small helpers; no runtime data.
- **`src/plugins/`**, the **bundled implementations**, laid out as `src/plugins/<pluginId>/<kind>s/<name>/` (e.g. `plugins/claude/providers/`, `plugins/core/analyzers/`, `plugins/core/extractors/`, `plugins/core/parsers/`, `plugins/core/actions/`, `plugins/core/hooks/`, `plugins/core/formatters/`, plus the `codex` / `agent-skills` / `antigravity` Providers). Every one of these `implements` a contract from `kernel/extensions/`. The generated registry that wires them is `src/plugins/built-ins.ts` (emitted by `scripts/generate-built-ins.js`; do not hand-edit). Built-in strings are co-located per extension as `*.texts.ts` files in the same folder.

Mnemonic: "kernel/extensions = what shape; plugins = what code." When wiring from the CLI: import the **runtime instance** from `plugins/built-ins.ts`; import the **type** from `kernel/extensions/<kind>.ts`.

**AI-extension naming pattern (user decision 2026-07-18).** Probabilistic (`mode: 'probabilistic'`) built-ins are named **`ai-<subject>-<kind>`**: a finder Analyzer ends in `-analyzer` (`ai-redundancy-analyzer`, `ai-contradiction-analyzer`, `ai-incoherence-analyzer`), a fixer or summarizer Action ends in `-action` (`ai-summarizer-action`, `ai-redundancy-action`, `ai-contradiction-action`, `ai-incoherence-action`). The `ai-` prefix marks the AI family and the `-<kind>` suffix carries the kind in the id, so the UI derives a bare label by stripping both (`shortExtensionLabel` in `ui/src/models/extension-label.ts`; `ai-redundancy-analyzer` reads as `redundancy`). A **fixer is named after the finder it serves** (`precondition.analyzerIds`), so `ai-<subject>-action` pairs with `ai-<subject>-analyzer` (`ai-redundancy-action` fixes `ai-redundancy-analyzer`) and the pair collapses to one subject label on the inspector's two-state button; a probabilistic Action WITHOUT `analyzerIds` (the summarizer) names its own subject. A fixer whose `analyzerIds` reference a DETERMINISTIC analyzer (`ai-reference-action` → `core/reference-broken`) is EXEMPT from the pairing convention (it consumes a deterministic Rule, not an `ai-*-analyzer` partner, so it is named after what it fixes and the pairing guard skips it via a mode lookup). Deterministic built-ins keep plain `<subject>` ids (`node-stability`, `node-bump`, `name-collision`). Because the folder name already ends in the kind, `scripts/generate-built-ins.js` `exportNameFor` skips the doubled suffix, so `ai-redundancy-analyzer` exports `aiRedundancyAnalyzer`. The pattern AND the fixer/finder pairing are enforced by guard tests in `src/plugins/__tests__/built-ins-modes.spec.ts`; every new probabilistic built-in MUST follow them.

## i18n strategy: where strings live

User-facing text in the **CLI** uses the `tx(*_TEXTS.*)` system end-to-end:

- Every `cli/commands/<verb>.ts` that emits text to `stdout` / `stderr` MUST source its strings from a sibling `cli/i18n/<verb>.texts.ts` file via `tx(*_TEXTS.<key>, { vars })`.
- Hardcoded inline strings (e.g. `this.context.stdout.write('No issues.\n')`) are forbidden in command files. The pattern goes through `tx(<VERB>_TEXTS.noIssues)`.
- Pure passthrough of an external string (`this.context.stderr.write(\`${warn}\n\`)` for a plugin warning that already came formatted from the kernel) is allowed, the warning text was already authored elsewhere.
- The kernel emits text via `kernel/i18n/<module>.texts.ts` for the same reason; mirroring the pattern keeps the future Transloco / message-format migration trivial.
- **Built-in plugins follow the same analyzer.** `Issue.message` strings emitted by `plugins/core/analyzers/*` and any user-visible text rendered by `plugins/core/formatters/*` (or `extractors/*`, when a future built-in extractor surfaces user-readable output) MUST come from a co-located `*.texts.ts` next to the extension. Issue messages persist in `scan_issues.message` and surface through `sm check` / `sm show` / `sm export`, they are user-facing exactly like CLI stdout. The catalog naming mirrors the analyzer / formatter id (`reference-broken.texts.ts`, `ascii.texts.ts`).
- **Conformance runner follows the same analyzer.** Assertion `reason` strings produced by `src/conformance/index.ts` are surfaced verbatim to stderr by `sm conformance run`, they are user-facing. Source them from `src/conformance/i18n/runner.texts.ts` via `tx(CONFORMANCE_RUNNER_TEXTS.*, { vars })`.
- **BFF (Hono server) follows the same analyzer.** Strings the server writes to `stdout` / `stderr` (boot banner, shutdown trace, missing-bundle hint) source from `src/server/i18n/server.texts.ts` (`SERVER_TEXTS`); the `sm serve` CLI verb's strings source from `src/cli/i18n/serve.texts.ts` (`SERVE_TEXTS`). HTTP response bodies (the `/api/*` JSON envelopes) are NOT user-facing in the same way, they are machine-readable contract surface and stay where they belong (`src/server/app.ts` formats them inline against the documented envelope shape).

Why this discipline today even without a real i18n framework: it keeps every user-visible string in a flat, greppable, JSON-shaped catalog, ready to drop into a translator pipeline the day a non-English locale lands. Until then, it is also the cheapest way to enforce "no copy-changes hidden inside command logic", every wording lives in one place.

## CLI verb naming

Verb **namespaces** (a verb that owns sub-verbs, `sm plugins list`, `sm jobs submit`) follow one rule: a namespace that is a **collection the operator browses** is **PLURAL**; a namespace that is a **single subsystem** is **SINGULAR**.

- **Plural** (collections): `plugins`, `actions`, `findings`, `hooks`, `jobs`, `sidecars`.
- **Singular** (single subsystem): `config`, `db`, `agent`, `conformance`.

`sm jobs` (the queue) and `sm sidecars` (the sidecar files) were renamed from the singular `sm job` / `sm sidecar` on 2026-07-16 to satisfy this rule; there is **no singular alias** (the repo's no-compat-shim posture, see [[feedback_structural_changes_protocol]]). A new sub-verb-owning namespace picks its number by this rule, never by habit. Leaf verbs (`scan`, `check`, `show`, `record`, `serve`, ...) are not namespaces and take no number rule.

**Terminology, "process" not "drain".** An agent that pulls jobs off the queue and executes them **PROCESSES** the queue: the `sm-process-jobs` skill (materialised by `sm agent install`), the "processing agent", the process protocol. "Drain" is retired for THIS sense. It survives only for unrelated server-internal senses (buffer / connection / WebSocket draining), which are NOT renamed.

## CLI output sanitization

Every CLI sink that writes to `stdout` / `stderr` MUST pass strings sourced from **persisted DB rows**, **plugin-authored values** (analyzer messages, manifest fields, extension ids, failure reasons), or **filesystem entries** (file paths, frontmatter values, dirent names) through `sanitizeForTerminal()` from `src/kernel/util/safe-text.ts` before emission. The helper strips C0 control bytes (including `\x1B`) and prevents ANSI escape injection from masquerading as terminal control sequences in the user's terminal, `\x1b[2J` clearing the screen, fake-prompt injection, cursor manipulation that hides commands ahead of an unsuspecting paste.

**Pure passthrough is forbidden** for the categories above: even fields that look "controlled" (a `analyzerId` validated by regex, a `node.kind` from a fixed enum) go through `sanitizeForTerminal` for defense in depth, schemas drift, regexes loosen, the cost of wrapping is one function call. Reference implementations: `cli/commands/{check,config,history,list,orphans,plugins,refresh,export,show,scan-compare}.ts` all sanitize at the render layer. (`config` sanitises both disk-sourced values and free-form map keys in its human-mode `get` / `list` renderers, per audit M2; its `--json` path stays raw so the machine payload round-trips.)

**Exceptions** (sanitization NOT required):

- Strings the CLI itself authored in the current process, i18n catalog values reached via `tx(*_TEXTS.*, ...)` are trusted source. The `vars` interpolated INTO the catalog are NOT trusted; sanitize them at the call site.
- Filesystem paths the CLI composed via `path.join` from trusted parts (e.g. `defaultProjectDbPath(cwd)`).
- Numeric values, booleans, and other non-string primitives.

When in doubt, sanitize. The cost is a function call; the cost of forgetting is a screen-clear or fake-prompt smuggled into the user's terminal via a hostile plugin's `Issue.message`.

Note: `stripAnsi()` is also exported from `safe-text.ts` but is the wrong tool for this analyzer, it only removes well-formed ANSI sequences, not arbitrary C0 control bytes. Use `sanitizeForTerminal` for output safety; reserve `stripAnsi` for measuring visual length or comparing styled output in tests.

## Test layout

Tests in `__tests__/` next to each module (`*.spec.ts`), mocks for deps. Cross-module integration tests (CLI E2E pipelines, BFF + WS scenarios, full scans, conformance over the spec) live in `src/__tests__/integration/`. Runner is `node --test`; no vitest, no jest.

## Extractor token semantics (`@`, `/`)

Two built-in extractors claim the universal `@` and `/` prefixes and ship LLM-aligned semantics. The rules are tighter than "any token after the sigil counts"; they mirror how Claude Code / OpenAI Codex / Antigravity / Cursor read the same syntax so the graph that skill-map builds reflects what an LLM-driven runtime would actually do with that prose. The Gemini CLI flavour that originally shaped this list was retired in 2026-05 alongside the `gemini` Provider; Antigravity reuses the same backtick-as-literal conventions through the open `.agents/skills/` standard. Full per-runtime matrix lives in [`runtime-quirks.md`](./runtime-quirks.md). Normative wording in `spec/plugin-author-guide.md` § Extractors; this annex captures the implementation contract.

- **Code-block stripping comes first.** Both extractors run their body through `stripCodeBlocks` (`src/kernel/util/strip-code-blocks.ts`) before matching. Fenced blocks (` ``` `, `~~~`) and inline backticks are blanked (preserving line + offset count for downstream position reporting), so any token inside an author-marked literal region is invisible to the regex. New extractors that match invocation-like syntax should do the same; the helper is exported from `src/kernel/util/`. The same module exports `extractCodeRegions`, the exact inverse mask (code regions survive, prose is blanked), consumed by the four sanctioned exceptions: `core/backtick-path` (relative `.md` paths FROM code regions, `points` edges) plus the three resolution-gated trigger siblings `claude/backtick-mention` (bare `@handle` mentions), `core/backtick-slash` (`/command` invocations, grammar shared with the prose slash via `kernel/util/slash-token.ts`), and `codex/backtick-dollar` (`$skill` invocations, grammar shared via `kernel/util/dollar-token.ts`): the post-walk `prune-unresolved-code-triggers` transform drops any trigger link that resolves to nothing, so npm scopes / decorators / shell paths / shell vars / at-rules never become edges or broken flags, and `core/link-self-loop` skips its warn on all-code-region self-loops (usage examples). The sibling `extractFencedRegions` (fences only) classifies a code-region match as `'code-block'` vs `'inline-code'` for the `Signal.context` provenance both consumers key on. See [`runtime-quirks.md`](./runtime-quirks.md) §5.
- **`core/at-directive` dispatches between `mentions` and `references`:**
  - Bare handle (`@team-lead`) or namespaced agent (`@my-plugin/foo-extractor`, `@skill-map:explore`) → `mentions`. Keeps the skill-map "named entity" channel intact.
  - Explicit path prefix (`@./readme.md`, `@../parent.md`, `@/abs/path.md`) or known file extension at the tail (`@docs/api/v1.md`) → `references`. Same signal Claude Code uses to inline file contents.
  - Trailing sentence punctuation is NOT captured (`@foo.` becomes `@foo`); the last char of the match is anchored to alphanumeric or `_`.
- **`core/slash-command` ignores path-like tokens.** The lookbehind still rejects mid-word slashes; on top of that, a post-match TS guard skips the token when the char immediately after the full capture is another identifier or `/` (`/Volumes/disk`, `/api/v1/items`). The guard runs in TS rather than as a regex lookahead because the engine's greedy backtracking lets `[a-z0-9_-]*` shrink to zero and defeat the lookahead.
- **Both extractors stay provider-agnostic.** `cross-provider invariance (claude / codex / agent-skills / antigravity)` in `src/plugins/core/extractors/__tests__/extractors.spec.ts` locks the invariant: for the same body, the same link set lands regardless of which provider classified the host file. The active lens (Phase 4b mudanza) only changes WHICH `precondition.provider`-gated extractors run; the `core/*` family runs everywhere by design.

When writing a new built-in extractor that consumes prose, default to the same shape: strip code regions first, key your match on context-sensitive boundaries (not just on the bare sigil), and add a cross-provider test if the extractor lives in `core/`.

## Kernel agnosticism invariants

Two hard invariants, born from the 2026-07-23 audit (user ruling: "el kernel no tiene que conocer a los plugins"):

1. **No plugin or extension identity literals inside `src/kernel/`** (comments exempt). Plugins execute dynamically; the kernel validates and forwards without knowing who exists. Knowledge that used to violate this (the hardcoded lock-list) now lives on each manifest (`locked: true`) and is projected by `src/plugins/locked-built-ins.ts` for the host layers. Enforced automatically: `src/__tests__/kernel-agnosticism.spec.ts` scans every kernel source for qualified-id string literals and fails the suite on any hit.
2. **Affordance visibility never lives in the kernel.** Whether a button / chip / surface renders is decided by (a) the owning extension's `project()` (the payload `enabled` value and whether it emits at all) and (b) the UI (the render of that state). The kernel's contribution phase is validate-and-forward only: it checks the ref was declared and the payload matches the slot schema, then persists; it never filters or gates by slot, surface, or any UI condition. Normative wording: `spec/architecture.md` §View contribution system.

