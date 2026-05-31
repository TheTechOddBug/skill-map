# Tour: settings + slots (step library, `settings-*` ids)

Step bodies for two tours: option 1 (`settings`, runs
`settings-1-layers`, `settings-2-resolve`, and `settings-3-lens`)
and the single shared step `settings-6-contributions` borrowed by
option 3 (`build-and-configure`). The SKILL.md orchestrator
dispatches each `settings-*` id here; `authoring-*` ids it
dispatches to `tour-authoring.md`.

The `.sm` consent gate (companion files, `allowEditSmFiles`,
`sm sidecar annotate`) is covered end to end in the basic
`sm-tutorial`, so this tour does NOT repeat it; it focuses on the
config layer system and the `sm config` verbs, which the basic
tutorial does not teach.

## Precondition check

Same as the authoring step library: `.skill-map/` must exist in
the cwd (pre-flight step 4 of `SKILL.md` ran `sm init --no-scan`
and appended the master-tutorial's internal entries to
`.skillmapignore`, so this is the expected state). If
`.skill-map/` is missing, surface the bootstrap mismatch and
stop, do not try to re-init mid-tour.

## Step `settings-1-layers` — the config layers (~3 min)

**Context**: where settings live and how `sm` resolves a value
when more than one place sets it.

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

## Step `settings-2-resolve` — read, resolve, and set a value (~3 min)

**Context**: the four config verbs (`get`, `show`, `set`, `reset`)
and how `show --source` reveals which layer won.

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

## Step `settings-3-lens` — the active provider lens (~4 min)

**Context**: the single most consequential setting, the lens that
decides which provider types the project's files. It is reversible
and never touches your `.md` files, only the scan cache.

> One setting earns its own step: the **active provider lens**. A
> skill-map project sees its filesystem through exactly **one**
> provider at a time, and that lens decides how each file is read.
> Under the `claude` lens a `.claude/agents/*.md` is an agent and
> `@`-mentions / `/`-commands become links; point the lens at
> `openai` and the same tree is read against Codex's layout instead.
> Same files, different reading.

> The lens auto-detects on the first scan from the markers in your
> project (`.claude/` → claude, `.codex/` or a root `AGENTS.md` →
> openai, `.agents/` → agent-skills). Scan once and check where it
> landed:

```bash
sm scan
sm config get activeProvider
```

Expected: the scan prints a line like `Auto-detected activeProvider
= claude from filesystem markers; persisted to
.skill-map/settings.json`, and `get` then reports `claude`. The lens
is just a key in `settings.json`, persisted like any other setting.

> Now switch it by hand and watch what happens. We'll point it at
> `openai`:

```bash
sm config set activeProvider openai
```

Expected: alongside the usual `✓  activeProvider = openai  (wrote
.skill-map/settings.json)`, the CLI warns `Lens switched. Cleared 7
scan table(s) ... Run sm scan to repopulate the graph under the new
lens`. The important part: it cleared the **scan cache only**, your
`.md` files are untouched. The graph is derived data; the source is
always your filesystem.

> Re-scan under the new lens, then put it back the way you found it:

```bash
sm scan
sm config reset activeProvider
sm scan
```

Expected: the first scan repopulates under `openai`; `reset` removes
the key (`Removed activeProvider from .skill-map/settings.json`); the
last scan auto-detects `claude` again from your `.claude/` marker.
Back where you started, nothing lost.

> That's the whole idea of the lens: one project, one active
> provider at a time, chosen by `activeProvider` and backed by the
> built-in provider plugins (`claude`, `openai`, `agent-skills`,
> `antigravity`). Switching it is cheap and reversible because the
> graph is always rebuilt from your files, never the other way
> around.

Mark `settings-3-lens: done`.

## Step `settings-6-contributions` — watch contributions land (~2 min)

> Last step. Let's watch a contribution land on a node card live.
> The fixture's `master-agent` declares `tools: [Read, Bash,
> Edit]`, which the `core/tools-counter` extractor picks up.

If the tester does not have `sm` running, ask them to launch it
in their second terminal (same drill as the basic tutorial:
`sm`, copy the link from the output, open the browser, arrange
the screen). If `sm` is still running, leave it.

```bash
sm
```

Once the UI is open, ask the tester to:

> Find the `master-agent` card in the graph. Look at its **left
> footer** (the bottom-left corner of the card): you should see a
> small wrench chip from `tools-counter` labelled `tools` showing
> the value `3`. Hover it to see the tool names.
>
> That chip is a plugin contribution. It landed in the slot
> `card.footer.left`, the renderer is `NodeCounter` (same one your
> scaffold uses), the payload was `{ value: 3 }`.

If the `demo-highlight` plugin from the earlier authoring steps
of this tour is still installed, point the tester at the
contribution it emits too:

> The `demo-highlight` you scaffolded earlier in this tour also
> shows up: its chip lands on every node that has a TODO / FIXME
> / XXX in its body. Click `notes/ideas` to find it.

Have the tester change `master-agent`'s `tools` array (add or
remove one tool), save, and watch the chip refresh.

> Same flow as the basic tutorial's live UI: edit the markdown,
> watch the UI refresh. The difference is that the value flowed
> through a plugin (`core/tools-counter`) and landed in a specific
> slot (`card.footer.left`). You now know the full path from `.md`
> to UI chip.

Have them Ctrl+C the server when done.

Mark `settings-6-contributions: done`.

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
