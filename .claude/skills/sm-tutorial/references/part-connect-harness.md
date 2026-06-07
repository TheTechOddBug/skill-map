# Part 2: Connect the harness (step library, `connect-harness`)

This is the wiring part. Part 1 grew a small set of standalone nodes around the handbook (the portfolio harness); here the tester turns that scatter of dots into a connected graph: a link checker, a publish command that pulls three pieces together, the handbook becoming a real hub, and a close-up on how sure skill-map is of each connection. `pace: auto-advance` (walk straight into the next chapter once one is marked done), `preflight: reuse` (it builds on the portfolio harness from Part 1, no fresh fixture of its own). Shared conventions (tone, provider detection / substitution, the `> ` rendering rule, the per-step cycle) live in `_core.md`; do not restate them here.

## Chapter `check-links` - The link checker (~3 min)

**Context**: the harness needs a guard that runs before publishing: a skill that walks every page and checks the internal links resolve. We only create it here (its first standalone `skill` node); the `publish` command in the next chapter is what invokes it.

`Write` `.claude/skills/check-links/SKILL.md` (substitute `<provider_dir>` per `_core.md`; this kind exists on every provider, so no skip):

```markdown
---
name: check-links
description: |
  Validates the portfolio's internal links before publishing. Walks
  every generated page and reports any link whose target is missing.
inputs:
  - name: root
    type: path
    description: Folder of generated pages to check.
    required: true
outputs:
  - name: report
    type: string
    description: List of broken links, empty when all resolve.
---

# check-links

Runs as the last gate before the site goes out. Reads each page under
the given root, follows every internal link, and reports the ones that
point at a file that does not exist.

## Steps
1. Read every page under `root`.
2. Collect the internal links from each page.
3. Report any link whose target is missing.
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

`Write` `.claude/commands/publish.md` (substitute `<provider_dir>` per `_core.md`; on `agent-skills` / Antigravity there is no `command` kind, so skip this whole chapter and fold its purpose into the prose of the next one):

```markdown
---
name: publish
description: |
  Publishes the portfolio: runs the link check, hands off to the
  content editor for any last fixes, then follows the deploy runbook.
shortcut: "ctrl+alt+p"
args:
  - name: root
    type: path
    description: Folder of generated pages to publish.
    required: true
---

# /publish

The one command you run when the site is ready to go out.

## Steps
1. Run /check-links on the generated pages first.
2. If anything needs a fix, brief @content-editor on it.
3. Follow the [deploy runbook](../../docs/DEPLOY.md) to ship.
```

Tell the tester:

> I added the `/publish` command, the single entry point you run when
> the site is ready to go live. Watch the **Map**: **three** new
> arrows light up at once from the new `publish` node, and each one is
> a different colour because each one is a different kind of link:
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
> Did the three arrows appear?

Wait for confirmation. Mark `publish`: done.

## Chapter `links` - The handbook becomes the hub (~4 min)

**Context**: the handbook (`AGENTS.md`) has been a lonely node since Part 1. Here it becomes the hub: we add two bullets so it mentions the content editor and invokes the publish command. We also give the content editor a reference to the style guide it follows. Several connectors land, and we recap the three link kinds and which syntax produced each.

Apply both edits with `Edit` (do not rewrite the files).

**Edit `AGENTS.md`**: append these two bullets at the end of the body (substitute `<provider_dir>` only in prose, the link tokens below stay as written):

```markdown
- When a page needs writing or fixing, brief @content-editor.
- When the site is ready to go out, run /publish.
```

**Edit `.claude/agents/content-editor.md`**: add this line to the body, right after the "Turns a short brief..." paragraph (substitute `<provider_dir>` per `_core.md`):

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

**Context**: the connectors do not all look equally solid, and that is on purpose. Skill-map estimates how sure it is of every connection and shows that as opacity. Here we open the Inspector on a real harness node and read the per-link confidence numbers, mirroring the prologue's connectors beat but on the portfolio.

No file edits in this chapter, pure observation on the graph the tester just built.

Tell the tester:

> Last beat of this part: how sure is skill-map about each connection?
> Look closely at the **Map** and you'll notice the arrows are not all
> equally solid. The more confident skill-map is that a link is real,
> the more solid the arrow; the less sure, the more translucent.
>
> Open the Inspector for the `publish` node (click it on the **Map**).
> Scroll down to the **Linked nodes** panel and read the **Outgoing**
> rows. Each row shows the link kind and a confidence badge:
>
> - `publish -> docs/DEPLOY.md` (`references`) reads **1.00** and looks
>   solid: it is a markdown link to a file that really exists on disk,
>   so skill-map is certain.
> - `publish -> content-editor` (`mentions`) and `publish ->
>   check-links` (`invokes`) read high too, because each `@handle` and
>   `/slash` token resolves cleanly to a node that exists in your
>   harness.
>
> The number is the certainty, and the opacity on the canvas is just
> that number drawn as transparency: a glance at the **Map** tells you
> which connections are rock solid and which are skill-map's best
> guess.
>
> Do you see the confidence badges in the Inspector?

Wait for confirmation. Mark `confidence`: done. This closes Part 2; the orchestrator returns to the ToC menu (Part 3, "Maintain the site", is next on the spine).
