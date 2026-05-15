# Module: plugins-authoring

The tester writes their first plugin. We use `sm plugins create` to
scaffold an extractor that counts configurable keywords (TODO,
FIXME, etc.) per node, edit the manifest to change a setting and the
view-slot, and confirm the contribution lands in the UI.

## Precondition check

Verify that `.skill-map/` exists in the cwd (i.e. step `tour-1-init`
of the previous module has run, or `sm init` has been run on its
own). If not, run the equivalent of step 1 of `plugins-tour`
silently: tell the tester "I need to bootstrap the project first"
and ask them to run `sm init`. Once that finishes, append the
master-tutorial's internal entries (`sm-master.md`,
`master-state.yml`, `findings.md`) to the freshly created
`.skillmapignore` (silent backstage edit) BEFORE asking them to
run `sm scan`. The append must happen before the scan or the
internal files leak into the graph.

## Step `auth-1-scaffold` — `sm plugins create demo-highlight` (~2 min)

**Context**: `sm plugins create` generates a working extractor with
one setting and one view contribution. The defaults are deliberately
trivial so the tester can read the scaffold end to end in two
minutes.

> First we'll scaffold a plugin. The CLI ships a generator that
> emits a valid `plugin.json` plus a stub extension. Hand-writing
> a manifest is supported but discouraged, the generator catches
> invalid contract picks at author time, while a hand-written one
> only fails on load.

```bash
sm plugins create demo-highlight
```

Expected output:

```
Created /<cwd>/.skill-map/plugins/demo-highlight
Next:
  - Edit demo-highlight/extensions/extractor.js (the extract() body)
  - Run sm scan to see the contribution surface
  - sm plugins slots list: browse other slots
```

**Heads up on the id**: it must be **kebab-case lowercase**, no
slashes, no uppercase. `demo-highlight` is fine, `demo/highlight`
or `Demo-Highlight` are rejected.

After the command, point them at the layout:

```bash
find .skill-map/plugins/demo-highlight -type f
```

Expected:

```
.skill-map/plugins/demo-highlight/README.md
.skill-map/plugins/demo-highlight/plugin.json
.skill-map/plugins/demo-highlight/extensions/extractor.js
```

Mark `auth-1-scaffold: done`.

## Step `auth-2-anatomy` — tour the scaffold (~3 min)

Ask the tester to open the three files and walk through each one
with you. They DO NOT edit anything yet.

> Open the three files in your editor of choice:
>
> - `.skill-map/plugins/demo-highlight/plugin.json`
> - `.skill-map/plugins/demo-highlight/extensions/extractor.js`
> - `.skill-map/plugins/demo-highlight/README.md`
>
> Take a minute to skim them. I'll narrate what each is for.

Then narrate, one file at a time:

> **`plugin.json` — the manifest**. The contract the CLI validates
> at load. The important fields:
>
> - `id`: the kebab-case id you typed. Stored here so `sm plugins
>   list` can show it.
> - `version`: starts at `0.1.0`. You bump this yourself, the CLI
>   does not touch it.
> - `specCompat` / `catalogCompat`: which `sm` and which plugin
>   catalog version your plugin targets. The loader refuses to
>   load plugins built for an incompatible catalog.
> - `extensions`: the list of files that hold the actual
>   extension code. The scaffold has one: the extractor.
> - `settings`: the user-configurable knobs your extension
>   exposes. The scaffold has one called `keywords`, a
>   `string-list` with defaults `["TODO", "FIXME"]`. The
>   `string-list` type comes from the closed input-types catalog,
>   you can browse the full list with `sm plugins slots list`.

> **`extensions/extractor.js` — the code**. Plain JavaScript with
> a default export object. The fields the loader looks at:
>
> - `kind`: `extractor` (the scaffold defaults to this; you can
>   change it later if you want a different kind).
> - `viewContributions`: declares which slots the extension can
>   emit to. The scaffold declares one named `count` targeting
>   `card.footer.left` (the left chip in the bottom of every node
>   card). The slot picks both the renderer (NodeCounter) and the
>   payload shape; you cannot send a wrong shape to a slot.
> - `extract(ctx)`: the function the kernel calls for every node.
>   `ctx.body` is the node's markdown body, `ctx.settings`
>   carries whatever the user set in `plugin.json`, and
>   `ctx.emitContribution(id, payload)` sends a contribution to
>   the slot named in `viewContributions[id]`.

> **`README.md`**. Plain old documentation, the CLI does not
> parse it. It is what shows up if your plugin lands in a
> registry one day.

If the tester asks where the spec lives: `spec/plugin-author-guide.md`
and `spec/view-slots.md`.

Mark `auth-2-anatomy: done`.

## Step `auth-3-edit-setting` — edit a setting and observe it (~3 min)

> Now we'll touch the settings. The scaffold tracks `TODO` and
> `FIXME`. Add a third keyword: `XXX`. The change goes in
> `plugin.json` → `settings.keywords.default`.

The tester edits `plugin.json` in their editor (per Inviolable rule
#2; configuration is a teach moment, you do NOT edit it for them):

> Open `.skill-map/plugins/demo-highlight/plugin.json`. Find the
> `settings.keywords.default` array. Add `"XXX"` to it. Save.

Then have them seed the fixture with something to count. Plant one
line in `notes/ideas.md` (you `Edit` this one because it is fixture
content, not configuration). Append at the end:

```markdown
- [ ] TODO write more demos.
- [ ] FIXME the broken connector.
- [ ] XXX revisit naming.
```

Now re-scan and confirm the extractor picks them up:

```bash
sm scan
sm show notes/ideas.md
```

`sm show` prints the node's persisted contributions. Look for a
`count` contribution with `value: 3` (one match per keyword). The
exact JSON shape is in the body of the `show` output under a
`contributions` key.

> Three matches. The setting flowed from `plugin.json` through
> `ctx.settings.keywords` into the extractor, the extractor
> counted them, the kernel persisted the contribution, `sm show`
> reads it back. That's the whole loop.

If the tester wants to see it in the UI: ask them to run `sm` in
the second terminal, open the browser, click `notes/ideas`, and
spot the new chip in the **left footer** of the card (or the
bottom-left badge in the inspector). The chip says `🔍 kw 3` (icon
and label from the manifest's `viewContributions.count`).

Mark `auth-3-edit-setting: done`.

## Step `auth-4-edit-slot` — change the view-slot (~2 min)

> Same contribution, different home. We'll move it from the
> footer to the top-right corner of the card.

The tester edits the extractor source:

> Open `.skill-map/plugins/demo-highlight/extensions/extractor.js`.
> Find the `viewContributions.count.slot` line. Change
> `'card.footer.left'` to `'card.title.right'`. Save.

Re-scan:

```bash
sm scan
```

If `sm` is still running, the watcher picks up the file change
and re-emits contributions live. If not, run the scan manually.

Refresh the UI, the chip should now appear next to the **title**
on the node card instead of the footer.

> Notice we did not write any UI code. The slot decides the
> renderer (`NodeCounter` here, same widget reused across four
> slots) and the position. You picked a position, the UI did the
> rest.

**Side trip if the tester asks**: `sm plugins slots list` shows
all 14 slots with one-line descriptions. They are the closed
catalogue, picking an unknown slot id is rejected at load.

Mark `auth-4-edit-slot: done`.

## Step `auth-5-doctor-author` — catch a manifest mistake (~2 min)

> Last lesson on the manifest. We'll break it on purpose to see
> how `doctor` reports it.

Have the tester change the slot to a value that does not exist:

> In the same file, change `'card.title.right'` to
> `'card.footer.bottom'` (made up). Save.

```bash
sm plugins doctor
```

Expected: `doctor` reports a load error or invalid manifest entry
on `demo-highlight`, pointing at the unknown slot name.

> Read the error. The CLI tells you exactly which slot id is not
> in the catalogue. This is the value of the closed catalogue,
> the loader catches the typo before any scan happens.

Restore the slot to a real value (back to `'card.footer.left'` or
`'card.title.right'`, the tester's choice) and re-run doctor:

```bash
sm plugins doctor
```

Back to clean.

Mark `auth-5-doctor-author: done`.

## Step `auth-6-upgrade` — `sm plugins upgrade` (~2 min)

> One last verb. `sm plugins upgrade` applies catalog migrations
> to plugin manifests. Today the catalog is at `1.0.0` with zero
> migrations registered, so the verb is a **no-op**. The point of
> the step is to know the verb exists and what it does.

```bash
sm plugins upgrade
sm plugins upgrade demo-highlight
```

Expected: both report no migrations to apply.

> When the catalog evolves (slot renames, deprecations, setting
> shape changes), `sm plugins upgrade` is the verb that walks
> your manifests and rewrites them to the new shape. Without
> that, every catalog change would force every plugin author to
> re-author by hand. The structure is in place so future bumps
> land smoothly.

Mark `auth-6-upgrade: done`.

## Module wrap-up

> You wrote a plugin. From here:
>
> - The manifest (`plugin.json`) is the source of truth, the
>   loader validates it.
> - Extensions are plain JS with a default export.
> - Slots pick the renderer and the payload shape, you cannot
>   misalign them.
> - `sm plugins doctor` is the diagnostic verb, run it after any
>   manifest edit.
> - `sm plugins upgrade` is the migration verb (no-op today, the
>   structure is ready for future catalog changes).
>
> Anything weird worth logging? If not, back to the menu.

Mark module `plugins-authoring: done` in `master-state.yml`, update
the matching harness task, return to the menu in `SKILL.md`.
