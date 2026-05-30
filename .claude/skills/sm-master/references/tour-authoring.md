# Tour: plugin authoring (step library, `authoring-*` ids)

Step bodies used by the menu's option 3 (`build-and-configure`).
The SKILL.md orchestrator walks `master-state.yml.tours.build-and-configure.steps`
and dispatches each `authoring-*` id here; `settings-*` ids it
dispatches to `tour-settings.md`.

The tester writes their first plugin. We use `sm plugins create` to
scaffold an extractor that counts configurable keywords (TODO,
FIXME, etc.) per node, edit the manifest to change a setting and the
view-slot, and confirm the contribution lands in the UI.

## Precondition check

Verify that `.skill-map/` exists in the cwd (pre-flight step 4 of
the `SKILL.md` orchestrator ran `sm init --no-scan` and appended
the master-tutorial's internal entries to `.skillmapignore`, so
this is the expected state regardless of whether the tester ran
`plugins-tour` first). If `.skill-map/` is missing, the fixture
is corrupted: surface the mismatch ("the project bootstrap is
gone, re-invoke `sm-master` from an empty dir") and stop.

## Step `authoring-1-scaffold` — `sm plugins create demo-highlight` (~2 min)

**Context**: We're building `demo-highlight`: a tiny extractor
that scans each node's body for the keywords `TODO` and `FIXME`
and shows the count as a chip on the node card. The scaffolder
emits a working version of it; over the next steps we'll tweak
its setting, move the chip to a different slot, and break the
manifest on purpose to see the diagnostic catch it.

> Let's scaffold it with `sm plugins create`:

```bash
sm plugins create demo-highlight
```

Expected output:

```
Created /<cwd>/.skill-map/plugins/demo-highlight
Next:
  - Edit demo-highlight/extractors/demo-highlight-extractor/index.js (the extract() body)
  - Run sm scan to see the contribution surface
  - sm plugins slots list: browse other slots
```

**Heads up on the id**: it must be **kebab-case lowercase**, no
slashes, no uppercase. `demo-highlight` is fine, `demo/highlight`
or `Demo-Highlight` are rejected.

Mark `authoring-1-scaffold: done`.

## Step `authoring-2-anatomy` — tour the scaffold (~3 min)

Ask the tester to open the three files and walk through each one
with you. They DO NOT edit anything yet.

> Open the three files in your editor of choice:
>
> - `.skill-map/plugins/demo-highlight/plugin.json`
> - `.skill-map/plugins/demo-highlight/extractors/demo-highlight-extractor/index.js`
> - `.skill-map/plugins/demo-highlight/README.md`
>
> Take a minute to skim them. I'll narrate what each is for.

Then narrate, one file at a time:

> **`plugin.json`**: the bundle manifest
>
> The contract the CLI validates at load. It is deliberately lean,
> four keys:
>
> - `version`: starts at `0.1.0`; you bump it yourself, the CLI
>   does not touch it.
>
> - `specCompat` / `catalogCompat`: which `sm` and plugin catalog
>   version your plugin targets.
>
> - `description`: the one-liner shown in `sm plugins list`.
>
> Notice what is NOT here. There is no `id`: the bundle id is the
> folder name (`demo-highlight`). There is no `extensions` list: the
> kernel discovers each extension by walking
> `<plugin-dir>/<kind>s/<name>/index.js`. And there is no `settings`
> block: settings live per-extension, inside the extractor's
> `index.js` (you'll see them next). The folder layout IS the
> contract, that's the "structure-as-truth" idea.

> **`extractors/demo-highlight-extractor/index.js`**: the code
>
> Plain JavaScript with a default export. **Structure-as-truth**:
> the loader derives the extension `id` and its `pluginId` from the
> folder path, so the export never repeats them. It does declare its
> `kind` (`extractor`), which the loader cross-checks against the
> parent folder (`extractors/`); a mismatch is rejected at load.
>
> **What the loader reads:**
>
> - The folder layout tells the loader this is an extractor named
>   `demo-highlight-extractor` (`extractors/<id>/index.js`).
>
> - `ui`: which slots the extension emits to. The scaffold declares
>   `count`, targeting `card.footer.left` (the chip in the
>   bottom-left of every node card). The slot pins both the renderer
>   (`NodeCounter`) and the payload shape.
>
> - `settings`: the per-extension user-configurable knobs, this is
>   where the `keywords` list lives. Exposed at runtime via
>   `ctx.settings.<settingId>`.
>
> - `extract(ctx)`: the function the kernel runs per node.
>   `ctx.body` is the markdown body, `ctx.settings` carries what
>   the user set on this extension, and `ctx.emitContribution(id,
>   payload)` sends data to the slot.
>
>   Heads up: the body has `|| ['TODO', 'FIXME']` as a defensive
>   fallback in case `ctx.settings` is missing. In normal
>   operation the kernel always passes the manifest's default (or
>   the user's override), so the hardcoded list is never used,
>   the manifest is the real source of truth.

> **`README.md`**: the docs
>
> Plain documentation; the CLI does not parse it.
>
> **Why it's here:** if your plugin lands in a registry one day,
> this is what shows up.

If the tester asks where the spec lives: `spec/plugin-author-guide.md`
and `spec/view-slots.md`.

Mark `authoring-2-anatomy: done`.

## Step `authoring-3-edit-setting` — edit a setting and observe it (~3 min)

> Now we'll touch the settings. The scaffold tracks `TODO` and
> `FIXME`. Add a third keyword: `XXX`. The change goes in the
> extension manifest's `settings.keywords.default` array
> (structure-as-truth: settings live per-extension, not at the
> plugin root).

The tester edits the extension's `index.js` (per Inviolable rule
#2; configuration is a teach moment, you do NOT edit it for them):

> Open `.skill-map/plugins/demo-highlight/extractors/demo-highlight-extractor/index.js`.
> Find the `settings.keywords.default` array. Add `"XXX"` to it.
> Save.

Then have them seed the fixture with something to count. Plant one
line in `notes/ideas.md` (you `Edit` this one because it is fixture
content, not configuration). Append at the end:

```markdown
- [ ] TODO write more demos.
- [ ] FIXME the broken connector.
- [ ] XXX revisit naming.
```

Now re-scan so the extractor re-reads its settings and re-counts:

```bash
sm scan
```

The scan re-emits the contribution with the new count. To actually
see it we open the UI: `sm show` covers a node's frontmatter, links,
and issues, but not plugin contributions. Ask the tester to run `sm`
in the second terminal, open the browser, click `notes/ideas`, and
spot the chip in the **left footer** of the card (or the bottom-left
badge in the inspector). It reads `🔍 kw 3`, one match per keyword,
the icon and label come from the manifest's `ui.count`.

> Three matches. The setting flowed from the extension's `settings`
> through `ctx.settings.keywords` into the extractor, the extractor
> counted them, the kernel persisted the contribution, and the UI
> rendered it. That's the whole loop.

Mark `authoring-3-edit-setting: done`.

## Step `authoring-4-edit-slot` — change the view-slot (~2 min)

> Same contribution, different home. We'll move it from the
> footer to the top-right corner of the card.

The tester edits the extractor source:

> Open `.skill-map/plugins/demo-highlight/extractors/demo-highlight-extractor/index.js`.
> Find the `ui.count.slot` line. Change
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

Mark `authoring-4-edit-slot: done`.

## Step `authoring-5-doctor-author` — catch a manifest mistake (~2 min)

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

Mark `authoring-5-doctor-author: done`.

## Step `authoring-6-upgrade` — `sm plugins upgrade` (~2 min)

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

Mark `authoring-6-upgrade: done`.

## Tour wrap-up (fires at the end of `build-and-configure`)

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

Mark tour `build-and-configure: done` in `master-state.yml`, update
the matching harness task, return to the menu in `SKILL.md`.
