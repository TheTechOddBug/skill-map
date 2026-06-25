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

**Context (agent, do not narrate the plumbing): the lens.** This
project has a root `AGENTS.md` (the `codex`/Codex marker) sitting next
to the `.claude/` folder (the `claude` marker, where the tutorial skill
itself lives). `codex` is **experimental** (ships disabled), though, so auto-detect
ignores its marker and `sm init` resolves the lens to `claude`
silently, exactly like the prologue: only `claude` is selectable today,
so there is no ambiguity and no prompt. Do not promise the tester a
lens prompt here.

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
> Run `sm init`, it auto-detects the `claude` lens (this is a Claude
> project; the other lenses are experimental). Then run `sm` to boot the
> live UI.
>
> Open the URL `sm` printed. You'll see **one node**: `AGENTS.md`,
> the project's handbook (the operating manual for the site).
> `server.js`, `package.json` and the HTML under `public/` are not
> `.md`, so skill-map leaves them out, it maps the harness, not the
> served files.
>
> See the handbook node? Then we start building.

Wait for confirmation. Mark `kickoff`: done.

## Chapter `manual` - The handbook (AGENTS.md) and CLAUDE.md (~2 min)

**Context**: the dogfood beat. Real Claude Code projects can
reference the generic `AGENTS.md` from their `CLAUDE.md` (this very
repo does). That one-line pointer is a real `references` link (the
`.md` extension makes `@AGENTS.md` a file pointer), the tester's first
connector on the real project.

Tell the tester to create the file themselves (it is their project's
file, Inviolable rule #2). Backstage, get the content:
`node .claude/skills/sm-tutorial/scripts/fixtures.js cat portfolio --file "CLAUDE.md" --provider <provider> --lang <lang>`,
then render it in the fenced block the tester copies:

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
> prologue), and since the handbook is right there
> the link resolves with full confidence. It tells anyone (and
> skill-map) that `CLAUDE.md` defers to the handbook. This is exactly
> how this tool's own repo is wired.
>
> Did the connector light up?

Wait for confirmation. Mark `manual`: done.

## Chapter `first-agent` - The first harness agent (~2 min)

Lay the first harness agent (its content + translation live in
`fixtures-data/`). The script resolves `__PROVIDER__`; on
`agent-skills` / Antigravity, which has no `agent` kind, adjust the
prose to the skill the set lays there. Backstage (silent):

```
node .claude/skills/sm-tutorial/scripts/fixtures.js lay portfolio --only "__PROVIDER__/agents/content-editor.md" --provider <provider> --lang <lang>
```

Tell the tester:

> I added the first real member of your harness: an agent called
> `content-editor` (its job is to write the site's pages). A new
> `agent` node appeared on the map. Right now it stands alone; in the
> next part we wire it to the handbook and the style guide.
>
> 💡 Tip: I create these harness files for you. If you'd like to see
> what's inside, open `<provider_dir>/agents/content-editor.md` in your
> editor, and feel free to peek at the files I add in the coming
> chapters too.
>
> See the new agent node?

Wait for confirmation. Mark `first-agent`: done.

## Chapter `real-kinds` - The real kinds in context (~2 min)

**Context**: the prologue showed the four kinds on abstract demo
nodes. Now name them on the real project, and add the two markdown
docs the harness references later (the style guide and the deploy
runbook), so the Daily Loop's maintenance beats have something to point at.

Lay the two markdown docs the harness references later (their content
+ translation live in `fixtures-data/`). Backstage (silent):

```
node .claude/skills/sm-tutorial/scripts/fixtures.js lay portfolio --only "docs/STYLE.md,docs/DEPLOY.md" --provider <provider> --lang <lang>
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
