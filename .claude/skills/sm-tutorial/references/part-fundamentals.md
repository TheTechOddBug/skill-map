# Part 0: The live map (prologue) - step library

The live-UI prologue: the tester runs `sm init`, opens the browser, and watches the map update in real time as files are written and edited. `pace: per-step` (ask "¿seguimos?" between steps), `preflight: taught-init` (the tester runs `sm init` as the first taught step, not pre-flight), and the chapters lay the basics fixture progressively, one node at a time. Shared conventions (tone, provider detection / substitution, the `> ` rendering rule, the per-step cycle) live in `_core.md`; do not restate them here.

## Chapter `init` - Your first node (~2 min)

**Context**: `sm init` creates a hidden `.skill-map/` folder in the cwd holding the database where skill-map stores what it learns about the project. It also runs an initial scan. Mandatory first step. Then typing `sm` alone (no arguments) in an initialised dir starts the UI server with the watcher built in (it is just an alias of `sm serve` with all defaults; the moment you need any flag you write `sm serve --flag ...` explicitly). One process, one terminal: it boots the server, scans the `.md` files, detects changes, and pushes events over WebSocket to the live UI. The next chapters all run against the same `sm` session, you boot it here and keep it alive through the `ignore` chapter.

```bash
sm init
ls -la .skill-map/
```

Expected: `.skill-map/skill-map.db` appears (plus config files). The initial scan reports a small node / link / issue count from the demo-agent fixture, NOT 14+ phantom issues from the tutorial's own prose: pre-flight already wrote `.skillmapignore` with the right exclusions in place, so `sm init` leaves that file alone (it only writes when absent) and the scan never sees `sm-tutorial.md` / `findings.md` / `tutorial-state.yml`.

Before launching the server, ask the tester to set up a **side-by-side view** so they can watch the magic happen without alt-tabbing every step. Tell the tester:

> Now arrange your screen so the **browser** (where the **Map**
> updates in real time) and **this chat** are both visible at once
>, typical layout is browser on the left half, chat on the right
> (or any split that lets you see both). The terminal running
> `sm` can stay off to the side; it just prints scan progress
> lines and you don't need to read them.
>
> Tell me when you're set up and we start.

Wait for confirmation before moving on. Once they're ready, prompt them to launch the server and open the link it prints, without hardcoding the URL here, since the verb itself is the source of truth (it logs the bound `http://host:port` after listen):

> Run `sm`. After a couple of seconds it will print a line with the
> URL where the UI is listening, copy that link and open it in the
> browser you just arranged. Tell me when you see the page load.

Wait for confirmation that the page loaded. Then tell the tester:

> You'll see exactly **one node** in the **Map**: `demo-agent`
> (kind `agent`). That's our starting point.
>
> The workspace opens **map-first**: the canvas fills the screen and
> the **Files** panel sits collapsed against the left edge. Click the
> expand handle on the far left (the `>` arrow, its tooltip reads
> "Expand files panel") to open it.
>
> Now walk the two views before we go on:
> 1. **Map**: the single agent node on the canvas.
> 2. **Files**: one row, with path / kind / metadata.
>
> Then, back in **Map**, click the node: the **Inspector** panel
> slides out with its frontmatter (the YAML block at the top of
> every `.md`, between the two `---` lines) and its links.
>
> Did the node show up?

Wait for confirmation. Mark `init`: done.

## Chapter `kinds` - The other kinds appear (~1 min)

Leave the browser open and the terminal with `sm` running. You create four more nodes **without any cross-fixture links** yet, pure standalone nodes, so the tester sees four new dots pop in. Three new **kinds** show up in this step (skill, command, markdown), the fourth file is a second `markdown` node that the hub in the `connectors` chapter will point at via a real `references` link.

Create these four files (with `Write`), exactly in this order. Per §Provider detection, **substitute `.claude/` with the detected `<provider_dir>` and skip files whose kind is not in the provider's supported set** (`agent-skills` / Antigravity: skip both `demo-agent` and `demo-command`, only the skill + the two markdown notes remain). Adjust the node count, the "four new nodes" message, and the file list shown to the tester in the sample below accordingly:

1. `.claude/skills/demo-skill/SKILL.md` (kind: skill):
   ```markdown
   ---
   name: demo-skill
   description: |
     Example skill that walks a file and returns a Markdown report.
     Showcases the `skill` kind in the demo map.
   inputs:
     - name: target
       type: path
       description: File to process.
       required: true
   outputs:
     - name: report
       type: string
       description: Markdown summary.
   ---

   # demo-skill

   This skill walks a file and returns a report. Will be wired up
   to the rest of the demo fixture in the next sub-step.

   ## Steps
   1. Read the `target`.
   2. Validate the frontmatter against the schemas.
   3. Generate the report.
   ```

2. `.claude/commands/demo-command.md` (kind: command):
   ```markdown
   ---
   name: demo-command
   description: |
     Example slash-style command that wraps the demo-skill behind
     a keyboard shortcut. Showcases the `command` kind.
   shortcut: "ctrl+alt+d"
   args:
     - name: target
       type: path
       description: File the command will hand off to the skill.
       required: true
   ---

   # demo-command

   Quick keyboard entry point for running the demo flow on a
   target file. Connectors land in the next sub-step.
   ```

3. `notes/todo.md`, classified as `kind: markdown` today
   (the catch-all for `.md` files outside the
   skill / agent / command folders):
   ```markdown
   ---
   name: Demo TODO list
   description: |
     Live list of things to review in the demo. Will become the
     hub that points to the rest of the fixture in the next
     sub-step.
   tags: [notes, demo]
   ---

   # Pending
   ```

4. `notes/demo-guideline.md`, second `kind: markdown` node, the
   one the hub will reach via a real markdown link in the
   `connectors` chapter:
   ```markdown
   ---
   name: demo-guideline
   description: |
     Static reference notes that the rest of the demo points at.
     Showcases a second markdown node so the demo can exercise
     the `references` link kind without ambiguity.
   tags: [notes, demo]
   ---

   # Demo Guideline

   Conventions the demo fixture follows:

   - Names match the file basename.
   - Frontmatter `description` is short and human-readable.
   - Body stays minimal, only what's needed to teach the kind.
   ```

Tell the tester:

> Look at the browser. Four new nodes should have popped in:
> `demo-skill`, `demo-command`, `notes/todo`, and `demo-guideline`.
> Five total now, **still unconnected**: they're floating dots.
> The viewport auto-fits whenever a node is added or removed, so
> all five should be visible without panning.
>
> What I just did behind the scenes: I created four new files in
> your project, and the watcher picked them up on its own, that's
> why four new dots appeared without you running anything:
>
> - `.claude/skills/demo-skill/SKILL.md` (kind: skill)
> - `.claude/commands/demo-command.md` (kind: command)
> - `notes/todo.md` (kind: markdown)
> - `notes/demo-guideline.md` (kind: markdown)
>
> Same loop you'll use yourself in the next step, only this time
> the writes came from me.
>
> Did the four appear? Confirm so we can wire them up.

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
> ⚠ Heads-up: the inspector header shows a couple of action
> buttons (**Bump version**, **Refresh body**). **Don't click
> them yet**, they write files to your project and we cover that
> flow deliberately in the annotations chapter. For now, just look.
>
> Now open `.claude/agents/demo-agent.md` in your editor of
> choice. In the **frontmatter** at the top of the file, change
> the `description:` field to any text you want, the actual
> content does not matter, just make it different from what's
> there now. Save the file.
>
> Watch the browser. The `demo-agent` card should refresh its
> description in real time, no reload, no Ctrl+C, same watcher
> that picked up the four new nodes a moment ago, this time
> reacting to YOUR edit.
>
> Confirm so we wire the five up.

Wait for confirmation. You MAY use `Read` on the file afterwards to verify the change landed (read-only, allowed under Inviolable rule #1) before moving on. Mark `first-edit`: done.

## Chapter `connectors` - The connectors light up (~2 min)

You edit `notes/todo.md` so it becomes the **hub** that points to each of the other four nodes. Each bullet uses a syntax that maps to a specific **link kind**:

- an `@handle` token → kind `mentions`
- a `/slash` token → kind `invokes`
- a markdown link `[text](path)` → kind `references`

Four bullets, three kinds (the `invokes` kind shows up twice because both the command and the skill are addressed by slash).

Apply with `Edit` on `notes/todo.md` (do not rewrite the file). Per §Provider detection, **substitute `.claude/` with the detected `<provider_dir>` and drop any bullet whose target node was not created in the `kinds` chapter** (on `agent-skills` / Antigravity there is no agent and no command → skip the `@demo-agent` and `/demo-command` bullets, two connectors land).

**Edit `notes/todo.md`**: append these bullets after the `# Pending` heading:

```markdown
- [ ] Brief @demo-agent on the rough edges.
- [ ] Run /demo-command before publishing.
- [ ] Trigger /demo-skill when the input lands.
- [ ] Re-read the
      [demo-guideline](./demo-guideline.md) before shipping.
```

Tell the tester:

> Look at the magic again. `notes/todo` is now the hub: four
> arrows light up between it and the other nodes, and the UI
> palette colours each arrow by the link kind it carries:
>
> - `notes/todo → demo-agent` (kind: `mentions`)
> - `notes/todo → demo-command` (kind: `invokes`)
> - `notes/todo → demo-skill` (kind: `invokes`)
> - `notes/todo → demo-guideline` (kind: `references`)
>
> The kind comes from the syntax in the bullet: an `@handle` is
> always a mention, a `/command` is always an invoke, a markdown
> link is always a reference. Four arrows, three kinds, three
> colours on the canvas (the two `invokes` share a colour, as you
> would expect).
>
> Notice too that the connectors have different transparency.
> Skill-map estimates how sure it is of each connection: a
> `[text](file.md)` that points at a real file (confidence 1.00,
> now that the target exists) looks solid, while an `@handle` that
> resolves to no node sits at 0.5 (ambiguous) and looks
> translucent. The opacity tells that story at a glance: the more
> solid the arrow, the more reliable the inference.
>
> Confirm when you see it. If a connector is missing, refresh the
> browser and let me know.

If a connector is missing, do not advance, the next chapter inspects the same hub edit. Mark `connectors`: done.

## Chapter `inspector` - The inspector and linked nodes (~1 min)

The connector opacity tells the confidence story at a glance; the exact per-link breakdown lives in the Inspector. Open it on the hub so the tester registers the surface before the `edit-link` chapter changes topology.

> 🆕 Open the Inspector for `notes/todo` (click the node on the
> map). Scroll down to the **Linked nodes** panel: it has two
> sections, **Outgoing** and **Incoming**. `notes/todo` lists 4
> links under Outgoing (it's the hub pointing at four nodes) and 0
> under Incoming; if you open the Inspector for any of the four
> targeted nodes, you'll see 1 under Incoming. Each row shows the
> link kind (`mentions`, `invokes`, `references`) and a badge with
> its confidence: the numeric value (`1.00`, `0.50`, …).
>
> Let me know when you see it.

After the tester confirms, drop this tip:

> 💡 Tip: if all these changes left the nodes crowded together,
> the map toolbar has a **Reset layout** button: it re-runs the
> auto-layout so everything reads better. It asks for confirmation
> because it discards any positions you moved by hand.

Wait for confirmation. Mark `inspector`: done.

## Chapter `edit-link` - Edit a link, the topology changes (~3 min)

**Context**: the `first-edit` chapter had the tester edit a scalar (`description`) and watch the inspector card refresh. This chapter raises the bar: edit a Markdown link and watch the MAP TOPOLOGY change (a connector disappears). Same watcher, different surface.

The server has been live since the `init` chapter, leave it running; this chapter and the next two (the workspace tour, then `.skillmapignore`) reuse it.

> Your turn. Edit `notes/todo.md` with your editor of choice and
> delete the bullet that contains `@demo-agent`. Save. Watch the
> UI.
>
> Expected: the `notes/todo → demo-agent` connector (kind:
> `mentions`) disappears in real time. The two nodes stay in the
> **Map**; only the edge goes.

You verify by reading `notes/todo.md` to confirm the change was applied. (On `agent-skills`, where the `@demo-agent` bullet was never created in the `connectors` chapter, ask the tester to remove the only bullet they did add and watch THAT connector vanish, the lesson is the same.) Once they confirm, leave the server running, the next chapter reuses it. Mark `edit-link`: done.

## Chapter `workspace` - Navigate the workspace (files, search, isolate) (~2 min)

**Context**: you've built the graph and understood it; this beat is about *moving around* it. The workspace has two halves: the **Map** you've been working in, and a **Files** panel, a folder tree of every node. You'll open that tree, filter it with the search box, and use **isolate** to collapse the map down to a single node and the things it touches. No file edits here, pure navigation, and the same `sm` session you booted back in the `init` chapter is still running.

Per §Provider detection, on `agent-skills` / Antigravity the fixture has fewer nodes (`demo-skill` plus the two `notes/` files), so swap the node names below for ones that exist in that set; the gestures are identical.

**Beat 1, open the Files panel (tester does this).**

> Make sure the **Files** panel is open, the one you expanded back
> in the first chapter on the left edge. If you collapsed it since,
> click the expand handle (the `>` arrow, tooltip "Expand files
> panel") to reopen it. The sidebar shows a **folder tree** (a
> nested view of your folders and the nodes inside them): your five
> nodes grouped under `.claude/` and `notes/`, each row showing its
> kind and how many links go in and out.
>
> Tell me when the tree is open.

**Beat 2, search (tester does this).**

> At the top of that sidebar there's a search box (placeholder
> `Search…`). Type `guideline`. Watch both halves at once: the tree
> narrows down to `demo-guideline` and the **Map** drops every node
> except `demo-guideline`. The search matches a node's name, path,
> tags or description, and filters live as you type, no Enter
> needed.
>
> Now clear the box. All five nodes come back, in both the tree and
> the Map. Confirm you saw it filter and then restore.

**Beat 3, isolate (tester does this).**

> Last one. In the tree, find the `notes/todo` row: at its right
> edge there's a small **sitemap** icon (its tooltip reads "Isolate
> this node and its direct links on the map"). Click it.
>
> The Map collapses to `notes/todo` plus only the nodes it links to
> (`demo-command`, `demo-skill`, `demo-guideline`). `demo-agent`,
> which lost its only connector back in the last step, drops out of
> view, and the Inspector opens on `notes/todo`. That's how you
> focus on one node's neighborhood when a map gets busy.
>
> To bring the rest back, look at the toolbar along the bottom of
> the Map: there's a **Show all** button (an eye icon, tooltip
> "Clear the map selection and show every node again"). Click it and
> all five nodes return.
>
> Did the map isolate and then restore?

Leave the server running, the next chapter (`.skillmapignore`) is the last one that uses it. Mark `workspace`: done.

## Chapter `ignore` - Silence a file via .skillmapignore (~2 min)

Earlier chapters showed the watcher picking up new files and edits (yours and theirs). This chapter flips the direction: a file the tester DOES NOT want in the map (a draft, a scratch file, a secret) gets hidden by a single line in `.skillmapignore`. Same live mechanism, no restart.

`sm init` already wrote a starter `.skillmapignore` at the scope root. The flow has three beats:

**Beat 1, you create one new fixture file (the agent does this).**

`Write` `notes/private-credentials.md`, kind `markdown`, simulates a file the tester would never want surfacing publicly:

```markdown
---
name: private-credentials
description: |
  Personal API tokens, exists in the repo but should not show
  up in skill-map's map. Demonstrates the .skillmapignore
  flow.
---

# Private

API_TOKEN: example-not-real
```

Confirm the file appears in the map as a sixth node (`notes/private-credentials`). The watcher sees it like any other `.md`, that's the point of the demo.

**Beat 2, you show the project structure (the agent does this).**

Before asking the tester to touch `.skillmapignore`, give them a mental map of the folder so they know where the file lives and what's around it. Use `Bash` (`ls -la` and `ls -la notes/` if a deeper view helps) and present the listing as a tester-facing message (apply the host-dependent rendering rule) so the tester sees what their cwd holds:

> One last step. Here's what your directory looks like right now:

```
.                            ← your cwd
├── .claude/
│   ├── agents/demo-agent.md
│   ├── commands/demo-command.md
│   └── skills/
│       ├── demo-skill/SKILL.md
│       └── sm-tutorial/SKILL.md   ← the tutorial you loaded
├── .skill-map/              ← project DB + settings (managed)
├── .skillmapignore          ← the file we're about to edit
└── notes/
    ├── todo.md
    ├── demo-guideline.md
    └── private-credentials.md   ← what we want to hide
```

> The `.skillmapignore` at the root is the file we'll touch
> next. Same syntax as `.gitignore`. Anything matching a pattern
> there is invisible to skill-map's scan.

Adjust the actual tree shown to whatever `ls -la` returns, the goal is "tester recognises their own filesystem", not a copy of the snippet above.

**Beat 3, the tester edits `.skillmapignore` (NOT the agent).**

Per Inviolable rule #2, the agent does NOT touch `.skillmapignore` with your `Edit` tool. Tell the tester to do it from their editor:

> Last step. Open `.skillmapignore` (it's at the cwd root) in
> your editor of choice. At the end of the file, on a new line,
> append the literal pattern `notes/private-*.md`. Save the
> file. The pattern uses a glob (same as `.gitignore`):
> `notes/private-*.md` matches `private-credentials.md` and any
> future sibling `private-*.md`. A literal path
> (`notes/private-credentials.md`) would also work, the glob
> teaches the broader habit.
>
> Watch the browser when you save. The
> `notes/private-credentials` node should disappear from the
> **Map** in real time, without restarting anything. Six nodes
> back to five.
>
> Did the node vanish?

After they confirm, you MAY use `Read` on `.skillmapignore` to verify the appended pattern landed correctly (in case `sm check` later reports something odd), that is read-only and allowed. Once confirmed, ask them to stop the server with **Ctrl+C** in the terminal before continuing.

Mark `ignore`: done.
