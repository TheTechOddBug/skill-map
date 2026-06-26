# Part 1 (basic track): The project from zero (step library, `kickoff-*` ids)

The campaign turns real here for the **basic track** (the open-standard family:
`agent-skills`, `antigravity`). After the abstract prologue, the tester starts an
actual project: a tiny personal **portfolio website**, fully static, served by a
~15-line Express server, plus the `.agents/skills/` **harness** that maintains
it. skill-map maps the harness (the `.md` assets and how they reference each
other); the site itself is plain HTML the harness produces (the daily loop, Part
3, runs and ships it). This lens authors only **skills** and **markdown notes**,
and they connect by **markdown references** (`[text](path)`). `pace: per-step`,
`preflight: portfolio-init`. Shared conventions live in `_core.md`. Narrate with
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
> Right now it stands alone; in the next part we wire it to the handbook and the
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

Wait for confirmation. Mark `real-kinds`: done. Last chapter of the part: apply
§Closing a part (name the part by its title, route back to the menu; do NOT lead
into the next part from here).
