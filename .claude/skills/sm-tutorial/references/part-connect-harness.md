# Part 2: Connect the harness (step library, `connect-harness`)

This is the wiring part. Part 1 grew a small set of standalone nodes around the handbook (the portfolio harness); here the tester turns that scatter of dots into a connected graph: a link checker, a publish command that pulls three pieces together, the handbook becoming a real hub, and a close-up on how sure skill-map is of each connection. `pace: auto-advance` (walk straight into the next chapter once one is marked done), `preflight: seed` (it builds on the portfolio harness from Part 1, reusing the accumulated state when its predecessors are done, no fresh fixture of its own). Shared conventions (tone, provider detection / substitution, the `> ` rendering rule, the per-step cycle) live in `_core.md`; do not restate them here.

## Chapter `check-links` - The link checker (~3 min)

**Context**: the harness needs a guard that runs before publishing: a skill that walks every page and checks the internal links resolve. We only create it here (its first standalone `skill` node); the `publish` command in the next chapter is what invokes it.

`Write` `.claude/skills/check-links/SKILL.md` (substitute `<provider_dir>` per `_core.md`; this kind exists on every provider, so no skip):

```markdown
---
name: check-links
description: |
  Validates the portfolio's internal links before publishing. Walks
  every generated page and reports any link whose target is missing.
---

# check-links

The last gate before the site goes out.

## Steps
1. List every HTML file under `public/`.
2. For each page, collect its internal links (every `href` to `/` or to a `.html` file).
3. Check the target exists under `public/` (treat `/` as `public/index.html`).
4. Report any link whose target is missing; if none, report "0 broken links".
```

Tell the tester:

> I added a new helper to your harness: a skill called `check-links`
> (its job is to make sure every internal link on the site actually
> works before you publish). A new `skill` node appeared on the
> **Map**. It stands alone for now, in the next step we give it a
> caller.
>
> See the new skill node?

Wait for confirmation. Mark `check-links`: done.

## Chapter `publish` - The publish command (~4 min)

**Context**: this is the chapter where the graph comes alive. The `/publish` command ties three pieces together in one body: it invokes the link checker, mentions the content editor, and references the deploy runbook. Three connectors light up from a single new node, one per link syntax.

On `agent-skills` / Antigravity there is no `command` kind, so skip this whole chapter and fold its purpose into the prose of the next one.

Tell the tester to create the file themselves (it is their project's file, Inviolable rule #2). Substitute `<provider_dir>` per `_core.md` in the path you give them. The frontmatter fence (`---`) MUST sit on column 0 with no leading spaces: present the block below exactly as written, and if the tester pastes it indented, have them strip the leading whitespace. An indented `---` does not parse as YAML, so the `publish` node would land without its `name` or `description`.

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
> **Re-arrange layout** button in the map toolbar (tooltip
> "Re-arrange the visible nodes"). Handy whenever the graph starts to
> look crowded. If you've dragged nodes by hand it asks for
> confirmation first, otherwise it just re-arranges.
>
> Did the three arrows appear?

Wait for confirmation. You MAY use `Read` on the file afterwards to verify it landed. Mark `publish`: done.

## Chapter `links` - The handbook becomes the hub (~4 min)

**Context**: the handbook (`AGENTS.md`) has been a lonely node since Part 1. Here it becomes the hub: we add two bullets so it mentions the content editor and invokes the publish command. We also give the content editor a reference to the style guide it follows. Several connectors land, and we recap the three link kinds and which syntax produced each.

Apply both edits with `Edit` (do not rewrite the files).

**Edit `AGENTS.md`**: append these two bullets at the end of the body (substitute `<provider_dir>` only in prose, the link tokens below stay as written):

```markdown
- When a page needs writing or fixing, brief @content-editor.
- When the site is ready to go out, run /publish.
```

**Edit `.claude/agents/content-editor.md`**: add this line at the end of the body, after the `Rules:` line (substitute `<provider_dir>` per `_core.md`):

```markdown
Every page follows the [style guide](../../docs/STYLE.md).
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

**Context**: skill-map records how sure it is of every connection and shows that as opacity. In this harness every link resolves to a real node, so they all read solid (1.00); the broken-reference case is the one the tester met in the prologue (the bare `@demo-guideline` mention that resolved to no agent, drawn as no arrow and flagged `reference-broken` at 0.50). Here we open the Inspector on a real harness node, read the all-solid numbers, and point back to that prologue contrast. Mirrors the prologue's connectors beat on the portfolio.

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
> does a link that does NOT resolve look like? You saw one back in the
> prologue: `@demo-guideline` was a bare `@`-mention, and a bare
> `@handle` only resolves to an agent. `demo-guideline` is a note, so
> it had nothing to land on: skill-map drew no arrow and flagged it as
> a **broken reference**, its confidence knocked down to **0.50** by
> the broken penalty. The fix there was one character:
> `@demo-guideline2.md`, the same handle plus a `.md`, resolved to the
> real file and drew a solid arrow at **1.00**.
>
> So confidence here is really about resolution: **1.00** for a link
> that lands on a real node, **0.50** for one flagged broken. There is
> a third rung, **0.10**, for a link that resolves to a real file the
> runtime would ignore (a reserved name); you meet that one in the
> daily-loop part. The opacity on the canvas is just that number drawn
> as transparency.
>
> Do you see every badge reading 1.00 in the Inspector?

Wait for confirmation. Mark `confidence`: done. Last chapter of the part: apply §Closing a part (the close names the part by its title and routes back to the menu; do NOT lead into the next part from here).
