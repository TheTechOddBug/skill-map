# Part 5: The CLI in depth - step library

The deep-dive into the rest of the CLI: browsing verbs, ASCII graph + export, broken-ref issues, the `.sm` annotation consent prompt, and validating links to folders outside the scan scope. `pace: auto-advance` (walk straight into the next chapter's Announcement once one is marked done) and `preflight: seed` with the `prologue-built` snapshot: it self-seeds its own copy of the Part 0 demo fixture, so it works even if the campaign already replaced that fixture with the portfolio (see SKILL.md §Entering a part, the `cli` case). Shared conventions (tone, provider detection / substitution, the `> ` rendering rule, the per-step cycle) live in `_core.md`; do not restate them here.

## Chapter `browse` - list / show / check (~3 min)

```bash
sm list
sm list --kind skill
sm list --kind agent
sm list --kind markdown
sm show .claude/skills/demo-skill/SKILL.md
sm check
```

Expected: you see the 6 fixture nodes listed with their kind: `demo-skill` (skill), `demo-agent` (agent), `demo-command` (command), `notes/todo` (`markdown`, the catch-all per the `kinds` chapter), and the two guideline notes `notes/demo-guideline` and `notes/demo-guideline2` (both `markdown`, the hub's resolution pair: a broken `mentions` at 0.50 and a resolved `references` at 1.00). `check` reads the persisted `scan_issues` table, it does NOT re-walk the filesystem. The prologue fixture carries one deliberate broken reference (the bare `@demo-guideline` mention from the `connectors` chapter resolves to no agent), so `sm check` reports `1 error` (`reference-broken` on `notes/todo.md`), NOT `✓ No issues`. The `issues` chapter plants a SECOND broken ref and watches the rule catch it after a fresh `sm scan`.

Mark `browse`: done.

## Chapter `graph-export` - graph / export (query, formatters) (~3 min)

```bash
sm graph
sm export --format md > export.md
sm export "kind=markdown" --format json > export-markdown.json
sm export "path=notes/**" --format json > export-notes.json
ls -la export*
```

`graph` draws an ASCII tree of the whole persisted scan (no `--root` flag, graph is whole-graph today). `export` takes a positional query (`kind=…`, `path=…`, `has=issues`, comma-OR within a key, AND across keys) and a `--format` of `md` or `json`. The `path=` glob uses POSIX semantics (`*` is one segment, `**` spans segments) so `path=notes/**` cleanly captures the notes folder regardless of the catch-all kind.

Mark `graph-export`: done.

## Chapter `issues` - Issues and broken refs (--analyzers, --json) (~3 min)

`reference-broken` is one of the deterministic rules `sm check` runs. The hub already carries one broken reference from the prologue (the bare `@demo-guideline` mention that resolves to no agent); we'll plant a second, an explicit markdown link to a missing file, and watch the rule catch it too, that's the easiest way to internalise that it is an **issue** on a node, NOT a connector and NOT the same thing as an "orphan".

> ℹ️ `reference-broken` is one of ~16 built-in rules. Others surface
> different families: `core/name-reserved` (a file shadows a vendor
> built-in like `/help`), `core/link-self-loop` (a node links to itself),
> `core/reference-redundant` (two surfaces in the same body
> point at the same target), `core/extractor-collision` (two extractors
> detected the SAME byte range with different interpretations, the
> resolver picked one and the warning explains who lost and why).
> Same `sm check --analyzers <id>` pattern works for any of them.
> We will not plant fixtures for the rest, the reference-broken demo
> covers the mechanics.

Ask the tester to **append one bullet** to `notes/todo.md`:

```markdown
- [ ] Document the [flow diagram](./missing-page.md).
```

`./missing-page.md` deliberately doesn't exist. Save the file, then run `sm scan` first to refresh the snapshot before checking:

```bash
sm scan
sm check
sm check --analyzers reference-broken
sm check --json
```

Expected: `sm check` now reports **2 errors**, both `reference-broken` on `notes/todo.md`, the pre-existing `@demo-guideline` mention from the prologue plus the freshly planted `[flow diagram](./missing-page.md)` you just added (the dangling markdown link to the non-existent `missing-page.md`). The `--analyzers reference-broken` filter narrows `sm check` to a single rule (still both rows here, since both are that rule); `--json` emits the structured payload (useful for CI / scripting). When done, the tester can leave the bullet in place or delete it, the rest of the deep-dive doesn't depend on it.

Mark `issues`: done.

## Chapter `annotations` - Annotations and the .sm consent prompt (~3 min)

**Context**: skill-map keeps each tracked `.md`'s metadata (version, history, tags, annotations) in a sibling **`.sm` companion file** so the `.md` stays clean, and the first time it writes one in a project it asks for consent (remembered in the gitignored `settings.local.json`). The Maintain part walks that consent flow in full; this chapter does not re-teach it. The CLI focus here is what Maintain does not cover: the **three sidecar verbs** and the `--yes` non-interactive switch. A tester who jumped straight here gets a one-line refresher in the demo below.

Create a scaffold for `notes/todo.md` so there is a `.sm` on disk to talk about. **Reset any prior consent state first** so the prompt appears (an earlier step may have flipped the flag, in which case the verb skips straight past it):

```bash
rm -f notes/todo.sm .skill-map/settings.local.json
sm sidecar annotate notes/todo.md
```

Expected: a short explanation, then a `[Y/n]` prompt (capital Y = default Yes, just hit Enter). After accepting, `notes/todo.sm` appears with an `identity:` block plus an empty `annotations: {}`, and `.skill-map/settings.local.json` records `{ "allowEditSmFiles": true }` so it never asks again on this checkout (the choice is per-user, per-project, gitignored).

The part the CLI adds on top, the three sidecar verbs (all share that same consent gate):

- `sm sidecar annotate <node>` is the scaffold verb you just ran (creates a fresh `.sm`).
- `sm bump <node>` is the day-to-day verb: it increments the sidecar's version and refreshes its hashes.
- `sm sidecar refresh <node>` is the hash-only update (no version bump).

And for automation: a CI / non-interactive session has no one to answer the `[Y/n]`, so pass `--yes` to grant consent up front (`sm sidecar annotate <node> --yes`).

Mark `annotations`: done.

## Chapter `reference-paths` - Validate links to folders outside the scan scope (~4 min)

**Context**: until now the map saw only files inside the cwd. In real projects a repo often links to files in a sibling repo (a specs project, a sibling package in a monorepo). Skill-map only scans from its cwd downwards, so a link to `../sibling/file.md` shows up as broken. The fix is to declare the external folders in `scan.referencePaths`, which lets the `reference-broken` analyzer validate path-style links against those extra roots **without indexing their files as nodes**. The folders are checked, not walked as part of the map.

**Setup (you, silent)**: write the fixture under the tutorial cwd so both sub-projects are siblings of each other but children of the tutorial root. The agent does this with `Write`, no confirmation beat needed, the tester learns about the files in the next message.

```
link-validation/
├── hijoA/
│   └── note-with-external-link.md   ← contains [spec](../hijoB/spec.md)
└── hijoB/
    └── spec.md                      ← the real target file
```

`link-validation/hijoA/note-with-external-link.md`:
```markdown
---
name: note-with-external-link
description: |
  Demo note that links out to a sibling project (hijoB) sitting
  next to this one. Used to teach scan.referencePaths.
---

# Note with external link

See the [spec](../hijoB/spec.md) for the agreed format.
```

`link-validation/hijoB/spec.md`:
```markdown
---
name: spec
description: |
  Target of the cross-folder link. Lives outside hijoA's scan
  scope on purpose: that is precisely what scan.referencePaths
  is designed to bridge.
---

# External spec

Anything that hijoA points at lives here.
```

Once the files are in place, tell the tester:

> I just dropped two sibling folders inside the tutorial cwd:
>
> ```
> link-validation/
> ├── hijoA/
> │   └── note-with-external-link.md   ← contains [spec](../hijoB/spec.md)
> └── hijoB/
>     └── spec.md                      ← the real target file
> ```
>
> For this step you'll switch folders for a moment, so `sm` treats
> `hijoA/` as a separate project (new cwd, scope limited to that
> subtree). At the end of the step I'll tell you how to come back.
>
> If an `sm` from an earlier step is still running, close it with
> Ctrl+C so the port is free for this one. Then, in your second
> terminal:

```bash
cd link-validation/hijoA
sm init
sm check
```

> You'll see an error from the `reference-broken` analyzer (a rule
> that flags problems) pointing at the link `../hijoB/spec.md`. As
> far as skill-map is concerned that file doesn't exist, because
> `hijoB/` sits outside the scope `sm` is scanning from `hijoA/`:
> each project has its own `.skill-map/` and only walks from its
> cwd downwards, never "up" and never into sibling folders.
>
> Paste me the output (or just an OK) and we'll move on to the fix.

Wait for confirmation before showing the fix. Mark the error landed as expected; if the tester reports `✓ No issues` instead, the most likely cause is that they ran `sm check` from the tutorial root by mistake (the root scan still sees both folders). Have them re-check that the cwd of their second terminal is `link-validation/hijoA/` (`pwd`) and rerun.

After they confirm the broken-ref error, present the fix:

> To resolve the link without moving `hijoB/` inside `hijoA/`, you
> add `../hijoB` to the `scan.referencePaths` setting. It tells the
> analyzer "if a path-style link lands here, validate it against
> these extra folders too". The files are NOT added to the map
> (they don't show up as nodes), they're only consulted to resolve
> outgoing references from `hijoA/`.
>
> In your second terminal (still inside `link-validation/hijoA/`):

```bash
sm config set scan.referencePaths '["../hijoB"]' --yes
sm scan
sm check
```

> The `--yes` flag confirms the privacy gate: you're authorizing
> skill-map to read files outside the project root, so it asks for
> your explicit OK. Without `--yes` the verb aborts and asks you to
> retry with `--yes` (it does not open an interactive prompt).
> After the scan, `sm check` should print `✓ No issues`: the error
> is gone and `hijoB/` still hasn't entered the map as a node.
>
> Paste me the output and let's see how it got persisted.

Wait for confirmation. After they paste the clean `sm check` output, show where the value lives on disk:

> Look at how the change got saved:

```bash
cat .skill-map/settings.local.json
```

> You'll see something like this:
>
> ```json
> {
>   "scan": {
>     "referencePaths": ["../hijoB"]
>   }
> }
> ```
>
> It lives in `settings.local.json` (gitignored, doesn't travel
> through git), NOT in the `settings.json` that does get committed.
> The reason: paths to sibling folders usually depend on your
> machine's local layout (not every contributor has the same
> project tree on disk), so skill-map forces this setting into the
> local layer.

Now the UI half. The tester needs `sm` running with `hijoA/` as cwd to see the matching panel:

> Now the same thing from the UI. In the same terminal, start the
> server from `hijoA/`:

```bash
sm
```

> Open the URL the command prints in the browser. Top right there's
> the **sliders** icon (hover shows "Settings"), click it, in the
> modal go to the **Project** tab and scroll down to the **Folders
> for link validation** section. You'll see `../hijoB` listed, with buttons to add or
> remove paths. The CLI and the UI write to the same file: if you
> add one from the UI, it shows up in the JSON, and vice versa.
>
> When you're done looking, Ctrl+C in the terminal to close the
> server.

Wait for confirmation that they saw the panel and closed the server. If the `sm` launch fails with a port-in-use error, an old `sm` is still bound to the default port from an earlier step; follow the §Edge cases recipe (`sm serve --port 4243`).

The tester is still inside `link-validation/hijoA/` at this point. Do NOT send them back here; the return-to-root `cd ../..` lives in §Final wrap-up, right before the cleanup line. Mark `reference-paths`: done.
