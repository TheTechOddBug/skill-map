# Tour: settings + slots (step library, `settings-*` ids)

Step bodies for two tours: option 2 (`settings-and-consent`,
runs `settings-1-project` and `settings-2-local`) and the
single shared step `settings-6-contributions` borrowed by
option 3 (`build-and-configure`). The SKILL.md orchestrator
dispatches each `settings-*` id here; `authoring-*` ids it
dispatches to `tour-authoring.md`.

## Precondition check

Same as the authoring step library: `.skill-map/` must exist in
the cwd (pre-flight step 4 of `SKILL.md` ran `sm init --no-scan`
and appended the master-tutorial's internal entries to
`.skillmapignore`, so this is the expected state). If
`.skill-map/` is missing, surface the bootstrap mismatch and
stop, do not try to re-init mid-tour.

## Step `settings-1-project` — project settings (~2 min)

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

Mark `settings-1-project: done`.

## Step `settings-2-local` — per-user overrides (~3 min)

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

Before the demo, give the tester one sentence of context about
what a `.sm` file actually is (the basic tutorial introduces it
in passing, here we anchor the concept):

> Every `.md` skill-map tracks gets a sibling `.sm` file (e.g.
> `notes/ideas.sm` next to `notes/ideas.md`) that carries **all
> of the tool's metadata about that markdown, so your `.md`
> stays clean and uncluttered**. Version, history, tags,
> annotations, anything that does not belong in the
> human-authored body lives in the `.sm`. The `.md` is content
> you write for Claude or humans, the `.sm` is bookkeeping the
> tool writes. They are ordinary source files, committed to git,
> and you'll see them often once you start using `sm bump` /
> `sm sidecar annotate` day to day.

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

Mark `settings-2-local: done`.

## Step `settings-6-contributions` — watch contributions land (~2 min)

> Last step. Let's see a contribution land in the inspector
> live. The fixture's `master-agent` declares `tools: [Read,
> Bash, Edit]`, which the `core/tools-counter` extractor picks up.

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
> the title): you should see a small chip from `tools-counter`
> showing the value `3`.
>
> That chip is a plugin contribution. It landed in the slot
> `inspector.header.badge.counter`, the renderer is `NodeCounter`
> (same one your scaffold uses), the payload was `{ value: 3 }`.

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
> slot (`inspector.header.badge.counter`). You now know the full
> path from `.md` to UI chip.

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
