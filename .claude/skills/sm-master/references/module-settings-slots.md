# Module: settings-slots

The tester learns where settings live (project vs user scope, public
vs local), what knobs are available, and how the view-slot catalogue
maps to where plugin contributions appear in the UI.

## Precondition check

Same as plugins-authoring: `.skill-map/` must exist in the cwd
(i.e. `sm init` has run). If not, ask the tester to run it.

## Step `set-1-project` — project settings (~2 min)

> Every project that runs `sm init` gets a `.skill-map/`
> directory with two settings files. The first one is
> `settings.json`, this is the **public** project settings, the
> file you commit to git.

```bash
cat .skill-map/settings.json
```

Expected output on a fresh init:

```json
{
  "schemaVersion": 1
}
```

> Minimal on purpose. The CLI keeps the file lean and only adds
> keys when you change a setting. Schema version is there so the
> CLI can migrate the shape forward without surprising you.
>
> The settings UI in the browser (the `Settings` tab when `sm` is
> running) writes back into this file. Anything you change in
> there ends up here, commit it to share the choice with the
> team.

Mark `set-1-project: done`.

## Step `set-2-local` — per-user overrides (~3 min)

> The second file is `settings.local.json`, which is **gitignored
> by default**. It exists for choices that should NOT travel
> across the team:
>
> - Whether you allowed `sm` to create `.sm` companion files in
>   this project (the consent gate from the basic tutorial).
> - Personal token paths or credentials you do not want to
>   commit.
> - Local preferences that depend on your dev environment.

```bash
cat .skill-map/settings.local.json
```

Expected on a fresh init:

```json
{}
```

> Empty until something writes to it. The first thing that
> typically lands is `allowEditSmFiles: true` after you accept
> the `.sm` prompt (the consent gate is a per-user, per-project
> choice, that's why it goes here).

If the tester wants to see it in action: ask them to run
`sm sidecar annotate notes/ideas.md`, accept the `[Y/n]` prompt
with `y`, and re-check the file:

```bash
sm sidecar annotate notes/ideas.md
cat .skill-map/settings.local.json
```

Expected: now contains `{"allowEditSmFiles": true}` (plus a
`notes/ideas.sm` file landed next to the markdown).

> The choice stuck. Next time `sm` wants to write a `.sm` in this
> project, it skips the prompt because your consent is on
> record. If you delete the file or move to a different project,
> the prompt comes back.

Mark `set-2-local: done`.

## Step `set-3-user` — user scope (~2 min)

> The project scope you just saw is one of two scopes. The other
> is the **user scope**, which lives under `~/.skill-map/`. Same
> file shape, different reach: anything in there applies across
> every project on this machine.

```bash
ls -la ~/.skill-map/
cat ~/.skill-map/settings.json
```

Expected: a directory with `settings.json` (and possibly
`settings.local.json` and `backups/`). The settings file holds
user-wide preferences, typically `updateCheck.enabled`.

> Use the user scope for:
>
> - Cross-project preferences (update check, default formats).
> - User plugins that you want to be visible from any project
>   (drop them in `~/.skill-map/plugins/<id>/`, the loader
>   discovers them on every `sm` run).
>
> Resolution order: built-in defaults → user scope
> (`~/.skill-map/`) → project scope (`<cwd>/.skill-map/`). The
> last write wins on conflicts. `sm plugins doctor` surfaces
> collisions.

Mark `set-3-user: done`.

## Step `set-4-slots-list` — the slot catalogue (~3 min)

> Now to the UI side. Every plugin contribution lands in a
> **view-slot**, a named hole in the UI where the renderer
> appears. The slot catalogue is closed: you cannot invent
> new slots, you pick from the list.

```bash
sm plugins slots list
```

Expected output: 14 slots organised by location, with a one-line
description each. The shape:

```
View slots (14)
  card.title.right                 Small icon marker next to the card title.
  card.subtitle.left               Single non-negative integer in the card subtitle row.
  card.footer.left                 Counter chip in the left footer of the card.
  card.footer.right                Counter chip in the right footer of the card.
  graph.node.alert                 Corner badge decoration on the graph node.
  inspector.header.badge.counter   Counter chip in the inspector header badge cluster.
  inspector.header.badge.tag       Qualitative tag chip in the inspector header badge.
  inspector.body.panel.breakdown   Top-N labeled values rendered as a bar chart.
  inspector.body.panel.records     Tabular data (≤ 50 × 6) in the inspector body.
  inspector.body.panel.tree        Recursive label/children hierarchy.
  inspector.body.panel.key-values  Flat key/value pairs (≤ 50).
  inspector.body.panel.link-list   Clickable scope-relative paths (≤ 100).
  inspector.body.panel.markdown    Sanitized markdown text (≤ 4096 chars).
  topbar.nav.start                 Scope-wide indicator chip at the start of the topbar nav.
```

Walk the tester through the three mounting locations:

> Three families:
>
> - **`card.*`** mounts on every node card in the list and graph
>   views. Small, dense, one chip or one icon per slot.
> - **`inspector.*`** mounts when you click a node and the
>   inspector panel slides in. Bigger payloads (tables, trees,
>   key-values, markdown).
> - **`graph.node.alert`** is a corner badge on the node inside
>   the graph view, for alerts.
> - **`topbar.nav.start`** is the only scope-wide slot: it shows
>   one value computed across the whole graph, not per node.

> The slot picks **both** the renderer AND the payload shape.
> You cannot send a table payload to a counter slot, the loader
> rejects it. That's why this module's authoring step focused on
> "pick a slot, the rest follows".

Mark `set-4-slots-list: done`.

## Step `set-5-input-types` — the input-type catalogue (~2 min)

> Same idea on the settings side. When you declare a setting in
> `plugin.json`, the `type` comes from a closed catalogue of 10
> input types. The settings UI in the browser uses the type to
> decide which form control to render.

The same `sm plugins slots list` output already includes the
input-type table at the bottom:

```
Input types (10)
  string-list      Array of free-form strings.
  single-string    Single text input.
  boolean-flag     On/off toggle.
  integer          Integer with optional bounds.
  enum-pick        Pick one from a closed set.
  enum-multipick   Pick zero or more from a closed set.
  path-glob        Glob pattern (single or multiple).
  regex            ECMAScript regex pattern body.
  secret           Sensitive string (encrypted at rest).
  key-value-list   Editable mapping of strings to strings.
```

> The `string-list` your scaffold used is one of them. If you
> need a regex (e.g. for a custom analyzer that flags bodies
> matching a pattern), pick `regex`, the settings UI will give
> the user a regex-validated input. If you need a secret (e.g. an
> API token), pick `secret`, the value is encrypted at rest and
> the UI renders a masked input.

Mark `set-5-input-types: done`.

## Step `set-6-contributions` — watch contributions land (~2 min)

> Last step. Let's see a contribution land in the inspector
> live. The fixture's `master-agent` declares `tools: [Read,
> Bash, Edit]`, which the `core/tools-count` extractor picks up.

If the tester does not have `sm` running, ask them to launch it
in their second terminal (same drill as the basic tutorial:
`sm`, copy the link from the output, open the browser, arrange
the screen). If `sm` is still running, leave it.

```bash
sm
```

Once the UI is open, ask the tester to:

> Click the `master-agent` node. The inspector opens on the
> right side. Look at the **header badge cluster** (just under
> the title): you should see a small chip from `tools-count`
> showing the value `3`.
>
> That chip is a plugin contribution. It landed in the slot
> `inspector.header.badge.counter`, the renderer is `NodeCounter`
> (same one your scaffold uses), the payload was `{ value: 3 }`.

If you also ran the plugins-authoring module before this one and
the `demo-highlight` plugin is still installed, point the tester
at the contribution it emits too:

> If you wrote `demo-highlight` in the authoring module, its chip
> shows up on every node that has a TODO / FIXME / XXX in its
> body. Click `notes/ideas` to find it.

Have the tester change `master-agent`'s `tools` array (add or
remove one tool), save, and watch the chip refresh.

> Same flow as the basic tutorial's live UI: edit the markdown,
> watch the UI refresh. The difference is that the value flowed
> through a plugin (`core/tools-count`) and landed in a specific
> slot (`inspector.header.badge.counter`). You now know the full
> path from `.md` to UI chip.

Have them Ctrl+C the server when done.

Mark `set-6-contributions: done`.

## Module wrap-up

> Quick recap:
>
> - Settings have **two scopes** (project vs user) and **two
>   visibility levels** (public `settings.json` vs gitignored
>   `settings.local.json`).
> - View-slots are a **closed catalogue of 14**. Slot picks
>   renderer AND payload shape.
> - Settings input-types are a **closed catalogue of 10**, the
>   UI renders the form control per type.
> - Plugin contributions land in slots; the inspector and node
>   cards mount the slots and dispatch to the matching renderer.
>
> Anything weird worth logging? If not, back to the menu.

Mark module `settings-slots: done` in `master-state.yml`, update
the matching harness task, return to the menu in `SKILL.md`.

## Reference: where each catalogue lives in the repo

Not for the tester unless they ask. Cheat sheet for the agent:

- **Slot catalogue (normative)**:
  `spec/schemas/view-slots.schema.json` (enum + payload schemas).
- **Slot catalogue (UI mirror)**: `ui/src/app/slots/slot-config.ts`
  (layout) and `ui/src/app/slots/slot-renderer-map.ts` (renderer
  binding).
- **Input-types catalogue (normative)**: `spec/input-types.md`.
- **Plugin manifest schema**:
  `spec/schemas/plugin-manifest.schema.json`.
- **Author tutorial**: `spec/plugin-author-guide.md`.
- **Slot annex for agents**: `context/view-slots.md`.
