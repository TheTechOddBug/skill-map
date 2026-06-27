# Part 0: The live map (prologue) - step library

The live-UI prologue: the tester runs `sm init`, opens the browser, and watches the map update in real time as files are written and edited. `pace: per-step` (one chapter per exchange; the chapter's own confirmation advances to the next, NO separate "¿seguimos?"), `preflight: taught-init` (the tester runs `sm init` as the first taught step, not pre-flight), and the chapters lay the basics fixture progressively, one node at a time. Shared conventions (tone, provider detection / substitution, the `> ` rendering rule, the per-step cycle) live in `_core.md`; do not restate them here.

**Codex deltas (rich track).** When `tutorial.provider == codex` the lay commands are unchanged (the `--only` ids match the Codex overlay), but the on-disk shapes differ; substitute in the tester-facing prose:

- `init`: the boot node `demo-agent` is a **TOML agent** at `.codex/agents/demo-agent.toml`.
- `kinds`: the node list reads `.codex/agents/demo-agent.toml` (agent), `.agents/skills/demo-command/SKILL.md` (Codex has no `command`, so this node is a **skill**), `.agents/skills/demo-skill/SKILL.md` (skill), and the `notes/*.md`. Name the kinds as agent + skill + markdown.
- `first-edit`: the description to edit lives in `.codex/agents/demo-agent.toml` (the `description = "…"` TOML field, not YAML frontmatter).
- `connectors` onward: identical, the `@`/`/` bullets resolve the same on Codex; only the `ignore` chapter's directory tree shows `.codex/agents/` + `.agents/skills/` instead of `.claude/`.

## Chapter `init` - Your first node (~2 min)

Agent background (do NOT render this as a separate context paragraph; the tester-facing version is folded into the message below): `sm init` creates a hidden `.skill-map/` folder in the cwd holding the database where skill-map stores what it learns about the project, and runs an initial scan (mandatory first step). Typing `sm` alone (no arguments) in an initialised dir then starts the UI server with the watcher built in (it is just an alias of `sm serve` with all defaults; the moment you need any flag you write `sm serve --flag ...` explicitly). One process, one terminal: it boots the server, scans the `.md` files, detects changes, and pushes events over WebSocket to the live UI. The next chapters all run against this same `sm` session, you boot it here and keep it alive through the `ignore` chapter.

Expected: `.skill-map/skill-map.db` appears (plus config files), and the initial scan reports a small node / link count from the demo-agent fixture. `sm init` runs and exits; `sm` then starts the UI server and stays running. (Agent context, do not narrate: pre-flight's `.skillmapignore` keeps the tutorial's own files, `sm-tutorial.md` / `findings.md` / `tutorial-state.json`, out of the scan; `sm init` leaves that file alone since it only writes when absent.)

Give the tester the whole flow in ONE message with ONE confirmation, do NOT pause for the `sm init` output separately. Order matters: **lead with the browser setup**, then explain what the two commands do as you hand them over, then the command block, then the URL. Do NOT print the command block or an explanation paragraph before the browser instruction. Don't hardcode the URL, the verb logs the bound `http://host:port` after listen. Tell the tester:

> First, **open your browser** and put it side by side with this
> chat (browser on one half, chat on the other, any split that lets
> you see both) so you can watch the **Map** update in real time.
>
> Then, in your second terminal, you'll run two commands. `sm init`
> sets the project up: it creates the hidden `.skill-map/` folder
> with the database where skill-map stores what it learns about the
> project, and runs a first scan. `sm` on its own (no arguments)
> then boots the live UI server, with the watcher built in.

```bash
sm init
sm
```

> After a couple of seconds `sm` prints a URL, copy it and open it
> in your browser. The terminal keeps printing scan lines, you don't
> need to read them.
>
> You'll see one node in the **Map**: `demo-agent`. Tell me when the
> page is open showing it.

Wait for confirmation. Mark `init`: done.

## Chapter `kinds` - The other kinds appear (~1 min)

Leave the browser open and the terminal with `sm` running. You create five more nodes **without any cross-fixture links** yet, pure standalone nodes, so the tester sees five new nodes pop in. Three new **kinds** show up in this step (skill, command, markdown); the last two files are sibling `markdown` notes (`demo-guideline`, `demo-guideline2`) the hub in the `connectors` chapter reaches two ways, a bare mention that resolves to nothing (which lands as a broken reference, no arrow drawn) and the same handle plus `.md` that resolves to a real file (a solid arrow).

Lay these five files in one go (their content + translation live in `fixtures-data/`). The script resolves `__PROVIDER__` to the claude layout (this is the rich track). Backstage (silent):

```
node .claude/skills/sm-tutorial/scripts/fixtures.js lay prologue --only "__PROVIDER__/skills/demo-skill/SKILL.md,__PROVIDER__/commands/demo-command.md,notes/todo.md,notes/demo-guideline.md,notes/demo-guideline2.md" --provider <provider> --lang <lang>
```

Adjust the node count, the "five new nodes" message, and the file list shown to the tester in the sample below to match the laid set.

Tell the tester:

> Look at the browser. Five new nodes should have popped in:
> `demo-skill`, `demo-command`, **Demo TODO list**, `demo-guideline`,
> and `demo-guideline2`.
> Six total now, **still unconnected**: they're floating nodes.
> The viewport auto-fits whenever a node is added or removed, so
> all six should be visible without panning.
>
> What I just did behind the scenes: I created five new files in
> your project, and the watcher picked them up on its own, that's
> why five new nodes appeared without you running anything:
>
> - `.claude/skills/demo-skill/SKILL.md` (kind: skill)
> - `.claude/commands/demo-command.md` (kind: command)
> - `notes/todo.md` (kind: markdown)
> - `notes/demo-guideline.md` (kind: markdown)
> - `notes/demo-guideline2.md` (kind: markdown)
>
> Same loop you'll use yourself in the next step, only this time
> the writes came from me.
>
> Did the five appear? Confirm so we can wire them up.

Wait for confirmation. Mark `kinds`: done.

## Chapter `first-edit` - Your first edit (the watcher reacts) (~1 min)

Up to here you've been watching the agent write files. Now hand the keyboard over: the lesson is that the watcher reacts to **any** `.md` edit under the cwd, not just to files the agent authors. After this beat, the tester has the muscle memory for "save → map updates", which the `ignore` chapter reuses verbatim.

Tell the tester:

> Your turn. First, in the browser, **expand the `demo-agent`
> card** (click the chevron / arrow on the card to open it). That
> reveals the description currently showing for the node, that's
> the field you'll edit next, so leave the card open and the
> change will be obvious.
>
> Now open `.claude/agents/demo-agent.md` in your editor of
> choice. In the **frontmatter** at the top of the file, change
> the `description:` field to any text you want, the actual
> content does not matter, just make it different from what's
> there now. Save the file.
>
> Watch the browser. The `demo-agent` card should refresh its
> description in real time, no reload, no Ctrl+C, same watcher
> that picked up the five new nodes a moment ago, this time
> reacting to YOUR edit.
>
> Confirm so we wire the six up.

Wait for confirmation. You MAY use `Read` on the file afterwards to verify the change landed (read-only, allowed under Inviolable rule #1) before moving on. Mark `first-edit`: done.

## Chapter `connectors` - The connectors light up (~2 min)

You edit `notes/todo.md` so it becomes the **hub** that points to each of the other five nodes. Each bullet uses a syntax that maps to a specific **link kind**:

- an `@handle` token → kind `mentions`
- an `@handle.md` token (a `@` handle that ends in a file extension) → kind `references`
- a `/slash` token → kind `invokes`

Five bullets, three kinds: `invokes` and `mentions` each appear twice, `references` once. The last two bullets are the resolution lesson: a bare `@demo-guideline` mention (which resolves to no agent, so it lands as a broken reference and draws no arrow) next to `@demo-guideline2.md`, the same handle shape plus a `.md` extension that points at a real sibling file (so it resolves and draws a solid arrow). Two separate nodes, one broken and one resolved. Five bullets but only four arrows on the canvas.

Apply the hub bullets (their content + translation live in `fixtures-data/`). The edit appends after the `# Pending` heading. Backstage (silent):

```
node .claude/skills/sm-tutorial/scripts/fixtures.js edit todo-connectors --provider <provider> --lang <lang>
```

Tell the tester:

> Look at the magic again. **Demo TODO list** is now the hub. I added
> five linking bullets to it (open `notes/todo.md` in your editor to
> see them), and **four arrows** light up between it and the other
> nodes, each coloured by the link kind it carries:
>
> - `Demo TODO list → demo-agent` (kind: `mentions`, the `@name` mention resolves to a real agent)
> - `Demo TODO list → demo-command` (kind: `invokes`)
> - `Demo TODO list → demo-skill` (kind: `invokes`)
> - `Demo TODO list → demo-guideline2` (kind: `references`, the `@` handle with a `.md` extension)
>
> The kind comes from the syntax in the bullet: an `@handle` is a
> mention, a `/skill` or `/command` is an invoke, and an `@handle`
> that ends in a file extension (`@name.md`) is a reference, the
> extension turns the name drop into a file pointer.
>
> So why four arrows for five bullets? The fifth bullet,
> `@demo-guideline`, is a reference skill-map cannot resolve: an
> `@name` mention points at an *agent* with that name, and there is no
> agent called `demo-guideline` (it is a note), so the reference lands
> on nothing. skill-map draws no arrow and instead flags the hub with a
> **broken reference**, a red error marker on the **Demo TODO list**
> card. Compare it with the bullet right after: `@demo-guideline2.md`
> adds the `.md`, which makes it point at the **file** instead, so
> skill-map finds the real `demo-guideline2.md` node and draws a solid
> arrow. Same name, one `.md` apart: one resolves, the other does not.
> (That is also why `@demo-agent` drew fine: an `@name` mention
> resolves when an agent by that name really exists.)
>
> 💡 Tip: if all these changes left the nodes crowded together, the
> map toolbar has a **Re-arrange layout** button: it tidies the
> layout so everything reads better. If you've moved nodes by hand it
> asks for confirmation first, otherwise it just re-arranges.
>
> Confirm when you see the four arrows plus the broken-reference
> marker on the hub. If an arrow is missing, refresh the browser and
> let me know.

Expected: four drawn arrows plus one `core/reference-broken` error on `notes/todo.md` for the unresolved `@demo-guideline` mention (the broken-reference preview; the tester resolves it by hand in the `edit-link` chapter by adding `.md`, and the campaign and CLI parts re-seed their own pristine copy from `prologue-built`). If an arrow is missing, do not advance, the next chapter inspects the same hub edit. Mark `connectors`: done.

## Chapter `inspector` - The inspector and connections (~1 min)

The canvas only draws the resolved arrows; the full per-link breakdown, including the broken one that never drew, lives in the Inspector. Open it on the hub so the tester registers the surface before the `edit-link` chapter changes topology.

> 🆕 Open the Inspector for **Demo TODO list** (click the node on
> the map). Find the **Connections** section: it has two sections,
> **Outgoing** and **Incoming**.
> Demo TODO list lists **5 links** under Outgoing (the canvas drew
> four arrows, but the data keeps the broken `@demo-guideline` mention
> as a fifth row) and 0 under Incoming. Each row shows the link kind
> (`mentions`, `invokes`, `references`) and a badge with its
> confidence: the numeric value. Here you'll see the contrast, the
> `references` to `demo-guideline2` reads `1.00` (resolved), while the
> `mentions` to `demo-guideline` reads `0.50` and is marked broken,
> that 0.5 is the broken-reference penalty, it's a "half sure".
>
> Now open the Inspector for a couple of the nodes to read their
> Incoming count. The four resolved nodes (`demo-agent`,
> `demo-command`, `demo-skill`, `demo-guideline2`) each show **1**
> incoming. Open `demo-guideline` and it shows **0**: the broken
> mention never landed on it, so nothing points in. Five outgoing
> links on the hub, but only four of them reach a node.
>
> 💡 Tip: skill-map draws each connector's **confidence** as opacity.
> Every arrow here is solid (1.00) because it lands on a real node; a
> reference that points at nothing is flagged instead of drawn. The
> fainter, partial case shows up later in the campaign.
>
> Let me know when you see it.

Mark `inspector`: done.

## Chapter `edit-link` - Edit a link, the topology changes (~3 min)

**Context**: the `first-edit` chapter had the tester edit a scalar (`description`) and watch the inspector card refresh. This chapter raises the bar: edit Markdown links and watch the MAP TOPOLOGY change both ways, a connector disappears when you remove a link, and a new one appears (clearing the broken-reference error) when you fix the unresolved one.

The server has been live since the `init` chapter, leave it running; this chapter and the next two (the workspace tour, then `.skillmapignore`) reuse it.

> Your turn. Edit `notes/todo.md` with your editor of choice and
> delete the bullet that contains `@demo-agent`. Save. Watch the
> UI.
>
> Expected: the `Demo TODO list → demo-agent` connector (kind:
> `mentions`) disappears in real time. The two nodes stay in the
> **Map**; only the edge goes.
>
> Tell me when the connector is gone.

Once they confirm, the second edit fixes the broken reference. Tell the tester:

> Now the other direction, fix the broken link. Edit `notes/todo.md`
> again and add the `.md` extension to the `@demo-guideline` bullet so
> it reads `@demo-guideline.md`. Save.
>
> Expected: a NEW arrow appears, `Demo TODO list → demo-guideline`
> (kind: `references`), and the red broken-reference marker on the hub
> clears. The `.md` turned the unresolved mention into a file
> reference that lands on the real `demo-guideline.md`, the same fix
> you saw side by side in the connectors chapter, now done by hand.
>
> Confirm when the new arrow is in and the red marker is gone.

You verify by reading `notes/todo.md` to confirm both edits landed (the `@demo-agent` bullet gone, `@demo-guideline` now `@demo-guideline.md`); the prologue's broken reference is now resolved. Once they confirm, leave the server running, the next chapter reuses it. Mark `edit-link`: done.

## Chapter `workspace` - Navigate the workspace (files, search, isolate) (~2 min)

**Context**: you've built the graph and understood it; this beat is about *moving around* it. The workspace has two halves: the **Map** you've been working in, and a **Files** panel, a folder tree of every node. You'll open that tree and filter it with the search box. The same `sm` session you booted back in the `init` chapter is still running.

Walk the three tester actions below one at a time (open the Files
panel, then search, then isolate); each ends with its own
confirmation, so present one and wait for the tester before the next.
Do NOT prepend an intro line to a block, each already opens with the
action itself.

> Open the **Files** panel. It sits collapsed against the left edge
> by default: click the expand handle there (the `>` arrow, its
> tooltip reads "Expand files panel"). The sidebar opens into a
> **folder tree** (a nested view of your folders and the nodes inside
> them): your six nodes grouped under `.claude/` and `notes/`, each
> row showing its kind and how many links go in and out.
>
> Tell me when the tree is open.

> At the top of that sidebar there's a search box (placeholder
> `Search…`). Type `guideline`. Watch the tree narrow down to the
> two guideline nodes (`demo-guideline` and `demo-guideline2`). The
> search matches a node's name, path, or description, and filters
> live as you type, no Enter needed. The **Map** stays put: by
> default the search filters only the files list, not the map (the
> tip below changes that).
>
> Now clear the box. All six nodes come back in the tree. Confirm you
> saw it filter and then restore.

> Last one. In the tree, find the `notes/todo` row (the **Demo TODO
> list** hub, the tree labels rows by file name): at its right edge
> there's a small **sitemap** icon (its tooltip reads "Isolate this
> node and its direct links on the map"). Click it.
>
> The Map collapses to **Demo TODO list** plus only the nodes it
> draws an arrow to (`demo-command`, `demo-skill`,
> `demo-guideline2`). That's how you focus on one node's
> neighborhood when a map gets busy.
>
> To bring the rest back, look at the toolbar along the bottom of
> the Map: there's a **Show all** button (an eye icon). Click it and
> all six nodes return.
>
> 💡 Tip: remember the search box from a moment ago? The map-icon
> button right next to it controls whether the search also filters
> the **Map**. It's off by default, which is why the **Map** stayed
> put while only the tree narrowed when you searched `guideline`.
> Click it on if you want a search to filter the map too.
>
> Did the map isolate and then restore?

Leave the server running, the next chapter (`.skillmapignore`) is the last one that uses it. Mark `workspace`: done.

## Chapter `ignore` - Silence a file via .skillmapignore (~2 min)

Earlier chapters showed the watcher picking up new files and edits (yours and theirs). This chapter flips the direction: a file the tester DOES NOT want in the map (a draft, a scratch file, a secret) gets hidden by a single line in `.skillmapignore`. Same live mechanism, no restart.

`sm init` already wrote a starter `.skillmapignore` at the scope root. The chapter is one step with a single confirmation (the node vanishing): the agent seeds a file the tester would never want public, shows where it lives, and the tester hides it with one glob.

**The agent seeds the file (no tester action, no separate pause).**

Lay `notes/private-credentials.md`, kind `markdown`, which simulates a file the tester would never want surfacing publicly (its content + translation live in `fixtures-data/`). Backstage (silent):

```
node .claude/skills/sm-tutorial/scripts/fixtures.js lay prologue --only "notes/private-credentials.md" --provider <provider> --lang <lang>
```

It lands in the map as a seventh node (`notes/private-credentials`); the watcher sees it like any other `.md`. Do NOT pause to confirm the appearance, it folds into the single vanish confirmation at the end of this step.

**The tester hides it (single tester-facing message, one confirmation).**

Give the tester a mental map of the folder so they know where the file lives, then the glob that hides it, all in ONE message. Use `Bash` (`ls -la`, plus `ls -la notes/` if a deeper view helps) for the real listing and apply the host-dependent rendering rule. Per Inviolable rule #2, the agent does NOT touch `.skillmapignore` with its `Edit` tool, the tester edits it from their own editor:

> One last step. Your `private-credentials` note just popped into
> the map as a seventh node. Now let's hide it. Here's what your
> directory looks like right now:

```
.                            ← your cwd
├── .claude/
│   ├── agents/demo-agent.md
│   ├── commands/demo-command.md
│   └── skills/
│       ├── demo-skill/SKILL.md
│       └── sm-tutorial/SKILL.md   ← the tutorial you loaded
├── .skill-map/              ← project DB + settings
├── .skillmapignore          ← the file we're about to edit
└── notes/
    ├── todo.md
    ├── demo-guideline.md
    ├── demo-guideline2.md
    └── private-credentials.md   ← what we want to hide
```

> The `.skillmapignore` at the root uses the same syntax as
> `.gitignore`: anything matching a pattern there is invisible to
> skill-map's scan. Open it in your editor (it's at the cwd root)
> and append this pattern on a new line at the end:

```
notes/private-*.md
```

> Save the file. It's a glob (same as `.gitignore`):
> `notes/private-*.md` matches `private-credentials.md` and any
> future sibling `private-*.md`. A literal path
> (`notes/private-credentials.md`) would also work.
>
> Watch the browser when you save. The
> `notes/private-credentials` node should disappear from the
> **Map** in real time, without restarting anything. Seven nodes
> back to six.
>
> Did the node vanish?

Adjust the actual tree shown to whatever `ls -la` returns, the goal is "tester recognises their own filesystem", not a copy of the snippet above. After they confirm, you MAY use `Read` on `.skillmapignore` to verify the appended pattern landed correctly (in case `sm check` later reports something odd), that is read-only and allowed. Once confirmed, ask them to stop the server with **Ctrl+C** in the terminal before continuing.

Mark `ignore`: done. Last chapter of the part: apply §Closing a part
(the close names the part by its title and routes back to the menu).
