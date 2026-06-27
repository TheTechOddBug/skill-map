# Part 1 (basic track): The project from zero (step library, `kickoff-*` ids)

The campaign turns real here for the **basic track** (the open-standard family:
`agent-skills`, `antigravity`). After the abstract prologue, the tester starts an
actual project: a tiny personal **portfolio website**, fully static, served by a
~15-line Express server, plus the `.agents/skills/` **harness** that maintains
it. skill-map maps the harness (the `.md` assets and how they reference each
other); the site itself is plain HTML the harness produces (the daily loop, Part
2, runs and ships it). This lens authors only **skills** and **markdown notes**,
and they connect by **markdown references** (`[text](path)`). This part runs end
to end: it boots the project and grows its harness members (the `kickoff` to
`real-kinds` chapters), then wires them into a connected graph (the `check-links`
to `confidence` chapters). `pace: per-step`, `preflight: portfolio-init`. Shared
conventions live in `_core.md`. Narrate with
`<provider_dir>` = `.agents/skills`.

The orchestrator's `portfolio-init` pre-flight (backstage, silent) has already
laid the bare skeleton before the tester runs `sm init`: `server.js`,
`package.json`, `public/index.html` (none `.md`, so the scan ignores them), the
portfolio `.skillmapignore`, and the handbook `AGENTS.md` (the one boot node).
The chapters grow the harness from there.

## Chapter `kickoff` - Start the portfolio (~2 min)

**Context**: same `sm init` from the prologue, now on a real project. The map
shows the project's harness, not throwaway demo nodes.

If the prologue (`basic-fundamentals`) ran first here, `portfolio-init` already
cleared the demo fixture during pre-flight, so the tester sees only the
portfolio. If anything demo lingers, mention it once and move on.

The project carries a `.agents/` marker (the open-standard skill home where the
tutorial itself lives), so `sm init` auto-detects the `<provider>` lens with no
prompt. The root `AGENTS.md` is the vendor-neutral handbook, NOT a lens marker.

```bash
sm init
sm
```

Tell the tester:

> This is a real project now: a small **portfolio website**. It's static HTML
> served by a tiny Express server (`server.js`), and the `.agents/skills/` folder
> is the **harness** (the helpers that maintain the site). skill-map maps that
> harness.
>
> Run `sm init`, it auto-detects your `<provider>` lens from the `.agents/`
> folder. Then run `sm` to boot the live UI.
>
> Open the URL `sm` printed. You'll see **one node**: `AGENTS.md`, the project's
> handbook (the operating manual for the site). `server.js`, `package.json` and
> the HTML under `public/` are not `.md`, so skill-map leaves them out, it maps
> the harness, not the served files.
>
> See the handbook node? Then we start building.

Wait for confirmation. Mark `kickoff`: done.

## Chapter `manual` - The handbook and an entry pointer (~2 min)

**Context**: the first connector on the real project. A project often keeps a
short entry file that points readers (and tools) at the handbook. On this lens
that pointer is a plain **markdown link**, the only connector the open standard
defines, and it is the tester's first real reference here.

Tell the tester to create the file themselves (their project's file, Inviolable
rule #2):

> Create a file called `CLAUDE.md` at the project root with exactly this content:
>
> ```markdown
> See the [handbook](AGENTS.md).
> ```
>
> Save it. Watch the map: a new `CLAUDE.md` node appears with a `references`
> connector pointing at `AGENTS.md`, solid at 1.00. The markdown link
> `[handbook](AGENTS.md)` is a file pointer (the same kind of reference you met
> in the prologue), and since the handbook is right there the link resolves with
> full confidence. It tells anyone (and skill-map) that this file defers to the
> handbook.
>
> Did the connector light up?

Wait for confirmation. Mark `manual`: done.

## Chapter `first-skill` - The first harness skill (~2 min)

Lay the first harness skill (content lives in `fixtures-data/`; the `skill` kind
exists on every lens, so no skip). Backstage (silent):

```
node .claude/skills/sm-tutorial/scripts/fixtures.js lay portfolio --only "__PROVIDER__/skills/content-editor/SKILL.md" --provider <provider> --lang <lang>
```

Tell the tester:

> I added the first real member of your harness: a skill called `content-editor`
> (its job is to write the site's pages). A new `skill` node appeared on the map.
> Right now it stands alone; later in this part we wire it to the handbook and the
> style guide.
>
> 💡 Tip: I create these harness files for you. If you'd like to see what's
> inside, open `<provider_dir>/content-editor/SKILL.md` in your editor, and feel
> free to peek at the files I add in the coming chapters too.
>
> See the new skill node?

Wait for confirmation. Mark `first-skill`: done.

## Chapter `real-kinds` - The kinds in context (~2 min)

**Context**: the prologue showed this lens's two kinds on abstract demo nodes.
Now name them on the real project, and add the two markdown docs the harness
references later (the style guide and the deploy runbook), so the daily loop's
maintenance beats have something to point at.

Lay the two docs (content lives in `fixtures-data/`). Backstage (silent):

```
node .claude/skills/sm-tutorial/scripts/fixtures.js lay portfolio --only "docs/STYLE.md,docs/DEPLOY.md" --provider <provider> --lang <lang>
```

Tell the tester:

> Two more nodes joined the map, both `markdown` (the catch-all kind for `.md`
> files that are not a skill): `docs/STYLE.md` (the style guide) and
> `docs/DEPLOY.md` (the deploy runbook). So now you have your lens's two kinds in
> front of you:
>
> - **skill**: `content-editor` (does work on your behalf).
> - **markdown**: `AGENTS.md`, `CLAUDE.md`, the two docs (plain notes and
>   manuals).
>
> Your lens authors exactly these two; Claude and Codex projects add `agent` and
> `command` kinds on top. Your handbook now has a real harness around it: a
> `content-editor` skill plus its docs, all on the map.
>
> See the skill and the docs in the map?

Wait for confirmation. Mark `real-kinds`: done.

## Chapter `check-links` - The link checker (~3 min)

**Context**: the harness needs a guard that runs before publishing, a skill that
checks the site's internal links resolve before it ships. We only create the
`skill` node here; the `publish` skill in the next chapter is what calls it.

Lay the `check-links` skill (content lives in `fixtures-data/`). Backstage
(silent):

```
node .claude/skills/sm-tutorial/scripts/fixtures.js lay harness --only "__PROVIDER__/skills/check-links/SKILL.md" --provider <provider> --lang <lang>
```

Tell the tester:

> So I added that guard: a skill called `check-links`. A new `skill` node
> appeared on the **Map**, alone for now; the next chapter gives it a caller.
>
> See the new skill node?

Wait for confirmation. Mark `check-links`: done.

## Chapter `publish` - The publish skill (~4 min)

**Context**: the chapter where the graph comes alive. The `publish` skill ties
three pieces together in one body: it points at the link checker, at the content
editor, and at the deploy runbook. On this lens all three are **markdown
references**, so three reference arrows light up from a single new node.

Tell the tester to create the file themselves (Inviolable rule #2). Render the
block as a **top-level fenced code block** at column 0, NOT inside the `> `
blockquote, so the frontmatter fences (`---`) land on column 0 (indented fences
never parse, and `sm check` then warns `frontmatter-malformed`).

> Create `<provider_dir>/publish/SKILL.md` with exactly this content (the first
> line is `---`, nothing before it):

```markdown
---
name: publish
description: |
  Publishes the portfolio: runs the link check, hands off to the
  content editor for any last fixes, then follows the deploy runbook.
---

# publish

The one skill you run when the site is ready to go out.

## Steps
1. Run the [check-links](../check-links/SKILL.md) skill on the pages in public/. If it reports broken links, stop and fix them first.
2. If a page needs a content fix, hand the change to [content-editor](../content-editor/SKILL.md).
3. Follow the [deploy runbook](../../../docs/DEPLOY.md): regenerate pages, run the link check, start the server.
```

Continue the tester message:

> Save it. Watch the **Map**: **three** new arrows light up at once from the new
> `publish` node, all of them `references` (the open standard's one connector),
> each landing on a real file:
>
> - `publish -> check-links` (the `[check-links](../check-links/SKILL.md)` link)
> - `publish -> content-editor` (the `[content-editor](../content-editor/SKILL.md)` link)
> - `publish -> docs/DEPLOY.md` (the `[deploy runbook](../../../docs/DEPLOY.md)` link)
>
> One node, three connectors, all references. On a vendor lens (claude/codex) the
> first two would be a `/`-invoke and an `@`-mention; the open standard wires
> everything with file links, and that is all this lens emits. The harness is
> starting to look like a real graph.
>
> 💡 Tip: to tidy the layout, click **Re-arrange layout** in the map toolbar.
>
> Did the three arrows appear?

Wait for confirmation. You MAY `Read` the file to verify the `---` fences are
flush at column 0 (if `sm check` flags `frontmatter-malformed`, the fences got
indented on paste, re-align every line flush left). Mark `publish`: done.

## Chapter `links` - The handbook becomes the hub (~4 min)

**Context**: the handbook (`AGENTS.md`) has been a lonely node since the start of
this part. Here it becomes the hub: two bullets point it at the content editor
and the publish skill. We also give the content editor a reference to the style guide it follows.

Apply both edits (content lives in `fixtures-data/`). The first appends two hub
bullets (markdown links) to `AGENTS.md`; the second adds the style-guide
reference to the content-editor skill. Backstage (silent):

```
node .claude/skills/sm-tutorial/scripts/fixtures.js edit agents-hub --provider <provider> --lang <lang>
node .claude/skills/sm-tutorial/scripts/fixtures.js edit content-editor-style --provider <provider> --lang <lang>
```

Tell the tester:

> Two edits, and the **Map** fills in. Your handbook (`AGENTS.md`) is now the hub:
> it points at the content editor and at the publish skill. And the content
> editor now reaches the style guide it follows. New arrows, all `references`:
>
> - `AGENTS.md -> content-editor` (a `[content-editor](...)` link)
> - `AGENTS.md -> publish` (a `[publish](...)` link)
> - `content-editor -> docs/STYLE.md` (a `[style guide](...)` link)
>
> The whole harness is wired end to end now: the handbook reaches the work, the
> work reaches the docs, and `publish` pulls the publish flow together, every
> connection a markdown reference, the one link the open standard documents.
>
> Did the new arrows light up?

Wait for confirmation. You MAY `Read` the two files to verify. Mark `links`: done.

## Chapter `confidence` - How sure is each link (~3 min)

No file edits, pure observation.

Tell the tester:

> Last beat of this part: how sure is skill-map about each connection? It records
> a **confidence** for every link and draws it as opacity: a link that resolves
> to a real file is solid (**1.00**), one that does not lands fainter, so a glance
> at the **Map** separates solid wiring from problem links.
>
> Open the Inspector for the `publish` node (click it). Scroll to the
> **Connections** panel and read the **Outgoing** rows. Each shows the link kind
> (`references`, the only kind here) and a confidence badge, every one reads
> **1.00**, because each link lands on a file that exists on disk.
>
> Your whole harness reads solid because every link resolves. So what does a link
> that does NOT resolve look like? You met one in the prologue: the
> `demo-guideline` link had no `.md`, so it pointed at a path that did not exist,
> skill-map drew no arrow and flagged it as a **broken reference**, confidence
> knocked to **0.50**. Adding `.md` turned it into a link that landed on the real
> file, and it drew a solid arrow at **1.00**.
>
> **IMPORTANT:** why does confidence matter? It mirrors how an agent resolves a
> reference, a deterministic name-and-path lookup, no guessing. That is cheaper
> and does not fail, the same reason a clean, well-named harness is worth keeping.
>
> Do you see every badge reading 1.00 in the Inspector?

Wait for confirmation. Mark `confidence`: done. Last chapter of the part: apply
§Closing a part (name the part by its title, route back to the menu; do NOT lead
into the next part from here).
