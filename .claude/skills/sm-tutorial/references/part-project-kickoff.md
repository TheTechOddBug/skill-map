# Part 1: The project from zero (step library, `kickoff-*` ids)

The campaign turns real here. After the abstract prologue, the tester
starts an actual project: a tiny personal **portfolio website**,
fully static, served by a ~15-line Express server, plus the
`.claude/` **harness** that maintains it. skill-map maps the harness
(the `.md` assets and how they reference each other); the site itself
is plain HTML the harness produces (Part 5 generates it and runs the
server). `pace: per-step`, `preflight: portfolio-init`. Shared
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
That one-line pointer is a real `mentions` link, the tester's first
connector on the real project.

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
> `mentions` connector pointing at `AGENTS.md`. The `@name` token is
> the same mention syntax from the prologue, now doing real work: it
> tells anyone (and skill-map) that `CLAUDE.md` defers to the
> handbook. This is exactly how this tool's own repo is wired.
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

Turns a short brief into a finished portfolio page. Follows the
conventions in the style guide and writes the result as static HTML
under public/.

Rules:
- One page per file under public/.
- Keep the markup plain; no framework, no client JS.
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
runbook), so Part 3's maintenance beats have something to point at.

`Write` two docs (markdown kind):

`docs/STYLE.md`:
```markdown
---
name: style-guide
description: |
  Writing and markup conventions every portfolio page follows.
tags: [docs, portfolio]
---

# Style guide

- Short, plain sentences. No marketing fluff.
- One H1 per page; sections under H2.
- Every page links back to the home page.
```

`docs/DEPLOY.md`:
```markdown
---
name: deploy-runbook
description: |
  How the portfolio gets published once the pages are written.
tags: [docs, portfolio]
---

# Deploy runbook

1. Generate the pages into public/.
2. Run the link check.
3. Start the server: `node server.js`.
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
> - **skill** and **command**: coming in the next part, when we add
>   the link checker and the publish command and wire everything
>   together.
>
> Your handbook now has a real harness around it. Next we connect it:
> the agent reaching the style guide, the command invoking the
> skill, the whole graph lighting up.
>
> Ready to connect the harness?

Wait for confirmation. Mark `real-kinds`: done. This closes Part 1;
the orchestrator returns to the ToC menu (Part 2, "Connect the
harness", is next on the spine).
