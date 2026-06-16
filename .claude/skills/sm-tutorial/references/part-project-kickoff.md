# Part 1: The project from zero (step library, `kickoff-*` ids)

The campaign turns real here. After the abstract prologue, the tester
starts an actual project: a tiny personal **portfolio website**,
fully static, served by a ~15-line Express server, plus the
`.claude/` **harness** that maintains it. skill-map maps the harness
(the `.md` assets and how they reference each other); the site itself
is plain HTML the harness produces (the daily loop, Part 3, runs and ships it).
`pace: per-step`, `preflight: portfolio-init`. Shared
conventions live in `_core.md`.

The orchestrator's `portfolio-init` pre-flight (backstage, silent)
has already laid the bare project skeleton before the tester runs
`sm init`: `server.js`, `package.json`, `public/index.html` (none of
which are `.md`, so the scan ignores them), the portfolio
`.skillmapignore`, and the handbook `AGENTS.md` (the one boot node).
The chapters grow the harness from there.

## Chapter `kickoff` - Start the portfolio (~2 min)

**Context**: same `sm init` the tester learned in the prologue, but
now on a real project. The map will show the project's harness, not
throwaway demo nodes.

If the prologue (`fundamentals`) ran first in this directory, the
demo fixture (`demo-agent`, `demo-skill`, `notes/…`) is still on
disk. The orchestrator's `portfolio-init` already cleared it during
pre-flight, so the tester sees only the portfolio. If anything demo
lingers, mention it once and move on.

**Context (agent, do not narrate the plumbing): the lens prompt.**
Unlike the prologue (a pure `.claude/` project that auto-detected
`claude` silently), this project has a root `AGENTS.md` (a filesystem
marker for the `openai` lens) sitting next to the `.claude/` folder
(the `claude` marker, where the tutorial skill itself lives). With two
markers present, `sm init`'s first scan can NOT auto-pick a lens and
asks the tester to choose (`⚠ Multiple provider markers detected`).
The portfolio is a Claude project, so the answer is `claude`. The
prompt is expected, blessed behaviour; the tester just needs to know
which option to pick, so the message below previews it.

```bash
sm init
sm
```

Tell the tester:

> This is a real project now: a small **portfolio website**. It's
> static HTML served by a tiny Express server (`server.js`), and the
> `.claude/` folder is the **harness** (the helpers that maintain the
> site). skill-map maps that harness.
>
> Run `sm init`. This folder has both a root `AGENTS.md` and a
> `.claude/` folder, so skill-map can't tell on its own which runtime
> you're authoring for and asks:
> `⚠ Multiple provider markers detected. Pick the active lens: 1) claude 2) openai`.
> Type `1` (or `claude`) and press Enter, this is a Claude project.
> Then run `sm` to boot the live UI.
>
> Open the URL `sm` printed. You'll see **one node**: `AGENTS.md`,
> the project's handbook (the operating manual for the site).
> `server.js`, `package.json` and the HTML under `public/` are not
> `.md`, so skill-map leaves them out, it maps the harness, not the
> served files.
>
> See the handbook node? Then we start building.

Wait for confirmation. Mark `kickoff`: done.

## Chapter `manual` - The handbook and CLAUDE.md (~2 min)

**Context**: the dogfood beat. Real Claude Code projects keep a
`CLAUDE.md` that just points at `AGENTS.md` (this very repo does).
That one-line pointer is a real `references` link (the `.md` extension
makes `@AGENTS.md` a file pointer, not a bare mention), the tester's
first connector on the real project.

Tell the tester to create the file themselves (it is their project's
file, Inviolable rule #2):

> Create a file called `CLAUDE.md` at the project root with exactly
> this content:
>
> ```markdown
> @AGENTS.md
> ```
>
> Save it. Watch the map: a new `CLAUDE.md` node appears, with a
> `references` connector pointing at `AGENTS.md`, solid at 1.00.
> Because `@AGENTS.md` carries the `.md` extension, skill-map reads it
> as a file pointer (the same `@name.md` reference you met in the
> prologue, not a bare mention), and since the handbook is right there
> the link resolves with full confidence. It tells anyone (and
> skill-map) that `CLAUDE.md` defers to the handbook. This is exactly
> how this tool's own repo is wired.
>
> Did the connector light up?

Wait for confirmation. Mark `manual`: done.

## Chapter `first-agent` - The first harness agent (~2 min)

**Context**: the harness's job is content creation. Its first member
is `content-editor`, an agent that writes the site's HTML pages. Here
we only create it (the cross-references come in the next part).

`Write` `.claude/agents/content-editor.md` (substitute
`<provider_dir>` per `_core.md`; on `agent-skills` / Antigravity,
which has no `agent` kind, create a `skill` instead and adjust the
prose):

```markdown
---
name: content-editor
description: |
  Writes and edits the portfolio's pages. Reads a brief, follows the
  style guide, and emits the HTML into public/.
tools: [Read, Write]
model: sonnet
---

# content-editor

Turns a short brief into a finished portfolio page.

## How to write a page
1. Read the style guide and the shared stylesheet in public/.
2. Write one HTML file under public/, named after the page (a projects page becomes `public/projects.html`).
3. Start from `<!doctype html>`, link the stylesheet with `<link rel="stylesheet" href="/style.css">`, and set a `<title>`.
4. Use one `<h1>`, group sections under `<h2>`, and reuse the shared header, nav, and footer so every page matches.
5. Add a link back to Home, and link the new page from the home nav.

Rules: plain static HTML, no framework, no client JS, one page per file.
```

Tell the tester:

> I added the first real member of your harness: an agent called
> `content-editor` (its job is to write the site's pages). A new
> `agent` node appeared on the map. Right now it stands alone; in the
> next part we wire it to the handbook and the style guide.
>
> See the new agent node?

Wait for confirmation. Mark `first-agent`: done.

## Chapter `real-kinds` - The real kinds in context (~2 min)

**Context**: the prologue showed the four kinds on abstract demo
nodes. Now name them on the real project, and add the two markdown
docs the harness references later (the style guide and the deploy
runbook), so the Daily Loop's maintenance beats have something to point at.

`Write` two docs (markdown kind):

`docs/STYLE.md`:
```markdown
---
name: style-guide
description: |
  Writing and markup conventions every portfolio page follows.
---

# Style guide

## Voice
- Short, plain sentences. No marketing fluff.

## Structure
- One H1 per page; sections under H2.
- Every page shares the same header, nav, and footer.
- Every page links back to Home.

## Markup
- Plain static HTML: no framework, no client JS.
- Link the shared stylesheet `/style.css` in every page head.
- Use semantic tags: header, nav, main, footer.
```

`docs/DEPLOY.md`:
```markdown
---
name: deploy-runbook
description: |
  How the portfolio gets published once the pages are written.
---

# Deploy runbook

1. Generate or update the pages in public/.
2. Run the link check and fix anything it reports.
3. Start the server with `node server.js`, then open the site in your browser.
```

Tell the tester:

> Two more nodes joined the map, both `markdown` (the catch-all kind
> for `.md` files that are not an agent, skill, or command):
> `docs/STYLE.md` (the style guide) and `docs/DEPLOY.md` (the deploy
> runbook). So now you have the real four kinds in front of you:
>
> - **agent**: `content-editor` (does work on your behalf).
> - **markdown**: `AGENTS.md`, `CLAUDE.md`, the two docs (plain notes
>   and manuals).
> - **skill** and **command**: you add these (the link checker and
>   the publish command) in a later part.
>
> Your handbook now has a real harness around it: a `content-editor`
> agent plus its docs, all on the map.
>
> See the agent and the docs in the map?

Wait for confirmation. Mark `real-kinds`: done. Last chapter of the
part: apply §Closing a part (the close names the part by its title and
routes back to the menu; do NOT lead into the next part from here).
