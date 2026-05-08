# Plugin author guide

How to ship a third-party `skill-map` plugin: directory layout, manifest fields, the six extension kinds, storage choice, version compatibility, dual-mode posture, and how to test the result with `@skill-map/testkit`.

This guide is **descriptive prose**, not the normative contract. The normative pieces live in the schemas and the architecture document — every claim here is cross-linked to its source. When the two disagree, [`architecture.md`](./architecture.md) wins.

> **Status.** Ships with spec v1.0.0. The author surface is intended to stay stable through the v1.x line; widening (new extension kind, new storage mode) is a minor bump per [`versioning.md`](./versioning.md).

---

## Quick start

```text
my-plugin/
├── plugin.json            ← manifest (required)
└── extensions/
    └── extractor.js      ← one file per declared extension
```

```jsonc
// my-plugin/plugin.json
{
  "id": "my-plugin",
  "version": "1.0.0",
  "specCompat": "^1.0.0",
  "extensions": ["./extensions/extractor.js"]
}
```

```javascript
// my-plugin/extensions/extractor.js
export default {
  id: 'my-extractor',
  kind: 'extractor',
  version: '1.0.0',
  emitsLinkKinds: ['references'],
  defaultConfidence: 'high',
  scope: 'body',
  extract(ctx) {
    // ctx.node, ctx.body, ctx.frontmatter, ctx.emitLink, ctx.enrichNode
    // Output flows through the callbacks; the method returns void.
    ctx.emitLink({
      source: ctx.node.path,
      target: 'something.md',
      kind: 'references',
      confidence: 'high',
      sources: ['my-extractor'],
    });
  },
};
```

Drop the directory under one of the discovery roots and `sm plugins list` will pick it up.

---

## Discovery

The kernel scans two roots, in this order:

1. `<project>/.skill-map/plugins/` — committed-with-the-repo plugins.
2. `~/.skill-map/plugins/` — user-level plugins available across every project.

A plugin is any direct child directory containing a `plugin.json`. Nested directories are not searched recursively. Pass `--plugin-dir <path>` to override both roots (mostly for testing).

After every change to the `plugins/` folder, run `sm plugins list` to see the load status of each. The six statuses are documented under [Diagnostics](#diagnostics) below.

### Plugin id uniqueness

The `id` declared in `plugin.json` is **globally unique** across every active discovery root. The kernel enforces this in two places:

1. **Directory name MUST equal manifest id.** A plugin lives at `<root>/<id>/plugin.json`. If `basename(<plugin-dir>) !== manifest.id`, discovery surfaces the plugin with status `invalid-manifest` and a reason naming both names. This rule eliminates same-root collisions by construction (a filesystem cannot host two siblings with the same name).
2. **Cross-root id collisions are blocked, both sides.** If two plugins from different roots (project + global, or any combination of `--plugin-dir`) declare the same `id`, **both** receive status `id-collision`. There is no precedence rule — neither plugin loads its extensions; the user resolves the conflict by renaming one and rerunning. Coherent with the spec rule that no extension is privileged.

`sm plugins list` shows the conflict; `sm plugins doctor` exits `1` whenever any `id-collision` is present.

### Qualified extension ids

Every extension is identified in the registry — and in any cross-extension reference — by its **qualified id** `<plugin-id>/<extension-id>`. The plugin's manifest `id` is therefore not just a discovery key: it doubles as the **namespace** for every extension the plugin ships.

Concrete examples for the reference impl's bundled extensions:

| Extension | Short id (in the file) | Qualified id (in the registry) |
|---|---|---|
| Claude Provider | `claude` | `claude/claude` |
| Frontmatter extractor | `frontmatter` | `claude/frontmatter` |
| Slash extractor | `slash` | `claude/slash` |
| At-directive extractor | `at-directive` | `claude/at-directive` |
| External-URL counter | `external-url-counter` | `core/external-url-counter` |
| Broken-ref rule | `broken-ref` | `core/broken-ref` |
| Trigger-collision rule | `trigger-collision` | `core/trigger-collision` |
| ASCII formatter | `ascii` | `core/ascii` |
| Validate-all rule | `validate-all` | `core/validate-all` |

Two namespaces are convention for built-ins:

- **`core/`** — kernel-internal primitives (every built-in rule including `validate-all`, the ASCII formatter, the external-URL counter extractor). Platform-agnostic.
- **`claude/`** — the Claude Code Provider bundle (the Provider plus the three extractors that decode Claude-specific syntax: frontmatter, slash, `@`-directive).

For your own plugin, the `id` you declare in `plugin.json` is the namespace for every extension the plugin contains. If your manifest declares `id: "my-plugin"` and your extension file declares `id: "foo-extractor"`, the kernel registers it as `my-plugin/foo-extractor`. You do **not** write the qualifier yourself — the loader injects it.

What this means in practice:

- **In the extension file**, declare only the short id (`id: "greet"`). Do **not** prefix it with the plugin id (`id: "my-plugin/greet"` is rejected as a kebab-case violation).
- **In the manifest's `extensions[]`**, list relative paths to extension files as before — nothing changes.
- **In `defaultRefreshAction` (Provider)** and any other cross-extension reference, use the qualified id of the target. A built-in Provider that wants the `core/summarize-agent` action references it by the qualified form; a third-party Provider that wants its own bundled action references `<my-plugin>/<my-action>`.
- **`sm plugins list` and `sm plugins show`** print qualified ids for every extension. The plugin id itself stays unqualified (it IS the namespace; nothing wraps it).
- **`sm plugins enable/disable <id>`** still operates on the **plugin id** (the namespace), not on individual extensions. Toggle the namespace and every extension under it follows.

The kernel guards against two foot-guns:

- If the extension file injects a `pluginId` field that doesn't match `plugin.json#/id`, the loader emits `invalid-manifest` with a directed reason. The composed qualifier MUST come from `plugin.json` — there is no second source of truth.
- The kebab-case pattern on the extension `id` deliberately forbids `/`. This keeps the rule "the qualifier always lives in the plugin id, never in the extension id" enforced by AJV.

For built-ins, the reference impl's `src/extensions/built-ins.ts` declares each extension's `pluginId` (`core` or `claude`) explicitly — built-ins do not have a `plugin.json`, so the bundle declaration IS the source of truth for their namespace.

### Granularity — bundle vs extension

Every plugin and every built-in bundle declares a **granularity** that controls how its extensions are toggled by `sm plugins enable / disable` and by `config_plugins` / `settings.json`. Two modes:

| Granularity | Toggle key | When to use |
|---|---|---|
| `bundle` (default) | the bundle id alone (e.g. `my-plugin`, `claude`) | The plugin's extensions form a coherent product (e.g. a Provider and the extractors that decode its native syntax). The user wants one switch. **95% of plugins.** |
| `extension` | the qualified extension id (`<bundle>/<ext-id>`, e.g. `core/superseded`, `my-plugin/orphan-skill`) | The plugin ships several orthogonal capabilities a user might reasonably want piecemeal. **Built-in `core` is the canonical example** — the spec promises every kernel built-in is removable, so each one toggles independently. |

Built-in mapping:

- **`claude`** — `granularity: 'bundle'`. `sm plugins disable claude` flips the Provider and the three Claude-specific extractors at once.
- **`core`** — `granularity: 'extension'`. `sm plugins disable core/superseded` flips just the supersession rule; the other six core extensions (the four other rules, the ASCII formatter, the external-URL counter extractor) stay live.

Per-verb behaviour:

| Command | Bundle granularity | Extension granularity |
|---|---|---|
| `sm plugins enable claude` | OK — flips the bundle. | Rejected: `'core' has granularity=extension; use sm plugins enable core/<ext-id>`. |
| `sm plugins enable claude/slash` | Rejected: `'claude' has granularity=bundle; use sm plugins enable claude`. | n/a (no bundle of granularity=bundle accepts qualified ids) |
| `sm plugins disable core` | n/a | Rejected: same directed message as the bundle row above. |
| `sm plugins disable core/superseded` | n/a | OK — persists `config_plugins['core/superseded'].enabled = 0`. |

Resolution order is the same as for plugin enabled-state: DB override (`config_plugins`) > settings.json (`#/plugins/<id>/enabled`) > installed default (`true`). For granularity=extension bundles the row key is the qualified id; for granularity=bundle bundles the row key is the bundle id. `settings.json#/plugins` keys are arbitrary strings (no AJV pattern), so both forms are accepted there too.

`sm plugins enable/disable --all` operates only on top-level bundle ids (the default-enabled set every user can see); it never expands to qualified `<bundle>/<ext>` keys. The "disable every kernel built-in at once" intent is served by `--no-built-ins` on `sm scan` and friends; `--all` is the macro on user-toggle-able units, not on every individual extension.

In your own plugin's `plugin.json`, set `granularity` only when you opt into the per-extension form:

```jsonc
{
  "id": "my-multi-tool",
  "version": "1.0.0",
  "specCompat": "^1.0.0",
  "granularity": "extension",
  "extensions": [
    "./extensions/orphan-skill-rule.js",
    "./extensions/csv-formatter.js"
  ]
}
```

The default (`'bundle'`) is the right answer for almost every plugin — keep the manifest minimal until the plugin actually ships several independent capabilities.

### Extractor `applicableKinds` — narrow the pipeline

An `Extractor` extension MAY declare an `applicableKinds` array on its manifest. When declared, the kernel runs the extractor **only** against nodes whose `kind` is in the list — the filter is fail-fast (no extractor context, no method call) so a probabilistic extractor wastes zero LLM cost (and a deterministic extractor zero CPU) on nodes it cannot meaningfully process.

| `applicableKinds` | Behaviour |
|---|---|
| Absent (`undefined`) | **Default.** The extractor runs on every kind the loaded Providers emit. |
| `['skill']` | Runs only on skill nodes. |
| `['skill', 'agent']` | Runs on skills + agents. Hooks, commands, notes are skipped. |
| `[]` | **Invalid.** AJV rejects the manifest at load time (`minItems: 1`). The absence of the field already means "every kind"; an empty array is reserved for "this is a typo". |

There is no wildcard syntax (no `'*'`) — omitting the field IS the wildcard. The pattern is intentional: a literal absence is unambiguous, a string sentinel would invite typos that silently disable the extractor.

Use case — a probabilistic tag-inferrer that only makes sense for skills:

```javascript
export default {
  id: 'tag-inferrer',
  kind: 'extractor',
  mode: 'probabilistic',
  version: '1.0.0',
  description: 'LLM-derived tag links for skill nodes.',
  emitsLinkKinds: ['references'],
  defaultConfidence: 'medium',
  scope: 'body',
  applicableKinds: ['skill'],
  async extract(ctx) {
    // Never invoked for agents, commands, hooks, or notes — the kernel
    // skipped this node before reaching us.
    const tags = await ctx.runner.invoke({ /* prompt … */ });
    for (const t of tags) {
      ctx.emitLink({
        source: ctx.node.path,
        target: t.path,
        kind: 'references',
        confidence: 'medium',
        sources: ['tag-inferrer'],
      });
    }
  },
};
```

**Unknown kinds are non-blocking.** An extractor that lists a kind no installed Provider declares (typo, missing Provider plugin) still loads with status `loaded`; `sm plugins doctor` surfaces an informational warning so the author sees the mismatch. The exit code of `doctor` is NOT promoted to 1 by this warning — the corresponding Provider may legitimately arrive later (e.g. when the user installs the matching plugin), and the load contract favours forward compatibility over rigid checks. The full set of "known kinds" is the union of every installed Provider's `defaultRefreshAction` keys.

---

## Manifest

Required fields (see [`schemas/plugins-registry.schema.json#/$defs/PluginManifest`](./schemas/plugins-registry.schema.json) for the normative shape):

| Field | Type | Notes |
|---|---|---|
| `id` | kebab-case string | Globally unique. Pattern: `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`. |
| `version` | semver | Plugin version, independent of `specCompat`. |
| `specCompat` | semver range | Spec versions this plugin is compatible with. Checked via `semver.satisfies(specVersion, this)` at load time. |
| `extensions` | string[] | Relative paths to extension files. Each file's default export is the extension's runtime instance. `minItems: 1`. |

Optional fields:

| Field | Type | Notes |
|---|---|---|
| `description` | string | One-line summary shown in `sm plugins list`. |
| `granularity` | `'bundle' \| 'extension'` | Controls how `sm plugins enable / disable` operates on this plugin. Default `'bundle'`. See [Granularity — bundle vs extension](#granularity--bundle-vs-extension). |
| `storage` | object | `{ "mode": "kv" }` or `{ "mode": "dedicated", "tables": [...], "migrations": [...] }`. Absent means the plugin does not persist state. |
| `author` | string | Free-form. |
| `license` | string | SPDX identifier. |
| `homepage` | string | URL. |
| `repository` | string | URL. |

### `specCompat` strategy

Pre-`v1.0.0` of the spec, narrow ranges are the defensive default — minor bumps **MAY** carry breaking changes per [`versioning.md`](./versioning.md). A plugin that spans minor boundaries can load successfully and crash at first use against a changed schema.

After the spec hits v1.0.0, the recommended ranges are:

- `"^1.0.0"` — most plugins. Loads against any v1.x.
- `">=1.0.0 <2.0.0"` — equivalent, more explicit.
- A pre-release pin (`"^1.0.0-beta.5"`) — only when you depend on a feature added between minors.

Authors who explicitly review each minor's changelog **MAY** widen across the next major (`"^1.0.0 || ^2.0.0"`) at their own risk.

---

## The six extension kinds

The kernel knows six categories. Four are dual-mode (deterministic or probabilistic per [`architecture.md` §Execution modes](./architecture.md)); two are deterministic-only because they sit at the system boundaries.

| Kind | Method | Receives | Returns | Mode |
|---|---|---|---|---|
| `provider` | `walk(roots, opts)` | filesystem roots | `IRawNode[]` | deterministic only |
| `extractor` | `extract(ctx)` | one node + body + frontmatter + callbacks | `void` (output via `ctx.emitLink` / `ctx.enrichNode` / `ctx.store`) | dual-mode |
| `rule` | `evaluate(ctx)` | full graph | `Issue[]` | dual-mode |
| `action` | `run(ctx)` | one or more nodes | execution record | dual-mode |
| `formatter` | `format(ctx)` | full graph | `string` | deterministic only |
| `hook` | `on(ctx)` | a curated lifecycle event payload | `void` (reactions are side effects) | dual-mode |

The runtime instance you `export default` from an extension file MUST include both the manifest fields (id, kind, version, plus kind-specific metadata) AND the runtime method. The kernel strips function-typed properties before AJV-validating the manifest shape, so `extract` / `evaluate` / etc. live alongside metadata without confusing the schema.

### Extractors

Pure single-node analysis. **Never** read another node, the graph, or the database — cross-node reasoning is for rules. Spec at [`schemas/extensions/extractor.schema.json`](./schemas/extensions/extractor.schema.json).

The runtime method is `extract(ctx) → void`. Output flows through three callbacks the kernel binds onto the context:

- **`ctx.emitLink(link)`** — append a `Link` to the kernel's `links` table. The kernel validates against the extractor's declared `emitsLinkKinds` before persistence; off-contract kinds are dropped and surface as `extension.error` events. URL-shaped targets are partitioned into `node.externalRefsCount` and never persisted.
- **`ctx.enrichNode(partial)`** — merge canonical, kernel-curated properties onto the node's enrichment layer (persisted into `node_enrichments` per `db-schema.md`). **Strictly separate from the author-supplied frontmatter** — the latter is IMMUTABLE from any Extractor. Use the enrichment layer for facts the author did not write but the Extractor inferred (computed titles, summaries, signals from probabilistic Extractors). Probabilistic enrichments track `body_hash_at_enrichment`; when the scan loop sees a body change, those rows are flagged `stale = 1` (NOT deleted, preserving the LLM cost paid to produce them) and surface for refresh via `sm refresh <node>` or `sm refresh --stale`. Deterministic enrichments are simply overwritten via PRIMARY KEY conflict on the next re-extract through the A.9 cache and are never stale-flagged.
- **`ctx.store`** — plugin-scoped persistence. Optional, only present when your `plugin.json` declares `storage.mode`. Shape depends on the mode (`KvStore` for mode A, scoped `Database` for mode B). See [`plugin-kv-api.md`](./plugin-kv-api.md).

A probabilistic extractor additionally receives `ctx.runner` (the `RunnerPort`) for LLM dispatch.

> **Pick a syntax that doesn't collide with built-ins.** The built-in `at-directive` extractor fires on any `@token`; the built-in `slash` extractor fires on any `/token`. A new extractor that also matches one of those prefixes will likely fire on the same input, and if the two emit different `target` shapes the kernel raises a `trigger-collision` error. The example below uses a wikilink-style `[[ref:<name>]]` pattern to side-step this; reserve `@` and `/` for the built-ins.

```javascript
import { normalizeTrigger } from '@skill-map/cli';

export default {
  id: 'ref-extractor',
  kind: 'extractor',
  version: '1.0.0',
  description: 'Extracts [[ref:<name>]] tokens from the body.',
  stability: 'experimental',
  emitsLinkKinds: ['references'],
  defaultConfidence: 'medium',
  scope: 'body',
  extract(ctx) {
    for (const m of ctx.body.matchAll(/\[\[ref:([a-z0-9-]+)\]\]/gi)) {
      ctx.emitLink({
        source: ctx.node.path,
        target: m[1],
        kind: 'references',
        confidence: 'medium',
        sources: ['ref-extractor'],
        trigger: { originalTrigger: m[0], normalizedTrigger: m[0].toLowerCase() },
      });
    }
    // Optional: emit a canonical title onto the enrichment layer.
    // ctx.enrichNode({ title: 'Computed title' });
  },
};
```


### Rules

Cross-node reasoning over the merged graph. Run after every Provider and extractor has completed. Spec at [`schemas/extensions/rule.schema.json`](./schemas/extensions/rule.schema.json).

Rules are dual-mode (`deterministic` default; `probabilistic` opt-in via the manifest). Deterministic rules run synchronously inside `sm scan` / `sm check` — same CI-safe baseline as today. Probabilistic rules are dispatched as queued jobs via the kernel's `RunnerPort`; they NEVER participate in the deterministic scan-time pipeline. Until the job subsystem ships at Step 10 the dispatch is stubbed: `sm scan` always skips probabilistic rules silently, and `sm check` exposes them via the opt-in `--include-prob` flag — the verb loads the plugin runtime, finds the registered prob rules (filtered by `--rules` and `-n` if set), and emits a stderr advisory naming them. The flag default is unchanged: deterministic-only, CI-safe. The `--async` companion is reserved for the future encoding (returns job ids without waiting once jobs land); today it is a no-op the advisory simply mentions. The flag does NOT extend to `sm scan` or `sm list`.

```javascript
export default {
  id: 'orphan-skill',
  kind: 'rule',
  version: '1.0.0',
  description: 'Flags skill nodes with zero inbound links.',
  evaluate(ctx) {
    const inboundCount = new Map();
    for (const link of ctx.links) {
      inboundCount.set(link.target, (inboundCount.get(link.target) ?? 0) + 1);
    }
    return ctx.nodes
      .filter((n) => n.kind === 'skill' && (inboundCount.get(n.path) ?? 0) === 0)
      .map((n) => ({
        ruleId: 'orphan-skill',
        severity: 'info',
        message: `Skill ${n.path} has no inbound references.`,
        nodeIds: [n.path],
      }));
  },
};
```

### Formatters

Graph-to-string serializers. Invoked by `sm graph --format <name>`. Output **MUST** be byte-deterministic for the same input graph (the snapshot-test suite relies on this). Spec at [`schemas/extensions/formatter.schema.json`](./schemas/extensions/formatter.schema.json).

The manifest field `formatId` carries the identifier the user types on the command line (matching `sm graph --format <name>`); the runtime method `format(ctx)` produces the serialized output. The split is deliberate: the method reads naturally as `Formatter.format()`, and the field is the lookup key used by the kernel.

```javascript
export default {
  id: 'csv-formatter',
  kind: 'formatter',
  version: '1.0.0',
  formatId: 'csv',
  contentType: 'text/csv',
  format(ctx) {
    const rows = ['source,target,kind,confidence'];
    for (const link of ctx.links) {
      rows.push([link.source, link.target, link.kind, link.confidence].join(','));
    }
    return rows.join('\n');
  },
};
```

### Hooks

Declarative subscribers to a curated set of kernel lifecycle events. Use case: notification (Slack on `job.completed`), integration glue (CI webhook on `job.failed`), and bookkeeping (per-extractor metrics). Spec at [`schemas/extensions/hook.schema.json`](./schemas/extensions/hook.schema.json) and the trigger semantics at [`architecture.md` §Hook · curated trigger set](./architecture.md#hook--curated-trigger-set).

The runtime method is `on(ctx) → void`. The hook reacts to events; it cannot mutate the pipeline or alter outputs. Errors are caught by the kernel's dispatcher (logged as `extension.error` with `kind: 'hook-error'`) and NEVER block the main flow — a buggy hook degrades gracefully.

The eight hookable triggers (declaring any other event yields `invalid-manifest` at load time):

1. `scan.started` — pre-scan setup (one per scan).
2. `scan.completed` — post-scan reaction (one per scan).
3. `extractor.completed` — aggregated per-Extractor outputs.
4. `rule.completed` — aggregated per-Rule outputs.
5. `action.completed` — Action executed on a node.
6. `job.spawning` — pre-spawn of runner subprocess (Step 10).
7. `job.completed` — most common trigger (Step 10).
8. `job.failed` — alerts, retry triggers (Step 10).

```javascript
export default {
  id: 'slack-notifier',
  kind: 'hook',
  version: '1.0.0',
  description: 'Posts to Slack when a scan completes with issues.',
  triggers: ['scan.completed'],
  // Optional: only fire when the scan actually surfaced issues.
  // Filter keys are top-level event.data fields; values are literal matches.
  // filter: { issuesCount: 0 } — example only; this hook fires on every scan.
  async on(ctx) {
    const stats = ctx.event.data?.stats;
    if (!stats || stats.issuesCount === 0) return;
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: `skill-map scan finished with ${stats.issuesCount} issue(s) in ${stats.durationMs} ms.`,
      }),
    });
  },
};
```

> **Filter narrows fan-out, not the trigger enum.** `filter` is a runtime predicate over the event payload — it does NOT extend the hookable trigger set. Declaring `triggers: ['scan.progress']` is rejected at load time regardless of any filter, because `scan.progress` is intentionally non-hookable (per-node fan-out is too verbose for a reactive surface).

> **Mode semantics.** Default `mode: 'deterministic'` runs `on(ctx)` in-process during the dispatch of the matching event, synchronously between the event's emission and the next pipeline step. `mode: 'probabilistic'` enqueues the hook as a job; until the job subsystem ships at Step 10, probabilistic hooks load but skip dispatch with a stderr advisory.

> **What hooks CANNOT do.** Hooks REACT to events; they cannot block emission, mutate the graph, alter Extractor / Rule output, or enrich nodes. For graph mutations use `extractor.enrichNode`; for graph reasoning use a Rule; for periodic background work use a probabilistic Action wrapped in a hook that submits the job. The single-responsibility split keeps the kernel's deterministic baseline stable.

### Providers / Actions

These ship later in the v1.x line as bundled built-ins; the spec already pins their manifest shapes. Until the testkit grows full helpers for them (planned alongside Step 10), authors are encouraged to test them with a live kernel via `sm scan` against a fixture directory rather than in unit tests.

#### Provider — `kinds` catalog and `explorationDir`

Every Provider declares two required top-level fields beyond the manifest base: `kinds` and `explorationDir`.

**`kinds` catalog.** Maps each kind the Provider emits to its frontmatter schema, its qualified `defaultRefreshAction`, and its `ui` presentation block. The kernel derives the supported kind set from `Object.keys(kinds)`. Each entry has three required fields:

- **`schema`** — path (relative to the Provider package) to the kind's frontmatter JSON Schema. MUST extend [`schemas/frontmatter/base.schema.json`](./schemas/frontmatter/base.schema.json) via `allOf` + `$ref` to base's `$id`.
- **`defaultRefreshAction`** — qualified action id (`<plugin-id>/<action-id>`) the UI's `🧠 prob` button dispatches. The action MUST exist in the registry; a dangling reference disables the Provider with `invalid-manifest`.
- **`ui`** — presentation block: `{ label, color, colorDark?, emoji?, icon? }`. The UI ships every `ui` block to the front-end via the `kindRegistry` envelope so built-in and user-plugin kinds render identically. `icon` is a discriminated union (`{ kind: 'pi'; id }` for PrimeIcons, `{ kind: 'svg'; path }` for raw SVG). The `ui` block is required (not optional) so the UI never has to invent visuals for unknown kinds. See [`architecture.md` §Provider · `ui` presentation](./architecture.md#provider--ui-presentation) for the field-by-field contract.

**`explorationDir`.** Filesystem directory the kernel walks at boot/scan time to discover candidate files. `sm doctor` checks the resolved path exists and emits a non-blocking warning when it does not — the user may legitimately install the matching platform later. Bare `~` and `~/...` resolve against the current user's home (shell convention); relative paths fall back to the cwd.

```jsonc
{
  "id": "cursor",
  "kind": "provider",
  "version": "1.0.0",
  "explorationDir": "~/.cursor",
  "kinds": {
    "skill": {
      "schema": "./schemas/skill.schema.json",
      "defaultRefreshAction": "cursor/summarize-skill",
      "ui": {
        "label": "Skill",
        "color": "#7c3aed",
        "colorDark": "#a78bfa",
        "icon": { "kind": "pi", "id": "pi-bolt" }
      }
    },
    "command": {
      "schema": "./schemas/command.schema.json",
      "defaultRefreshAction": "cursor/summarize-command",
      "ui": {
        "label": "Command",
        "color": "#0ea5e9",
        "icon": { "kind": "svg", "path": "M3 6h18M3 12h18M3 18h18" }
      }
    }
  }
}
```

---

## Frontmatter validation — three-tier model

The kernel validates frontmatter on a graduated dial; tighter is opt-in. The model is normative — every conforming implementation MUST honour the three tiers — but the policy lives in **rules**, not the JSON Schemas. The schemas stay shape-only ([`schemas/frontmatter/base.schema.json`](./schemas/frontmatter/base.schema.json) declares `additionalProperties: true` deliberately) so that authors can extend their own nodes without forking the spec. Per-kind frontmatter schemas live with the **Provider** that emits the kind (declared via `provider.kinds[<kind>].schema`); spec only ships the universal `base`.

| Tier | Mechanism | Behavior on unknown / non-conforming fields |
|---|---|---|
| **0 — Default permissive** | `additionalProperties: true` on `base.schema.json` and on every per-kind frontmatter schema declared by an installed Provider. | Field passes silently, persists in `node.frontmatter`, and is available to every extension (extractors, rules, actions, formatters). |
| **1 — Built-in `unknown-field` rule** | Deterministic Rule shipped with the kernel. Always active. | Emits an Issue with `severity: 'warn'` for every key outside the documented catalog (base + the matched kind's schema). |
| **2 — Strict mode** | [`schemas/project-config.schema.json`](./schemas/project-config.schema.json) `scan.strict: true` (team default in `settings.json`); also via `--strict` on `sm scan`. | Promotes **all** frontmatter warnings to `severity: 'error'`. They persist in the DB; `sm check` then exits `1` on the next read. CI fails. |

> Tier 1 is normative behavior — the kernel ships the rule out-of-the-box. Disabling it is not a supported configuration; an unknown key that you want to keep is either (a) moved under `metadata.*` (the spec permits free-form keys there), or (b) carried as-is at the cost of a persistent `warn`-severity issue (informational unless you run Tier 2).

### Worked example — same node, three tiers

Starting frontmatter on a skill node:

```yaml
---
name: code-reviewer
description: Reviews diffs against repo conventions.
metadata:
  version: 1.0.0
priority: high          # ← author-defined, not in any schema
---
```

**Tier 0 (default permissive — no project config, default scan).** The field validates fine. `node.frontmatter.priority === 'high'` for any extractor / rule / action that reads the node. No issues raised by the schema itself.

**Tier 1 (always-active `unknown-field` rule).** After `sm scan`, the rule emits:

```jsonc
{
  "ruleId": "unknown-field",
  "severity": "warn",
  "message": "Unknown frontmatter field 'priority' on skill node 'code-reviewer'. Add it to a custom rule or move it under metadata.* if intentional.",
  "nodeIds": ["code-reviewer.md"]
}
```

`sm scan` exits `0` (warnings do not fail the verb). The author can either move the key under `metadata.*` — where [`schemas/frontmatter/base.schema.json`](./schemas/frontmatter/base.schema.json) already permits free-form keys, so the `unknown-field` rule does not match — or accept the persistent warning and add a Rule that consumes `priority` for whatever cross-node logic motivated the field.

**Tier 2 (strict mode).** Either `scan.strict: true` in `.skill-map/settings.json`, or `sm scan --strict` on the CLI. The same `unknown-field` warning is now persisted at `severity: 'error'`. `sm scan --strict` exits `1` when the issue is created; `sm check` (which reads from the DB) also exits `1` thereafter. CI breaks until the field is reconciled.

```jsonc
// .skill-map/settings.json
{
  "schemaVersion": 1,
  "scan": { "strict": true }
}
```

The CLI flag wins when both are set (see the `--strict` description on `sm scan`); the flag is the per-invocation override, the config field is the team default.

### Why no "schema-extender" plugin kind

A reasonable next thought is: "I want my plugin to widen the frontmatter schema so my custom keys are first-class." The spec deliberately rejects that route. The accepted path is to write a deterministic **Rule** that:

1. Reads the candidate keys from `node.frontmatter` (which Tier 0 already exposes).
2. Validates them against whatever shape your domain expects (regex, enum, cross-node consistency).
3. Emits Issues for violations.

The trade-off is intentional: a "schema-extender" kind would force every consumer (the kernel, the storage layer, every other plugin, the UI) to re-resolve the active schema set per scan. A Rule-driven approach keeps the kernel's parser one-pass and the validation surface composable — the union of every author's rules is the project's policy.

If the rule needs to be CI-blocking, the rule itself emits the Issue at `severity: 'error'`. `--strict` / `scan.strict` apply only to the kernel's own frontmatter-shape and `unknown-field` warnings; plugin-authored rules pick their own severity directly.

---

## Storage

A plugin that needs to persist state declares `storage` in its manifest. Two modes; each is documented in full at [`plugin-kv-api.md`](./plugin-kv-api.md).

### Mode A — KV

```jsonc
{ "storage": { "mode": "kv" } }
```

Backed by the kernel-owned `state_plugin_kvs` table. The plugin gets `ctx.store` with `get` / `set` / `list` / `delete`. No migrations to write, ready immediately.

Pick KV when your state is a small map (less than ~1 MB total, simple key lookup or prefix list). 90 % of plugins fit.

### Mode B — Dedicated

```jsonc
{
  "storage": {
    "mode": "dedicated",
    "tables": ["plugin_my_plugin_items", "plugin_my_plugin_history"],
    "migrations": ["./migrations/001_init.sql"]
  }
}
```

The plugin owns SQL tables prefixed `plugin_<normalizedId>_*`. Migrations live under `<plugin-dir>/migrations/NNN_<name>.sql` and apply through `sm db migrate` (mixed with kernel migrations, after them).

Pick Dedicated when you need indexes, joins, or relational shape.

#### Triple protection

Every DDL or DML object a plugin migration creates / alters / drops MUST live in the `plugin_<normalizedId>_*` namespace. The kernel enforces this in three places:

1. **Discovery (Layer 1)**: every pending migration file is parsed and validated before any of them run. A bad file aborts the whole batch with no DB writes.
2. **Apply (Layer 2)**: the same validator re-runs immediately before `db.exec(sql)`, defending against TOCTOU edits between discovery and apply.
3. **Catalog assertion (Layer 3)**: `sqlite_master` is swept after each plugin's batch commits; any new object outside the prefix is reported as an intrusion (exit 2).

Forbidden in plugin migrations: `BEGIN` / `COMMIT` / `ROLLBACK` / `SAVEPOINT` / `PRAGMA` / `ATTACH` / `DETACH` / `VACUUM` / `REINDEX` / `ANALYZE`. The runner wraps each migration in its own transaction. Schema qualifiers other than `main.` are also rejected.

### `outputSchema` — opt-in correctness for custom storage writes

`emitLink` and `enrichNode` are universally validated by the kernel — every link goes through `link.schema.json` and every enrichment partial through `node.schema.json` before it persists. `ctx.store` writes are different: by default the kernel accepts any shape, because the plugin author owns the table layout and the kernel doesn't know the row shape ahead of time.

Plugin authors who want correctness for their own writes opt in by declaring JSON Schemas in the manifest. The kernel then AJV-validates each `set` / `write` call before persisting.

**Mode A (`kv`) — single value-shape schema.**

```jsonc
{
  "storage": {
    "mode": "kv",
    "schema": "./schemas/kv-value.schema.json"
  }
}
```

The kernel validates the value passed to `ctx.store.set(key, value)` against `kv-value.schema.json` on every call. The schema is single-shape — every key in the namespace stores a value of the same shape. Plugins that need heterogeneous values per key MUST switch to Mode B (or skip validation).

**Mode B (`dedicated`) — per-table schemas.**

```jsonc
{
  "storage": {
    "mode": "dedicated",
    "tables": ["items", "history"],
    "migrations": ["./migrations/001_init.sql"],
    "schemas": {
      "items": "./schemas/items-row.schema.json"
    }
  }
}
```

The kernel validates the row passed to `ctx.store.write(table, row)` against the schema declared for that table. Tables present in `tables` but absent from `schemas` (here, `history`) accept any shape — the map is sparse on purpose, so authors can validate the columns they care about without writing schemas for cache / log tables.

**Failure modes.**

- A schema file missing on disk OR unparseable as JSON OR rejected by AJV's compiler at load time → the plugin's status flips to `load-error` and its extensions are NOT registered. The diagnostic names the offending plugin, table (Mode B), and schema path.
- A `set` / `write` call whose value violates the declared schema → the kernel throws synchronously from inside the wrapper. The throw message names the plugin id, the schema path, and the AJV errors.

**When to use.** Opt in for tables / KV namespaces whose shape is part of the plugin's contract with downstream consumers (e.g. another extension that joins on the row, the UI inspector that renders the value). Skip for tables with free-form payloads (cache rows, observability counters) where validation is friction with no payoff.

`emitLink` and `enrichNode` keep their universal validation regardless of the `outputSchema` opt-in — those go through the kernel's own `link.schema.json` / `node.schema.json` validators, not the per-plugin map.

---

## Execution modes

Extractor / Rule / Action declare `mode` in the manifest with default `deterministic`. Provider / Formatter must NOT declare `mode`.

```jsonc
// deterministic extractor — default, runs in sm scan
{ "kind": "extractor", "id": "my-extractor", "mode": "deterministic", ... }
```

```jsonc
// probabilistic action — runs only as a queued job, dispatched via `sm job submit action:my-action`
{ "kind": "action", "id": "my-action", "mode": "probabilistic", ... }
```

A `probabilistic` extension receives `ctx.runner` (a `RunnerPort`) and dispatches its work to the configured LLM runner (CLI, Skill Agent, or in-process per [`architecture.md`](./architecture.md)). It MUST NOT register scan-time hooks; the kernel rejects probabilistic extensions that do.

The full per-kind capability matrix lives in [`architecture.md` §Execution modes](./architecture.md).

---

## Testing with `@skill-map/testkit`

```bash
npm install --save-dev @skill-map/testkit
```

The testkit ships builders, per-kind context factories, in-memory KV / runner fakes, and high-level `runExtractorOnFixture` / `runRuleOnGraph` / `runFormatterOnGraph` helpers. Most plugin tests reduce to one line per assertion.

```javascript
import { test } from 'node:test';
import { strictEqual } from 'node:assert';
import { runExtractorOnFixture, node } from '@skill-map/testkit';

import extractor from '../extensions/extractor.js';

test('emits one reference per [[ref:<name>]] token', async () => {
  const { links } = await runExtractorOnFixture(extractor, {
    body: 'Talk to [[ref:architect]] or [[ref:sre]].',
    context: { node: node({ path: 'a.md' }) },
  });
  strictEqual(links.length, 2);
  strictEqual(links[0].target, 'architect');
});
```

For rule tests, `runRuleOnGraph(rule, { context: { nodes, links } })` returns the issue array. For formatter tests, `runFormatterOnGraph(formatter, { context: { nodes, links, issues } })` returns the formatted string.

For probabilistic extensions, `makeFakeRunner()` queues canned responses and records every call:

```javascript
import { makeFakeRunner } from '@skill-map/testkit';

const runner = makeFakeRunner();
runner.queue({ text: '5 nodes summarized' });
const result = await myAction.run({ runner, ... });
strictEqual(runner.history[0].action, 'skill-summarizer');
```

Full surface in `@skill-map/testkit/index.ts`.

---

## Diagnostics

`sm plugins list` shows every discovered plugin with one of six statuses. When a plugin doesn't behave the way you expect, this is the first thing to check.

| Status | Meaning | Common cause |
|---|---|---|
| `loaded` | manifest valid, specCompat satisfied, every extension imported and validated. | — |
| `disabled` | user toggled it off via `sm plugins disable` or `settings.json#/plugins/<id>/enabled`. Manifest parsed; extensions not imported. | Intentional. |
| `incompatible-spec` | manifest parsed but `semver.satisfies` failed against the installed spec. | Plugin built against an older / newer spec. |
| `invalid-manifest` | `plugin.json` missing, unparseable, AJV-fails, OR the directory name does not equal the manifest id. | Typo, missing required field, wrong shape, mismatched directory name. |
| `load-error` | manifest passed but an extension module failed to import or its default export failed schema validation. | Missing `kind` field, wrong `kind` for the file, runtime import error. |
| `id-collision` | two plugins reachable from different roots declared the same `id`. Both collided plugins receive this status; no precedence rule applies. | Project-local plugin and a user-global plugin (or two `--plugin-dir` plugins) sharing an id. Rename one and rerun. |

`sm plugins doctor` runs the full load pass and exits 1 if any plugin is in a non-`loaded` / non-`disabled` state (so any of `incompatible-spec` / `invalid-manifest` / `load-error` / `id-collision` trips it). Wire it into CI to catch breakage early.

---

## Annotation contributions

> **Status.** Ships with spec v0.18.0 (Step 9.6.6). Plugins that want to write first-class fields into a node's co-located `.sm` sidecar declare them in their extension manifest under `annotationContributions`. The kernel validates the contributions at load time, surfaces the runtime catalog via `kernel.getRegisteredAnnotationKeys()` (consumed by the BFF / UI for autocomplete), and treats two plugins claiming the same root-exclusive key as a fatal startup error.

### Manifest shape

`annotationContributions` is an object map keyed by the annotation key the extension wants to own. Each entry declares an inline JSON Schema for the value plus two policy fields:

```js
// my-plugin/extensions/extractor.js
export default {
  id: 'my-extractor',
  kind: 'extractor',
  version: '1.0.0',
  // ...rest of the extractor manifest...
  annotationContributions: {
    lastReviewedAt: {
      schema: { type: 'string', format: 'date-time' },
      // location and ownership default to 'namespaced' / 'shared'
    },
  },
};
```

Field-by-field:

| Field        | Type                              | Default        | Meaning                                                                                              |
|--------------|-----------------------------------|----------------|------------------------------------------------------------------------------------------------------|
| `schema`     | inline JSON Schema (object)       | required       | Validates the value the extension writes under this key. Compiled with AJV at load time.            |
| `location`   | `'namespaced'` \| `'root'`        | `'namespaced'` | Where the key lands inside the sidecar (see below).                                                  |
| `ownership`  | `'shared'` \| `'exclusive'`       | `'shared'`     | Conflict policy. REQUIRED to be `'exclusive'` when `location: 'root'`.                              |

The `schema` field is **inline** — an object literal in the manifest, not a `$ref` to a file. Aligns with how the extractor / rule / action schemas already declare other inline shapes; avoids an extra path-resolution step at load time.

### Namespacing default vs root opt-in

By default a contribution lands inside the plugin's `<plugin-id>:` block at the sidecar root. Two plugins can ship a contribution with the same key and never collide because the runtime path keeps them under separate namespaces:

```yaml
# .claude/agents/architect.sm
for:
  path: .claude/agents/architect.md
  bodyHash: ...
  frontmatterHash: ...
annotations:
  version: 3

# Plugin 'reviewer' contributes 'lastReviewedAt'
reviewer:
  lastReviewedAt: 2026-05-06T10:00:00Z

# Plugin 'auditor' also contributes 'lastReviewedAt' — different namespace, no conflict
auditor:
  lastReviewedAt: 2026-05-05T18:30:00Z
```

Opting into a top-level (root) key requires `location: 'root'` AND `ownership: 'exclusive'`. The pair travels together — a top-level reserved key cannot be silently shared between plugins, because `.sm` writes deep-merge per the `SidecarStore` contract and a shared root key would route non-deterministically. Use root sparingly: for every plugin that contributes a root key, the kernel reserves that name across the whole installed-plugin surface.

```js
// compliance-plugin/extensions/rule.js
export default {
  id: 'compliance-checker',
  kind: 'rule',
  // ...
  annotationContributions: {
    compliance: {
      schema: {
        type: 'object',
        required: ['audit'],
        properties: {
          audit: { type: 'string' },
          dueAt: { type: 'string', format: 'date-time' },
        },
      },
      location: 'root',
      ownership: 'exclusive',
    },
  },
};
```

The resulting sidecar block:

```yaml
# .claude/agents/architect.sm
for: { path: ..., bodyHash: ..., frontmatterHash: ... }
compliance:
  audit: sox-2026
  dueAt: 2026-12-31T23:59:59Z
```

### Ownership rules

- `shared` (default) — multiple plugins MAY write the same key. Every plugin gets its own namespaced block; `last-write-wins` is per-`(plugin, key)` tuple inside `FilesystemSidecarStore.applyPatch`. Two plugins on the SAME namespaced key from the same plugin id is structurally impossible (one extension per kind per plugin id by spec), so the only collision surface is intra-extension.
- `exclusive` — only this plugin may write the key. The kernel rejects any other plugin that tries to claim the same `(key, location: 'root')` tuple as `exclusive`. `exclusive` + `namespaced` is permitted but redundant in practice (the namespace already isolates by plugin id); use it as documentation when you want the manifest to scream "no other plugin should ever write this".

### Collision behaviour — hard fail, no boot

Two plugins claiming the same `(key, location: 'root', ownership: 'exclusive')` tuple is a **fatal startup error**. The kernel does NOT boot in this state — `loadPluginRuntime` throws `AnnotationContributionConflictError` and the host (CLI verb, BFF, watch mode) propagates the error and exits non-zero with a clear stderr message naming both offenders. Stricter than the default per-plugin `invalid-manifest` "disable just that plugin" path: annotation-namespace conflicts are non-recoverable because annotated `.sm` files would otherwise become non-deterministically routed.

This is the only fatal path on the plugin-load surface. Every other failure mode (manifest invalid, schema invalid, dynamic-import failure, id collision) is per-plugin and the kernel keeps booting on the survivors.

### Tier-1 typo guard (`core/unknown-field`)

The built-in `core/unknown-field` Rule walks every parsed `.sm` and emits a `warn` issue per truly-unknown key. Three surfaces are checked:

1. Inside `annotations:` — keys not in `annotations.schema.json`'s curated catalog (the ~25 conventional fields). Plugins do NOT contribute to `annotations:`; that block is skill-map-curated.
2. At the sidecar root — keys outside the four reserved blocks (`for`, `annotations`, `settings`, `audit`) that are also NOT a registered plugin namespace `<plugin-id>:` AND NOT a registered `location: 'root'` contribution.
3. Inside a registered `<plugin-id>:` namespace — values that fail the schema declared by the owning plugin's `annotationContributions[<key>].schema`.

The rule never blocks a scan; advisories surface through the standard issue channel (CLI, UI, REST). When you ship a contribution, the loader compiles your inline schema, the runtime catalog publishes it, and `core/unknown-field` automatically validates user writes against your declaration.

### Runtime catalog accessor

Once every plugin has loaded, the runtime catalog is reachable via `kernel.getRegisteredAnnotationKeys()`:

```ts
// Each entry: { pluginId, key, location, ownership, schema }
const keys = kernel.getRegisteredAnnotationKeys();
```

Pure read; no side effects. Built-in catalog fields from `annotations.schema.json` are NOT included — this catalog is plugin-only. The UI knows the built-in catalog separately via the schema bundle. The (future) BFF endpoint surfaces this through `GET /api/annotations/catalog` for autocomplete.

---

## View contributions

> **Status.** Sibling system to annotation contributions, designed to let plugins surface per-node data in the UI without shipping any UI code. Plugin authors pick a **contract** by name from a closed kernel catalog, declare per-node emissions in their extension manifest, and emit payloads at scan time via `ctx.emitContribution(id, payload)`. The UI maps contracts to slots and renders. See [`architecture.md`](./architecture.md) §View contribution system for the normative contract.

### What it solves

Today, the only way a plugin can surface UI is implicit: extractors emit `Link` (rendered by the kernel-built `linked-nodes-panel`), rules emit `Issue` (rendered by the kernel-built issues panel), providers ship `kinds[*].ui` styling, and one-off plugins write into the sidecar via `annotationContributions`. The moment your extractor wants to surface anything else — a counter on each card, a stat breakdown panel in the inspector, a tree showing parsed structure, a per-node tag — there is no path. View contributions fill that gap. You declare what to surface; the UI decides where and how.

### What you NEVER write

- HTML, CSS, JavaScript, or Angular components.
- JSON Schema for your contributions or your settings.
- The slot id where your contribution appears (slots are UI-only).
- The renderer component that draws your contribution.

You DO write:

- The `contract` name (one of 10 closed-catalog values).
- Optional `label`, `tooltip`, `icon`, `emptyText`, `emitWhenEmpty` per contribution.
- The per-node payload your `extract(ctx)` emits via `ctx.emitContribution(...)`.

### Manifest shape

Inside any extension manifest (`IExtractor`, `IRule`, ...), declare a `viewContributions` map next to `annotationContributions`. Each key is your local contribution id; the value picks a contract.

```jsonc
{
  "id": "keyword-finder",
  "kind": "extractor",
  "viewContributions": {
    "breakdown": {
      "contract": "per-node-breakdown",
      "label": "Keyword hits",
      "emptyText": "No matches."
    },
    "total": {
      "contract": "per-node-counter",
      "icon": "🔍",
      "label": "kw",
      "emitWhenEmpty": false
    }
  }
}
```

Field reference (full schema in [`schemas/view-contracts.schema.json`](./schemas/view-contracts.schema.json) at `$defs/IViewContribution`):

| Field | Required | Notes |
|---|---|---|
| `contract` | yes | One of the 10 catalog names (see below). Unknown name → `invalid-manifest` at load. |
| `label` | no | Short human-readable label. English-only per [`AGENTS.md`](../AGENTS.md) (`Externalized texts, not internationalized`). |
| `tooltip` | no | Hover tooltip on the chip / panel header. |
| `icon` | no | Single string. If matches Unicode `\p{Extended_Pictographic}` → emoji. Otherwise → PrimeIcons name (no `pi-` prefix). |
| `emptyText` | no | Text shown when payload is empty AND `emitWhenEmpty: true`. |
| `emitWhenEmpty` | no, default `false` | When `false`, kernel drops empty payloads silently so the slot stays clean. |

### Contract catalog (closed)

The kernel ships exactly these 10 contracts. Each has a fixed payload shape and a fixed set of UI slots it surfaces in. Adding a contract requires a spec / UI / scaffolder round-trip — discuss in [`ROADMAP.md`](../ROADMAP.md) before opening a PR.

| Contract | Payload shape | Surfaces in |
|---|---|---|
| `per-node-counter` | `{ value: integer ≥ 0, severity?, label?, tooltip? }` | card chip + inspector header badge |
| `per-node-tag` | `{ label, severity?, tooltip? }` | card chip + inspector header badge |
| `per-node-breakdown` | `{ entries: Array<{ label, value, tooltip? }> }` (≤ 20) | inspector body (chart-bar) |
| `per-node-records` | `{ columns: ≤6, rows: ≤50 }` | inspector body (table) |
| `per-node-tree` | recursive `{ label, marker?, children? }` (depth ≤ 6, total ≤ 200) | inspector body (tree) |
| `per-node-key-values` | `{ entries: Array<{ key, value, tooltip? }> }` (≤ 50) | inspector body (key-value list) |
| `per-node-link-list` | `{ entries: Array<{ path, label?, kind? }> }` (≤ 100) | inspector body (link list) |
| `per-node-summary` | `{ markdown }` (≤ 4096 chars, sanitized) | inspector body (markdown text) |
| `node-marker` | `{ icon?, severity?, count?, tooltip? }` | graph node corner badge |
| `scope-summary` | `{ value, label?, severity?, tooltip? }` | topbar indicator |

Per-contract semantics, edge cases, and exact payload schemas live in [`schemas/view-contracts.schema.json`](./schemas/view-contracts.schema.json) at `$defs/payloads/<contract>`. Read that schema before emitting.

### Emit path

Inside `extract(ctx)`, call:

```ts
ctx.emitContribution('breakdown', {
  entries: Object.entries(perKeyword).map(([label, value]) => ({ label, value })),
});

ctx.emitContribution('total', { value: total });
```

The first argument is the manifest Record key (`'breakdown'` or `'total'` above), NOT the contract name. The kernel composes the qualified id from your plugin id, extension id, and this Record key.

The kernel validates the payload against the contract's payload schema in `view-contracts.schema.json#/$defs/payloads/<contract>`. Off-contract payloads emit an `extension.error` event and drop silently — same posture as `emitLink` rejecting links not in your `emitsLinkKinds`.

For `scope-summary`, rules use `ctx.emitScopeContribution(id, payload)` (extractors do not see this method — scope-level emission lives in rule context).

### Settings

User-configurable settings live at the manifest root in `settings: Record<string, ISettingDeclaration>`. Each entry picks an `input-type` from a closed catalog. You NEVER write JSON Schema for settings.

```jsonc
{
  "id": "keyword-finder",
  "version": "1.0.0",
  "specCompat": "^0.20.0",
  "catalogCompat": "^1.0.0",
  "extensions": ["./extension.js"],
  "settings": {
    "keywords": {
      "type": "string-list",
      "label": "Keywords to track",
      "description": "Words counted across each node's body.",
      "default": ["TODO", "FIXME"],
      "min": 1
    },
    "caseSensitive": {
      "type": "boolean-flag",
      "label": "Case-sensitive matching",
      "default": false
    }
  }
}
```

The 10 input-types:

| Type | Value at runtime | Use for |
|---|---|---|
| `string-list` | `string[]` | keyword lists, ignore patterns |
| `single-string` | `string` | URLs, names, identifiers |
| `boolean-flag` | `boolean` | toggles |
| `integer` | `number` (always integer) | counts, thresholds |
| `enum-pick` | `string` | pick one from a closed set |
| `enum-multipick` | `string[]` | pick zero or more |
| `path-glob` | `string` or `string[]` | glob patterns |
| `regex` | `string` | ECMAScript regex (body, no `/` delimiters) |
| `secret` | `string` | tokens, passwords (encrypted at rest) |
| `key-value-list` | `Array<{ key, value }>` | custom maps, alias dictionaries |

Per-type parameter schema lives in [`schemas/input-types.schema.json`](./schemas/input-types.schema.json) at `$defs/Setting_<TypeName>`.

The kernel exposes resolved settings to extractors via `ctx.settings.<settingId>`. Settings are read once at extractor invocation; **changing a setting requires `sm scan` to re-emit** affected contributions. The UI surfaces a "settings changed, rescan needed" indicator.

### Catalog version

The catalog of contracts and input-types evolves on its own cadence. Declare a semver range in your manifest:

```jsonc
{ "catalogCompat": "^1.0.0" }
```

Independent of `specCompat` (the spec version range). Mismatch surfaces as `incompatible-catalog` plugin status; resolution is `sm plugins upgrade <id>`, which runs registered migrations from the kernel's closed migration registry. When auto-migration is impossible (a contract you used was removed entirely), the upgrade verb fails loud (CLI exit ≠ 0 + console message) and your manifest needs a manual edit.

`catalogCompat` is **optional**: omit it if your plugin declares no `viewContributions` and no `settings`. The doctor verb (`sm plugins doctor`) warns if such a plugin actually emits via `viewContributions` or declares `settings`.

### Worked example — `acme/keyword-finder`

Full plugin walkthrough:

```
plugins/acme-keyword-finder/
├── plugin.json           ← manifest with settings + catalogCompat
└── extensions/
    └── extractor.js       ← extract() with ctx.emitContribution
```

`plugin.json`:

```jsonc
{
  "id": "acme-keyword-finder",
  "version": "1.0.0",
  "specCompat": "^0.20.0",
  "catalogCompat": "^1.0.0",
  "extensions": ["./extensions/extractor.js"],
  "settings": {
    "keywords": {
      "type": "string-list",
      "label": "Keywords to track",
      "default": ["TODO", "FIXME"],
      "min": 1
    }
  }
}
```

`extensions/extractor.js`:

```js
export const extractor = {
  id: 'keyword-finder',
  pluginId: 'acme-keyword-finder',
  kind: 'extractor',
  version: '1.0.0',
  description: 'Counts configured keywords per node.',
  stability: 'stable',
  mode: 'deterministic',
  emitsLinkKinds: [],
  defaultConfidence: 'high',
  scope: 'body',

  viewContributions: {
    breakdown: {
      contract: 'per-node-breakdown',
      label: 'Keyword hits',
      emptyText: 'No matches.',
    },
    total: {
      contract: 'per-node-counter',
      icon: '🔍',
      label: 'kw',
      emitWhenEmpty: false,
    },
  },

  extract(ctx) {
    const keywords = ctx.settings.keywords;
    const perKeyword = Object.create(null);
    let total = 0;

    for (const kw of keywords) {
      const re = new RegExp(`\\b${escapeRegex(kw)}\\b`, 'gi');
      const n = (ctx.body.match(re) ?? []).length;
      perKeyword[kw] = n;
      total += n;
    }

    ctx.emitContribution('breakdown', {
      entries: Object.entries(perKeyword).map(([label, value]) => ({ label, value })),
    });

    if (total > 0) {
      ctx.emitContribution('total', { value: total });
    }
  },
};

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

After `sm scan`, the UI surfaces:

- A `🔍 N` chip on every node's card (when `total > 0`).
- A "Keyword hits" panel in the inspector body for every node, with a horizontal bar chart per keyword.

The plugin author wrote zero UI code, zero CSS, zero HTML, zero JSON Schema, and never typed the words "panel", "chip", "renderer", or "slot".

### Scaffolder

Hand-writing the manifest is supported but discouraged. Run:

```sh
sm plugins create
```

The scaffolder walks you through the closed catalogs (settings + view contributions) and emits a complete plugin directory with manifest, extension stub, test scaffold, and README. Hand-writing remains valid because the spec is the source of truth, but the scaffolder catches invalid contract picks at author time, while a hand-written manifest only fails at load time.

Companion verbs:

- `sm plugins doctor` — surfaces `incompatible-catalog`, `invalid-manifest`, deprecated-contract usage.
- `sm plugins upgrade <id>` — applies catalog migrations registered in the kernel.
- `sm plugins contracts list` — prints the catalog (contracts + input-types), flags deprecated entries.

### Watch out for

- **Don't pick a slot.** The plugin author never types `inspector.body`, `card.chip`, etc. Slot mapping is a UI decision; if you find yourself wanting to "place" a contribution, you're working against the model.
- **Don't write JSON Schema.** Settings use `type` from the input-type catalog; view contributions use `contract` from the contract catalog.
- **Don't mutate payloads after emission.** The kernel validates and serializes at emit time; a plugin holding a reference to the emitted payload and mutating it later has undefined behavior.
- **Don't emit HTML.** `per-node-summary` accepts markdown with a sanitized allow-list; `[innerHTML]` bindings in the renderer are lint-banned (see [`context/view-contributions.md`](../context/view-contributions.md)).
- **Don't try to read another plugin's contributions.** The BFF rejects cross-plugin reads at the route level.

---

## See also

- [`architecture.md`](./architecture.md) — extension contract, ports, execution modes.
- [`plugin-kv-api.md`](./plugin-kv-api.md) — Storage Mode A normative API.
- [`db-schema.md`](./db-schema.md) — table catalog and migration rules (Mode B).
- [`schemas/plugins-registry.schema.json`](./schemas/plugins-registry.schema.json) — normative manifest shape.
- [`schemas/extensions/*.schema.json`](./schemas/extensions) — per-kind manifest schemas.

---

## Stability

- Document status: **stable** as of spec v1.0.0. Future minor revisions add new sections (e.g. richer testkit coverage when actions gain helpers); breaking edits to the documented surface require a major bump per [`versioning.md`](./versioning.md).
- The six plugin statuses (`loaded` / `disabled` / `incompatible-spec` / `invalid-manifest` / `load-error` / `id-collision`) are stable; adding a seventh status is a minor bump.
- The structural rule **directory name MUST equal manifest id** is stable; relaxing it (allowing mismatch) is a major bump.
- The cross-root id-collision rule (both sides blocked, no precedence) is stable; introducing precedence (e.g. project root wins over global) is a major bump.
- The `granularity` field on `PluginManifest` is stable as introduced. The two values (`bundle` / `extension`) are stable. Adding a third value is a minor bump; changing the default away from `bundle` is a major bump (every existing plugin manifest would silently flip toggle semantics).
- The optional `applicableKinds` field on the Extractor manifest is stable as introduced. Adding a wildcard syntax (`'*'`) is a minor bump (additive, the existing "absent = all kinds" semantics keeps holding); changing the default away from "applies to every kind" or making the field required is a major bump. Promoting the unknown-kinds doctor warning to a hard load error is a major bump (today's contract is "load OK, surface as warning").
- The recommended `specCompat` strategy is descriptive prose; revising the recommendation does not require a spec bump as long as the schema stays unchanged.
- The example code blocks track the public TypeScript surface of `@skill-map/cli`; bumping their imports follows the cli's own semver.
