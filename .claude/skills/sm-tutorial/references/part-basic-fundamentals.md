# Part 0 (basic track): The live map (prologue) - step library

The live-UI prologue for the **basic track**: the **Agent Skills open
standard** (the `agent-skills` lens; vendors like Antigravity build on it and
add their own extras, which this book does not teach). Same arc as the rich
prologue, the tester runs
`sm init`, opens the browser, and watches the map update in real time, but this
lens authors only **skills** and **markdown notes**, and assets connect by
**markdown references** (`[text](path)`), the one link the Agent Skills standard
documents. There is no `agent`/`command` kind here and no `/`-invoke or
`@`-mention; those are rich-track (claude/codex) features. `pace: per-step`
(one chapter per exchange, the chapter's own confirmation advances, NO separate
"¿seguimos?"), `preflight: taught-init` (the tester runs `sm init` as the first
taught step; pre-flight lays the boot `demo-skill`). Shared conventions (tone,
provider detection / substitution, the `> ` rendering rule, the per-step cycle)
live in `_core.md`; do not restate them here. Narrate with `<provider_dir>`
resolved from `tutorial.provider` (`.agents/skills` on this track).

## Chapter `init` - Your first node (~2 min)

Agent background (do NOT render as a separate paragraph; folded into the message
below): `sm init` creates a hidden `.skill-map/` folder in the cwd holding the
database where skill-map stores what it learns, and runs an initial scan
(mandatory first step). Typing `sm` alone then starts the UI server with the
watcher built in (an alias of `sm serve` with defaults). One process, one
terminal: it boots the server, scans the `.md` files, and pushes events over
WebSocket to the live UI. The next chapters all run against this same `sm`
session, kept alive through the `ignore` chapter.

Expected: `.skill-map/skill-map.db` appears (plus config files), the lens
auto-detects to `<provider>` from the `.agents/` marker, and the initial scan
reports one node from the boot `demo-skill` fixture pre-flight laid. `sm init`
runs and exits; `sm` then starts the UI server and stays running.

Give the tester the whole flow in ONE message with ONE confirmation. Lead with
the browser setup, then explain the two commands, then the command block, then
the URL. Don't hardcode the URL, the verb logs the bound `http://host:port`.

> First, **open your browser** and put it side by side with this
> chat so you can watch the **Map** update in real time.
>
> Then, in your second terminal, run two commands. `sm init` sets the
> project up: it creates the hidden `.skill-map/` folder with the
> database, and runs a first scan. `sm` on its own then boots the live
> UI server, with the watcher built in.

```bash
sm init
sm
```

> After a couple of seconds `sm` prints a URL, copy it and open it in
> your browser. You'll see one node in the **Map**: `demo-skill`. Tell
> me when the page is open showing it.

Wait for confirmation. Mark `init`: done.

## Chapter `kinds` - Skills and notes appear (~1 min)

Leave the browser open and `sm` running. You create three more nodes **without
any links yet**, pure standalone nodes, so the tester sees them pop in. On this
lens there are exactly two authored kinds, `skill` (the boot `demo-skill`) and
`markdown` (the three notes); the rich track (claude/codex) additionally has
`agent` and `command`, which this lens does not.

Lay the three notes in one go (content lives in `fixtures-data/`). Backstage
(silent):

```
node .claude/skills/sm-tutorial/scripts/fixtures.js lay prologue --only "__PROVIDER__/skills/demo-skill/SKILL.md,notes/todo.md,notes/demo-guideline.md,notes/demo-guideline2.md" --provider <provider> --lang <lang>
```

(`demo-skill` is already on disk from the boot step, the lay is idempotent; the
three notes are new.) Tell the tester:

> Look at the browser. Three new nodes should have popped in:
> **Demo TODO list**, `demo-guideline`, and `demo-guideline2`.
> Four total now, **still unconnected**: they're floating nodes. The
> viewport auto-fits, so all four should be visible without panning.
>
> What I just did behind the scenes: I created three note files in
> your project, and the watcher picked them up on its own, that's why
> they appeared without you running anything:
>
> - `notes/todo.md` (kind: markdown)
> - `notes/demo-guideline.md` (kind: markdown)
> - `notes/demo-guideline2.md` (kind: markdown)
>
> Your lens authors two kinds, **skill** (`demo-skill`) and **markdown**
> (the notes). Claude and Codex projects add `agent` and `command` kinds
> on top, your open-standard lens keeps it to these two.
>
> Did the three appear? Confirm so we can wire them up.

Wait for confirmation. Mark `kinds`: done.

## Chapter `first-edit` - Your first edit (the watcher reacts) (~1 min)

Up to here you've watched the agent write files. Now hand the keyboard over: the
watcher reacts to **any** `.md` edit under the cwd, not just files the agent
authors. After this beat the tester has the "save → map updates" muscle memory,
which the `ignore` chapter reuses.

Tell the tester:

> Your turn. First, in the browser, **expand the `demo-skill` card**
> (click the chevron on the card) so its description shows, that's the
> field you'll edit, so leave the card open and the change will be
> obvious.
>
> Now open `<provider_dir>/demo-skill/SKILL.md` in your editor. In the
> **frontmatter** at the top, change the `description:` field to any
> text you want (the content doesn't matter, just make it different).
> Save the file.
>
> Watch the browser. The `demo-skill` card should refresh its
> description in real time, no reload, same watcher that picked up the
> three notes a moment ago, this time reacting to YOUR edit.
>
> Confirm so we wire the four up.

Wait for confirmation. You MAY `Read` the file afterwards to verify (read-only,
allowed under Inviolable rule #1). Mark `first-edit`: done.

## Chapter `connectors` - Connect with references (markdown links) (~2 min)

You edit `notes/todo.md` so it becomes the **hub** that points to the other
nodes. On this lens there is exactly one connector: the **markdown reference**.
A bullet links to another file with `[label](relative/path)`; skill-map reads
that as a `references` link and draws an arrow when the target resolves to a
real file. (The rich track also has `/`-invokes and `@`-mentions; the open
standard connects by file links only, and that is all this lens emits.)

Apply the hub bullets (content lives in `fixtures-data/`). The edit appends
three bullets after the `# Pending` heading. Backstage (silent):

```
node .claude/skills/sm-tutorial/scripts/fixtures.js edit todo-connectors --provider <provider> --lang <lang>
```

Tell the tester:

> Look at the magic again. **Demo TODO list** is now the hub. I added
> three linking bullets to it (open `notes/todo.md` to see them), and
> **two arrows** light up, both `references`:
>
> - `Demo TODO list → demo-skill` (a link to `demo-skill`'s SKILL.md)
> - `Demo TODO list → demo-guideline2` (a link to the note file)
>
> The arrow comes from a markdown link that lands on a real file. So
> why two arrows for three bullets? The third bullet links to
> `demo-guideline` **without the `.md` extension**, so it points at a
> path that does not exist on disk. skill-map cannot resolve it: it
> draws no arrow and instead flags the hub with a **broken reference**,
> a red error marker on the **Demo TODO list** card. Compare it with
> the bullet right above: `demo-guideline2.md` carries the extension, so
> the link finds the real file and draws a solid arrow. Same kind of
> note, one `.md` apart: one resolves, the other does not.
>
> 💡 Tip: if the nodes are crowded, the map toolbar has a **Re-arrange
> layout** button that tidies things up.
>
> Confirm when you see the two arrows plus the broken-reference marker
> on the hub. If an arrow is missing, refresh the browser and let me
> know.

Expected: two drawn arrows plus one `core/reference-broken` error on
`notes/todo.md` for the unresolved `demo-guideline` link (the tester resolves it
by hand in `edit-link`). If an arrow is missing, do not advance. Mark
`connectors`: done.

## Chapter `inspector` - The inspector and connections (~1 min)

The canvas only draws the resolved arrows; the full per-link breakdown,
including the broken one, lives in the Inspector. Open it on the hub.

> 🆕 Open the Inspector for **Demo TODO list** (click the node). Find
> the **Connections** section: **Outgoing** and **Incoming**.
> Demo TODO list lists **3 links** under Outgoing (the canvas drew two
> arrows, but the data keeps the broken `demo-guideline` link as a third
> row) and 0 under Incoming. Each row shows the link kind (`references`,
> the only kind on this lens) and a confidence badge: the
> `demo-guideline2` link reads `1.00` (resolved), while the
> `demo-guideline` link reads `0.50` and is marked broken.
>
> Now open the Inspector for a couple of nodes to read their Incoming
> count. `demo-skill` and `demo-guideline2` each show **1** incoming.
> Open `demo-guideline` and it shows **0**: the broken link never landed
> on it. Three outgoing links on the hub, but only two reach a node.
>
> 💡 Tip: skill-map draws each connector's **confidence** as opacity.
> Both drawn arrows are solid (1.00) because each lands on a real file;
> the broken one is flagged instead of drawn.
>
> Let me know when you see it.

Mark `inspector`: done.

## Chapter `edit-link` - Edit a link, the topology changes (~3 min)

**Context**: `first-edit` changed a scalar and watched a card refresh. This
chapter edits the markdown links and watches the MAP TOPOLOGY change both ways,
a connector disappears when you remove a link, and a new one appears (clearing
the broken-reference error) when you fix the unresolved one.

The server has been live since `init`, leave it running; this chapter and the
next two reuse it.

> Your turn. Edit `notes/todo.md` and delete the bullet that links to
> `demo-skill`. Save. Watch the UI.
>
> Expected: the `Demo TODO list → demo-skill` arrow disappears in real
> time. Both nodes stay in the **Map**; only the edge goes.
>
> Tell me when the connector is gone.

Once they confirm, the second edit fixes the broken reference:

> Now the other direction, fix the broken link. Edit `notes/todo.md`
> again and add the `.md` extension to the `demo-guideline` link so the
> target reads `demo-guideline.md`. Save.
>
> Expected: a NEW arrow appears, `Demo TODO list → demo-guideline`
> (`references`), and the red broken-reference marker on the hub clears.
> The `.md` turned the dangling path into a link that lands on the real
> `demo-guideline.md`, the same contrast you saw in the connectors
> chapter, now fixed by hand.
>
> Confirm when the new arrow is in and the red marker is gone.

You verify by reading `notes/todo.md` (the `demo-skill` bullet gone, the
`demo-guideline` link now ending in `.md`). Leave the server running. Mark
`edit-link`: done.

## Chapter `workspace` - Navigate the workspace (files, search, isolate) (~2 min)

**Context**: you've built the graph and understood it; this beat is about
*moving around* it. The workspace has two halves: the **Map**, and a **Files**
panel (a folder tree of every node). The same `sm` session is still running.

Walk the three actions one at a time (open the Files panel, search, isolate);
each ends with its own confirmation. Do NOT prepend an intro line to a block.

> Open the **Files** panel. It sits collapsed against the left edge:
> click the expand handle (the `>` arrow, tooltip "Expand files panel").
> The sidebar opens into a **folder tree**: your four nodes grouped
> under `<provider_dir>/` and `notes/`, each row showing its kind and
> how many links go in and out.
>
> Tell me when the tree is open.

> At the top of the sidebar there's a search box (placeholder
> `Search…`). Type `guideline`. Watch the tree narrow to the two
> guideline nodes. The search matches a node's name, path, or
> description, and filters live, no Enter needed. The **Map** stays
> put: by default the search filters only the files list, not the map.
>
> 💡 Tip: the map-icon button next to the search box controls whether
> the search also filters the **Map** (off by default, which is why the
> map stayed put while only the tree narrowed). Click it on if you want
> a search to filter the map too.
>
> Now clear the box. All four nodes come back in the tree. Confirm you
> saw it filter and then restore.

> Last one. In the tree, find the `notes/todo` row (the **Demo TODO
> list** hub, the tree labels rows by file name): at its right edge
> there's a small **sitemap** icon (tooltip "Isolate this node and its
> direct links on the map"). Click it.
>
> The Map collapses to **Demo TODO list** plus only the nodes it draws
> an arrow to (`demo-skill`, `demo-guideline2`). That's how you focus on
> one node's neighborhood when a map gets busy.
>
> To bring the rest back, look at the toolbar along the bottom of the
> Map: there's a **Show all** button (an eye icon). Click it and all
> four nodes return.
>
> Did the map isolate and then restore?

Leave the server running, the next chapter is the last that uses it. Mark
`workspace`: done.

## Chapter `ignore` - Silence a file via .skillmapignore (~2 min)

Earlier chapters showed the watcher picking up new files and edits. This chapter
flips it: a file the tester DOES NOT want in the map (a draft, a secret) gets
hidden by one line in `.skillmapignore`. Same live mechanism, no restart.

`sm init` already wrote a starter `.skillmapignore` at the scope root. One step,
one confirmation (the node vanishing): the agent seeds a file no one would want
public, shows where it lives, and the tester hides it with one glob.

**The agent seeds the file (no tester action, no separate pause).**

Lay `notes/private-credentials.md` (kind `markdown`). Backstage (silent):

```
node .claude/skills/sm-tutorial/scripts/fixtures.js lay prologue --only "notes/private-credentials.md" --provider <provider> --lang <lang>
```

It lands as a fifth node (`notes/private-credentials`); the watcher sees it like
any other `.md`. Do NOT pause to confirm its appearance, it folds into the
single vanish confirmation.

**The tester hides it (single message, one confirmation).** Use `Bash`
(`ls -la`, plus `ls -la notes/`) for the real listing and apply the
host-dependent rendering rule. Per Inviolable rule #2, the agent does NOT touch
`.skillmapignore`, the tester edits it:

> One last step. Your `private-credentials` note just popped into the
> map as a fifth node. Let's hide it. Here's your directory right now:

```
.                            ← your cwd
├── .agents/skills/
│   ├── demo-skill/SKILL.md
│   └── sm-tutorial/SKILL.md   ← the tutorial you loaded
├── .skill-map/              ← project DB + settings
├── .skillmapignore          ← the file we're about to edit
└── notes/
    ├── todo.md
    ├── demo-guideline.md
    ├── demo-guideline2.md
    └── private-credentials.md   ← what we want to hide
```

> The `.skillmapignore` at the root uses `.gitignore` syntax: anything
> matching a pattern there is invisible to skill-map's scan. Open it in
> your editor (cwd root) and append this on a new line at the end:

```
notes/private-*.md
```

> Save the file. It's a glob: `notes/private-*.md` matches
> `private-credentials.md` and any future sibling. A literal path
> (`notes/private-credentials.md`) would also work.
>
> Watch the browser when you save. The `notes/private-credentials` node
> should disappear from the **Map** in real time, no restart. Five nodes
> back to four.
>
> Did the node vanish?

Adjust the tree shown to whatever `ls -la` returns, the goal is "tester
recognises their own filesystem". After they confirm, you MAY `Read`
`.skillmapignore` to verify the appended pattern (read-only, allowed). Once
confirmed, ask them to stop the server with **Ctrl+C** before continuing.

Mark `ignore`: done. Last chapter of the part: apply §Closing a part (the close
names the part by its title and routes back to the menu).
