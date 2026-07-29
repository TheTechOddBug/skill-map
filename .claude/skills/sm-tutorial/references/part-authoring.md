# Part 6 (c): Extend skill-map - build plugins (step library, `authoring-*` ids)

Step bodies for the plugin-authoring chapters of Part 6.
The SKILL.md orchestrator dispatches each `authoring-*` chapter id
here; `settings-*` ids it dispatches to `part-settings.md`.

The tester writes their first plugin. We use `sm plugins create` to
scaffold an extractor that counts configurable keywords (TODO,
FIXME, etc.) per node, edit the manifest to change a setting and the
view-slot, and confirm the contribution lands in the UI.

## Precondition check

Verify that `.skill-map/` exists in the cwd (the `extend` part's
`backstage-init` preflight ran `sm init --no-scan` to provision it;
the universal `.skillmapignore` from pre-flight keeps the tutorial's
own files out of the scan, so this is the expected state regardless
of whether the tester ran the plugins chapters first). If `.skill-map/` is missing, the fixture
is corrupted: surface the mismatch ("the project bootstrap is
gone, re-invoke the tutorial from an empty dir") and stop.

## Step `authoring-1-scaffold` - `sm plugins create extractor demo-highlight` (~2 min)

> Let's scaffold it with `sm plugins create`:

```bash
sm plugins create extractor demo-highlight
```

Expected output:

```
Created /<cwd>/.skill-map/plugins/demo-highlight
Next:
  - Edit extractors/demo-highlight-extractor/index.js
  - Run sm plugins doctor to confirm it loads
  - Run sm plugins trust demo-highlight to let its code run (project-local plugins are untrusted until you allow them)
  - sm plugins slots list: browse slots and input-types
```

**Heads up on the id**: it must be **kebab-case lowercase**, no
slashes, no uppercase. `demo-highlight` is fine, `demo/highlight`
or `Demo-Highlight` are rejected.

**Trust it before it can run.** A project-local plugin you just dropped
into `.skill-map/plugins/` is discovered but its code does NOT run until
you trust it on this machine, a security gate so cloning a repo never
auto-executes its plugins behind your back. The plugin is yours (you just
wrote it), so grant trust now; the next chapters need it to run. Tell the
tester:

> One more step before your plugin can run. skill-map found it but will
> not execute its code until you **trust** it, your local consent that
> this code may run on your machine. It is yours, so trust it:

```bash
sm plugins trust demo-highlight
```

> Two separate ideas, on purpose: **enable** says "this plugin is part of
> the project" (shared, lives in the config), **trust** says "I let it run
> on this machine" (local, never travels in a commit). A scaffolded plugin
> is enabled by default, so trusting it is all it needs to run. You can
> revoke later with `sm plugins untrust demo-highlight`, or use the
> per-plugin Trust control in the Settings UI.

Mark `authoring-1-scaffold: done`.

## Step `authoring-2-anatomy` - tour the scaffold (~3 min)

Ask the tester to open the three files and walk through each one
with you. They DO NOT edit anything yet.

> Open the four files in your editor of choice:
>
> - `.skill-map/plugins/demo-highlight/plugin.json`
> - `.skill-map/plugins/demo-highlight/extractors/demo-highlight-extractor/extension.json`
> - `.skill-map/plugins/demo-highlight/extractors/demo-highlight-extractor/index.js`
> - `.skill-map/plugins/demo-highlight/README.md`
>
> Take a minute to skim them. I'll narrate what each is for.

Then narrate, one file at a time:

> **`plugin.json`**: the plugin manifest
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
> Notice what is NOT here. There is no `id`: the plugin id is the
> folder name (`demo-highlight`). There is no `extensions` list: the
> kernel discovers each extension by walking
> `<plugin-dir>/<kind>s/<name>/index.js`. And there is no `settings`
> block: settings live per-extension, inside the extractor's
> `index.js` (you'll see them next). The folder layout IS the
> contract, that's the "structure-as-truth" idea.

> **`extractors/demo-highlight-extractor/extension.json`**: who the
> extension is
>
> Two keys, `version` and `description`, plus two optional ones
> (`stability`, `defaultEnabled`) the scaffold leaves out.
>
> Why a separate file instead of putting them in the code? Because
> `sm` decides whether your extension is allowed to run **before it
> runs anything**. Whether an extension is on depends on
> `stability` / `defaultEnabled`, so if those lived in the code,
> `sm` would have to execute the file to find out whether executing
> it was allowed. Reading a JSON file is not executing anything.
>
> That is what makes a switched-off extension genuinely off: its
> code is never even imported. It also means `sm plugins list` can
> show you what a plugin you have NOT trusted yet ships, before you
> decide to trust it.

> **`extractors/demo-highlight-extractor/index.js`**: the code
>
> Plain JavaScript with a default export. **Structure-as-truth**:
> the loader derives the extension `kind` (`extractor`), its `id`,
> and its `pluginId` from the folder path, so the export never
> repeats them. Re-declaring `kind` or `id` is rejected at load as
> `invalid-manifest`, and so is re-declaring anything that belongs
> in `extension.json`.
>
> **What the loader reads:**
>
> - **folder layout**: marks this as the extractor
>   `demo-highlight-extractor`.
> - **`extension.json`**: its version and description, read before
>   any of this code runs.
> - **`ui`**: where the chip shows. The scaffold sends `count` to
>   the `card.footer.left` slot; the slot picks the renderer and
>   payload shape for you.
> - **`settings`**: the user knobs (here, the `keywords` list),
>   read at runtime via `ctx.settings`.
> - **`extract(ctx)`**: runs once per node. It reads the body from
>   `ctx.body` and emits the count via `ctx.emitContribution`.
>
> The `|| ['TODO', 'FIXME']` you see in the code is just a safety
> fallback; the real keyword list comes from the manifest.

> **`README.md`**: the docs
>
> Plain documentation; the CLI does not parse it.
>
> **Why it's here:** if your plugin lands in a registry one day,
> this is what shows up.

If the tester asks where the spec lives: `spec/plugin-author-guide.md`
and `spec/view-slots.md`.

Mark `authoring-2-anatomy: done`.

## Step `authoring-3-edit-setting` - edit a setting and observe it (~3 min)

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

Now restart `sm` so it re-reads the plugin. `sm` loads the plugin
(its settings, its slot, the contribution itself) **once, at
boot**, so a server left running from an earlier chapter froze that
view at startup and will not see the new `XXX` keyword. Stop it
with Ctrl+C and run it again (or just run it, if it is not up):

```bash
sm
```

Booting runs a fresh scan, so the extractor re-reads
`ctx.settings.keywords` (now including `XXX`) and re-counts. Open
the browser, click `notes/ideas`, and find the chip in the card's
**left footer** (it also shows in the inspector). It reads
`🔍 kw 3`, one match per keyword.

> Three matches. The setting flowed from the extension's `settings`
> through `ctx.settings.keywords` into the extractor, the extractor
> counted them, the kernel persisted the contribution, and the UI
> rendered it. That's the whole loop.

Mark `authoring-3-edit-setting: done`.

## Step `authoring-4-edit-slot` - change the view-slot (~2 min)

> Same contribution, different home. We'll move it from the left
> footer to the right footer of the card.

The tester edits the extractor source:

> Open `.skill-map/plugins/demo-highlight/extractors/demo-highlight-extractor/index.js`.
> Find the `slot` line in the `count` contribution. Change
> `'card.footer.left'` to `'card.footer.right'`. Save.

The slot is part of the plugin's definition, and `sm` reads that
**once, at boot**. The watcher re-counts content on the fly, but it
does not reload a plugin, so the slot move is not live. Restart
`sm` to pick it up (Ctrl+C, then `sm` again):

```bash
sm
```

Refresh the UI, the chip should now appear in the **right footer**
of the node card instead of the left.

> Notice we did not write any UI code. The slot decides the
> renderer and the position. You picked a position, the UI did
> the rest.

> **Two ways to see the whole slot catalogue:**
>
> - **In the UI**, add `?debug=1` to the URL. Every view-contribution
>   slot lights up with a coloured ring and its id, so you can see
>   exactly where `card.footer.left` and `card.footer.right` sit.
>   Turn it back off with `?debug=0`.
> - **In the CLI**, run `sm plugins slots list`: all 14 slots with a
>   one-line description each. The catalogue is closed, an unknown
>   slot id is rejected at load.

Mark `authoring-4-edit-slot: done`.

## Step `authoring-5-doctor-author` - catch a manifest mistake (~2 min)

> Last lesson on the manifest. We'll break it on purpose to see
> how `doctor` reports it.

Have the tester change the slot to a value that does not exist:

> In the same file, change `'card.footer.right'` to
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
`'card.footer.right'`, the tester's choice) and re-run doctor:

```bash
sm plugins doctor
```

Back to clean.

Mark `authoring-5-doctor-author: done`.

## Wrap-up (fires at the end of the authoring chapters)

> You wrote a plugin. From here:
>
> - The manifests are the source of truth, and the loader validates
>   both: `plugin.json` for the plugin, `extension.json` per
>   extension.
> - An extension is two files: `extension.json` says who it is (read
>   before anything runs, which is how "off" really means off), and
>   `index.js` is plain JS with a default export.
> - Slots pick the renderer and the payload shape, you cannot
>   misalign them.
> - `sm plugins doctor` is the diagnostic verb, run it after any
>   manifest edit.
>
> Anything weird worth logging? If not, back to the menu.

Mark the chapters done (rule #4) and return to the menu in `SKILL.md`.
