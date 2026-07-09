# Plugin quickstart

A working `skill-map` plugin in three steps, plus the map of where each kind fits. For the full contract (manifest, the six kinds, storage, view contributions, testing) see the [Plugin author guide](./plugin-author-guide.md); the schemas under [`schemas/`](./schemas/) are the source of truth.

## Where each kind fits

A plugin is one or more of **six extension kinds**. Each plugs into one point of skill-map's lifecycle; pick the one that matches what you want to do.

```text
THE DETERMINISTIC FLOW   ( the scan: fast · reproducible · offline )
═══════════════════════════════════════════════════════════════════

  files on disk
        │
        ▼
  ┌────────────┐
  │  PROVIDER  │  decides what counts as a node, and under which lens
  └─────┬──────┘  e.g.  .claude/skills/foo/SKILL.md  →  a Claude skill
        ▼
  ┌────────────┐
  │ EXTRACTOR  │  reads one node and pulls out its references and signals
  └─────┬──────┘  e.g.  an @architect mention  →  a link to that agent
        ▼
  ┌────────────┐
  │  ANALYZER  │  looks across the whole graph and flags problems
  └─────┬──────┘  e.g.  a link to a missing file  →  an Issue
        ▼
  ┌────────────┐
  │   ACTION   │  acts on a node (still on the deterministic flow); can
  └─────┬──────┘  also run as an LLM job.  e.g.  Bump · Summarize (LLM)
        ▼
  ┌────────────┐
  │ FORMATTER  │  turns the finished graph into an output format
  └────────────┘  e.g.  the whole graph  →  an ASCII tree   ( sm graph )


  Off to the side, reacting to the whole lifecycle (never blocks it):

  ┌────────────┐
  │    HOOK    │  watches events and reacts with a side effect
  └────────────┘  e.g.  after a scan finishes  →  notify Slack
                  fires on:  boot · scan · extractor/analyzer/action · job · shutdown
```

(Same diagram as the [author guide](./plugin-author-guide.md#plugin-lifecycle-at-a-glance), copied here so the quickstart stands alone.)

## 1. Scaffold

```bash
sm plugins create extractor my-plugin
```

Writes a loader-clean plugin under `.skill-map/plugins/my-plugin/`: a `plugin.json`, a `package.json` (`{ "type": "module" }`, so Node loads the ESM stub without a warning), a `README.md`, and a working stub for the chosen kind. The first positional is the kind, the second the plugin id. (Details in [§Manifest](./plugin-author-guide.md#manifest).)

## 2. Fill the stub

Open the generated `index.js` and write your logic. An extractor emits its findings through callbacks on `ctx`:

```javascript
export default {
  version: '1.0.0',
  description: 'Link any node that mentions ROADMAP.md.',
  scope: 'body',
  extract(ctx) {
    if (ctx.body.includes('ROADMAP.md')) {
      ctx.emitLink({
        source: ctx.node.path,
        target: 'ROADMAP.md',
        kind: 'references',
        sources: ['my-plugin'],
      });
    }
  },
};
```

The method name and `ctx` shape differ per kind; each has an example in [§The six extension kinds](./plugin-author-guide.md#the-six-extension-kinds).

## 3. Load and run

```bash
sm plugins trust my-plugin   # one-time local grant: project-local plugins are
                             # discovered but NOT executed until you trust them
sm plugins list              # confirm it loaded (status should be green)
sm scan                      # run it over your project
```

Trust is a security boundary separate from enable: a fresh project-local plugin is discovered but reads `disabled` (untrusted) until you grant it, so its code never runs on a clone you have not vetted (see [§Import trust](./plugin-author-guide.md#discovery)). A non-green status after trusting? [§Diagnostics](./plugin-author-guide.md#diagnostics) lists every status and how to fix it.

## Then go deeper

Whatever you need next is one section away in the [Plugin author guide](./plugin-author-guide.md):

- [Manifest fields](./plugin-author-guide.md#manifest) and the [`specCompat` strategy](./plugin-author-guide.md#speccompat-strategy)
- [The six extension kinds](./plugin-author-guide.md#the-six-extension-kinds), in full, with an example each
- [Storage](./plugin-author-guide.md#storage): a KV bag or a dedicated table
- [View contributions](./plugin-author-guide.md#view-contributions): chips, badges, and buttons in the UI
- [Testing your plugin](./plugin-author-guide.md#testing-your-plugin) against the kernel's public types
