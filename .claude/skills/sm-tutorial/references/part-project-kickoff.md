# Part 1: The harness from zero (step library, `kickoff-*` ids)

The campaign turns real here. After the abstract prologue, the tester
starts an actual project: a tiny personal **portfolio website**,
fully static, served by a ~15-line Express server, plus the
`.claude/` **harness** that maintains it. skill-map maps the harness
(the `.md` assets and how they reference each other); the site itself
is plain HTML the harness produces (the daily loop, Part 2, runs and ships it).
This part runs end to end: it boots the project and grows its harness
members (the `kickoff` to `real-kinds` chapters), then wires them into a
connected graph, a link checker, a publish command, the handbook turned
hub, and a close-up on connector confidence (the `check-links` to
`confidence` chapters). `pace: per-step`, `preflight: portfolio-init`.
Shared conventions live in `_core.md`.

The orchestrator's `portfolio-init` pre-flight (backstage, silent)
has already laid the bare project skeleton before the tester runs
`sm init`: `server.js`, `package.json`, `public/index.html` (none of
which are `.md`, so the scan ignores them), the portfolio
`.skillmapignore`, and the handbook `AGENTS.md` (the one boot node).
The chapters grow the harness from there.

**Codex deltas (rich track).** When `tutorial.provider == codex`:

- `kickoff` / `manual`: identical flow (`sm init` then `sm`, no lens
  prompt, `.codex/` outranks the shared `.agents/` home). `CLAUDE.md`'s
  `@AGENTS.md` reference resolves the same (Codex has the `@`-directive).
  `AGENTS.md` is still the one boot node.
- `first-agent`: the `content-editor` is a **TOML agent** at
  `.codex/agents/content-editor.toml`, not a `.claude/agents/*.md` file; point
  the tester at the `.toml` if they want to peek. Its body references the style
  guide from the start (baked into `developer_instructions`), so lay
  `docs/STYLE.md` together with it (`fixtures.js lay portfolio --only
  "__PROVIDER__/agents/content-editor.md,docs/STYLE.md" --provider codex …`,
  the `--only` matches the TOML overlay by node id) so the
  `content-editor -> docs/STYLE.md` arrow resolves immediately instead of
  showing a transient broken-reference.
- `real-kinds`: Codex's kinds are `agent` (TOML) + `skill` + `markdown`, there is
  no `command`. Lay only `docs/DEPLOY.md` here (STYLE landed in `first-agent`),
  and name the kinds as agent + skill + markdown (the skill + the publish piece
  arrive later in this part as skills).
- `publish`: Codex has no `command` kind, so the tester creates a **skill** at `.agents/skills/publish/SKILL.md` instead of `.claude/commands/publish.md`. The body is the Codex one (same `/check-links` + `@content-editor` + deploy reference); fetch it with `fixtures.js cat harness --file "__PROVIDER__/skills/publish/SKILL.md" --provider codex --lang <lang>`. Tell the tester they are creating a `skill` (one node, three connectors); present it plainly as a skill, with no mention of a command or a substitution (per _core.md §Rendering the rich book on Codex, silent substitution). The fixture lays no `publish` for codex in this chapter (the tester authors it), so the `cat` is the source.
- `links`: the `content-editor-style` reference is baked into the Codex content-editor's TOML (`developer_instructions`) at lay time, so the `edit content-editor-style` step is a no-op on Codex, the `content-editor -> docs/STYLE.md` arrow is already drawn from earlier in this part. Run only `edit agents-hub` and narrate the two `AGENTS.md` arrows; mention the style-guide arrow as already present.

## Chapter `kickoff` - Start the portfolio (~2 min)

**Context**: same `sm init` the tester learned in the prologue, but
now on a real project. The map will show the project's harness, not
throwaway demo nodes.

If the prologue (`fundamentals`) ran first in this directory, the
demo fixture (`demo-agent`, `demo-skill`, `notes/…`) is still on
disk. The orchestrator's `portfolio-init` already cleared it during
pre-flight, so the tester sees only the portfolio. If anything demo
lingers, mention it once and move on.

**Context (agent, do not narrate the plumbing): the lens.** `sm init`
auto-detects the lens with no prompt: claude from its lone `.claude/`
marker, codex from `.codex/` (which outranks the shared `.agents/` open
default, so the extra `.agents/skills/` skill home does NOT trigger an
ambiguous prompt). The root `AGENTS.md` is the vendor-neutral handbook,
NOT a lens marker, so it never forces a prompt either. Do not promise the
tester a lens prompt here.

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
> Run `sm init`, it auto-detects the `claude` lens from the `.claude/`
> folder. Then run `sm` to boot the live UI.
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
> skill-map) that `CLAUDE.md` defers to the handbook.
>
> Did the connector light up?

Wait for confirmation. Mark `manual`: done.

## Chapter `first-agent` - The first harness agent (~2 min)

Lay the first harness agent (its content + translation live in
`fixtures-data/`). Backstage (silent):

```
node .claude/skills/sm-tutorial/scripts/fixtures.js lay portfolio --only "__PROVIDER__/agents/content-editor.md" --provider <provider> --lang <lang>
```

Tell the tester:

> I added the first real member of your harness: an agent called
> `content-editor` (its job is to write the site's pages). A new
> `agent` node appeared on the map. Right now it stands alone; later in
> this part we wire it to the handbook and the style guide.
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
> - **skill** and **command**: you add these later in this part (the
>   link checker and the publish command).
>
> Your handbook now has a real harness around it: a `content-editor`
> agent plus its docs, all on the map.
>
> See the agent and the docs in the map?

Wait for confirmation. Mark `real-kinds`: done.

## Chapter `check-links` - The link checker (~3 min)

**Context**: the harness needs a guard that runs before publishing, a skill that checks the site's internal links resolve before it ships. We only create the `skill` node here; the `publish` command in the next chapter is its caller.

Lay the `check-links` skill (its content + translation live in
`fixtures-data/`; this kind exists on every provider, so no skip).
Backstage (silent):

```
node .claude/skills/sm-tutorial/scripts/fixtures.js lay harness --only "__PROVIDER__/skills/check-links/SKILL.md" --provider <provider> --lang <lang>
```

Tell the tester:

> So I added that guard: a skill called `check-links`. A new `skill`
> node appeared on the **Map**, alone for now; the next chapter gives
> it a caller.
>
> See the new skill node?

Wait for confirmation. Mark `check-links`: done.

## Chapter `publish` - The publish command (~4 min)

**Context**: this is the chapter where the graph comes alive. The `/publish` command ties three pieces together in one body: it invokes the link checker, mentions the content editor, and references the deploy runbook. Three connectors light up from a single new node, one per link syntax.

Tell the tester to create the file themselves (it is their project's file, Inviolable rule #2). Substitute `<provider_dir>` per `_core.md` in the path you give them. Backstage, get the content: `node .claude/skills/sm-tutorial/scripts/fixtures.js cat harness --file "__PROVIDER__/commands/publish.md" --provider <provider> --lang <lang>`, then render it as a **top-level fenced code block**: at column 0, NOT inside the `> ` blockquote and with NO leading indentation, so the tester's copy keeps every line flush left. The frontmatter fences (`---`) MUST land on column 0. If the block is rendered (or pasted) indented, the opening and closing `---` shift off column 0, the YAML never parses, and the `publish` node loads body-only without its `name` / `description` (`sm check` then warns `frontmatter-malformed`). Present the block below exactly as written.

> Create `.claude/commands/publish.md` with exactly this content (the first line is `---`, nothing before it):

```markdown
---
name: publish
description: |
  Publishes the portfolio: runs the link check, hands off to the
  content editor for any last fixes, then follows the deploy runbook.
---

# publish

The one command you run when the site is ready to go out.

## Steps
1. Run /check-links on the pages in public/. If it reports broken links, stop and fix them first.
2. If a page needs a content fix, brief @content-editor with the change.
3. Follow the [deploy runbook](../../docs/DEPLOY.md): regenerate pages, run the link check, start the server.
```

Continue the tester message:

> Save it. Watch the **Map**: **three** new arrows light up at once
> from the new `publish` node, and each one is a different colour
> because each one is a different kind of link:
>
> - `publish -> check-links` (kind: `invokes`), from the `/check-links`
>   token in the body.
> - `publish -> content-editor` (kind: `mentions`), from the
>   `@content-editor` token.
> - `publish -> docs/DEPLOY.md` (kind: `references`), from the
>   `[deploy runbook](../../docs/DEPLOY.md)` markdown link.
>
> One node, three connectors, three link kinds. The harness is
> starting to look like a real graph.
>
> 💡 Tip: to tidy every node into a clean layout, click the
> **Re-arrange layout** button in the map toolbar. Handy whenever the
> graph starts to look crowded.
>
> Did the three arrows appear?

Wait for confirmation. You MAY use `Read` on the file afterwards to verify it landed, in particular that the opening and closing `---` are flush at column 0. If a later `sm check` flags `frontmatter-malformed` on `publish.md`, the fences got indented on paste: have the tester re-align every line flush left (strip the leading spaces so `---` is at column 0), then the next scan reads it clean. Mark `publish`: done.

## Chapter `links` - The handbook becomes the hub (~4 min)

**Context**: the handbook (`AGENTS.md`) has been a lonely node since the start of this part. Here it becomes the hub: we add two bullets so it mentions the content editor and invokes the publish command. We also give the content editor a reference to the style guide it follows. Several connectors land, and we recap the three link kinds and which syntax produced each.

Apply both edits (their content + translation live in `fixtures-data/`).
The first appends the two hub bullets to `AGENTS.md`; the second adds
the style-guide reference line to the content-editor. Backstage (silent):

```
node .claude/skills/sm-tutorial/scripts/fixtures.js edit agents-hub --provider <provider> --lang <lang>
node .claude/skills/sm-tutorial/scripts/fixtures.js edit content-editor-style --provider <provider> --lang <lang>
```

Tell the tester:

> Two edits, and the **Map** fills in. Your handbook (`AGENTS.md`) is
> now the hub: it points at the content editor and at the publish
> command. And the content editor now reaches the style guide it
> follows. New arrows:
>
> - `AGENTS.md -> content-editor` (kind: `mentions`), from `@content-editor`.
> - `AGENTS.md -> /publish` (kind: `invokes`), from `/publish`.
> - `content-editor -> docs/STYLE.md` (kind: `references`), from the
>   `[style guide](../../docs/STYLE.md)` markdown link.
>
> Here is the whole recap of the three link kinds, one per syntax:
>
> - an `@handle` token is always a **mention**.
> - a `/slash` token is always an **invoke**.
> - a `[text](path.md)` markdown link is always a **reference**.
>
> The kind comes purely from how you wrote it. Your harness is wired
> end to end now: the handbook reaches the work, the work reaches the
> docs, and `/publish` pulls the whole publish flow together.
>
> Did the new arrows light up?

Wait for confirmation. You MAY use `Read` on the two files afterwards to verify the edits landed before moving on. Mark `links`: done.

## Chapter `confidence` - How sure is each link (~3 min)

No file edits in this chapter, pure observation on the graph the tester just built.

Tell the tester:

> Last beat of this part: how sure is skill-map about each connection?
> It records a **confidence** for every link and draws it as opacity:
> a link that resolves to a real node is solid (**1.00**), a link that
> does not lands fainter, so a glance at the **Map** separates the
> solid wiring from the problem links.
>
> Open the Inspector for the `publish` node (click it on the **Map**).
> Scroll down to the **Connections** panel and read the **Outgoing**
> rows. Each row shows the link kind and a confidence badge, and here
> every one reads **1.00**:
>
> - `publish -> docs/DEPLOY.md` (`references`) is a markdown link to a
>   file that exists on disk, so skill-map is certain.
> - `publish -> content-editor` (`mentions`) resolves to the real
>   content-editor agent, and `publish -> check-links` (`invokes`)
>   resolves to the real check-links skill, so both are certain too.
>
> Your whole harness reads solid because every link lands on a real
> node, that is what a clean, fully wired graph looks like. So what
> does a link that does NOT resolve look like? You met one back in the
> prologue: `@demo-guideline` was a reference skill-map could not
> resolve, it had nothing to land on, so skill-map drew no arrow and
> flagged it as a **broken reference**, its confidence knocked down to
> **0.50** by the broken penalty. The fix was one character: adding
> `.md` (`@demo-guideline.md`) turned it into a file reference to the
> real `demo-guideline.md`, and it drew a solid arrow at **1.00**.
>
> **IMPORTANT:** why does confidence matter? It mirrors how the runtime itself
> resolves a reference: a deterministic name-and-path lookup, no guessing
> and no scanning the tree for a file under some other extension. That is
> cheaper and it does not fail, so the agent spends fewer tokens and less
> time, the same reason a clean, well-named harness is worth keeping.
>
> Do you see every badge reading 1.00 in the Inspector?

Wait for confirmation. Mark `confidence`: done. Last chapter of the part: apply §Closing a part (the close names the part by its title and routes back to the menu; do NOT lead into the next part from here).
