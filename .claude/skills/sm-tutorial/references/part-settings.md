# Part 5 (a): Extend skill-map - settings (step library, `settings-*` ids)

Step bodies for the settings chapters of Part 5 (config layers, the
`sm config` verbs, the active provider lens). The SKILL.md
orchestrator dispatches each `settings-*` chapter id here;
`authoring-*` ids it dispatches to `part-authoring.md`.

The `.sm` consent gate (companion files, `allowEditSmFiles`,
`sm sidecars annotate`) is covered elsewhere in this tutorial, so
these chapters do NOT repeat it; they focus on the config layer
system and the `sm config` verbs.

## Precondition check

Same as the authoring chapters: `.skill-map/` must exist in the
cwd (the `extend` part's `backstage-init` preflight ran `sm init
--no-scan` to provision it; the universal `.skillmapignore` from
pre-flight keeps the tutorial's own files out of the scan, so this
is the expected state). If
`.skill-map/` is missing, surface the bootstrap mismatch and
stop, do not try to re-init mid-chapter.

## Step `settings-1-layers` - the config layers (~3 min)

> `sm` resolves every setting through a stack of **layers**, each
> one overriding the layer below it:
>
> 1. **defaults**, baked into the CLI.
> 2. **project**, `.skill-map/settings.json`. Committed to git,
>    shared with the whole team.
> 3. **project-local**, `.skill-map/settings.local.json`.
>    Gitignored, per-checkout, never travels through the repo
>    (this is where the `.sm` consent flag from the basic tutorial
>    lives).
> 4. **override**, transient flags for a single command.
>
> There is no user or global layer: `sm` never merges anything
> from your home directory. Everything is project-scoped.

> `sm init` already created the two files. The committed one starts
> minimal:

```bash
cat .skill-map/settings.json
```

Expected on a fresh init:

```json
{
  "schemaVersion": 1
}
```

> `schemaVersion` lets the CLI migrate the shape forward without
> surprising you; the file only grows keys as you change settings.
> Now list every setting the project sees, already resolved across
> the layers:

```bash
sm config list
```

Expected: a grouped table (General, Scan, Jobs, Roots & plugins,
History, Other) with each key's resolved value. A dash means
"unset, falling back to the default". The browser Settings tab
writes into `settings.json`, so anything you change there shows up
in this list too.

Mark `settings-1-layers: done`.

## Step `settings-2-resolve` - read, resolve, and set a value (~3 min)

> Read a single setting. We'll use `scan.maxNodes`, the cap on how
> many nodes a scan walks:

```bash
sm config get scan.maxNodes
sm config show scan.maxNodes --source
```

Expected: `get` prints the value (`256`); `show --source` adds
where it came from, `256  (from defaults)`. Nothing is set yet, so
the default wins.

> Now set it in the project layer and watch the source move:

```bash
sm config set scan.maxNodes 500 --yes
sm config show scan.maxNodes --source
```

Expected: the set prints
`✓  scan.maxNodes = 500  (wrote .skill-map/settings.json)`, and
`show --source` now reads `500  (from project)`. The value climbed
a layer, `project` overrides `defaults`. Peek at the file and the
nested key is there:

```bash
cat .skill-map/settings.json
```

> Last, undo it. `sm config reset` removes the key so the default
> takes over again:

```bash
sm config reset scan.maxNodes
sm config show scan.maxNodes --source
```

Expected: `✓  Removed scan.maxNodes from .skill-map/settings.json`,
then `256  (from defaults)`, back where we started. (A made-up key
like `scan.nope` is rejected with `✕ Unknown config key`, the
catalog is closed.)

Mark `settings-2-resolve: done`.

## Step `settings-3-lens` - the active provider lens (~2 min)

(Agent: substitute `<provider>` with `tutorial.provider`, the lens
this run was scaffolded for.)

> One setting earns its own step: the **active provider lens**. A
> skill-map project reads its files through exactly **one** provider
> at a time, and that lens decides how each file is interpreted, so
> the same files can read differently depending on which lens is active.

> The lens auto-detects on the first scan from the project's layout. A
> marker folder selects its lens: `.claude/` → `claude`, `.codex/` →
> `codex`, `.agent/workflows/` → `antigravity`; a project with only
> `.agents/skills/` and no vendor marker falls back to the open-standard
> `agent-skills` lens. Scan once and check where it landed:

```bash
sm scan
sm config get activeProvider
```

Expected: the scan prints a line like `Auto-detected activeProvider
= <provider> from filesystem markers; persisted to
.skill-map/settings.json`, and `get` then reports `<provider>`. The lens
is just a key in `settings.json`, persisted like any other setting.

> The other lenses are just as real: `claude` and the open-standard
> `agent-skills` are stable; `codex` (OpenAI) and `antigravity` (Google)
> are beta but ship enabled and auto-detect their own marker. The open
> `agent-skills` lens is the default a project falls back to when no
> vendor marker is present. The idea to keep: one project reads through
> exactly one lens at a time, chosen by `activeProvider`, and it is cheap
> to change later because the graph is always rebuilt from your files,
> never the other way around.

Mark `settings-3-lens: done`.

## Reference: where each catalogue lives in the repo

Not for the tester unless they ask. Cheat sheet for the agent:

- **Slot catalogue (normative)**:
  `spec/schemas/view-slots.schema.json` (enum + payload schemas).
- **Slot catalogue (UI mirror)**: `ui/src/app/slots/slot-config.ts`
  (layout) and `ui/src/app/slots/slot-renderer-map.ts` (renderer
  binding).
- **Input-types catalogue (normative)**: `spec/input-types.md`.
- **Plugin manifest schema**:
  `spec/schemas/plugins-registry.schema.json` (`$defs/PluginManifest`).
- **Author tutorial**: `spec/plugin-author-guide.md`.
- **Slot annex for agents**: `context/view-slots.md`.
