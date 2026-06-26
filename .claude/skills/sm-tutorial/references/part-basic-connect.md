# Part 2 (basic track): Connect the harness (step library, `connect-harness`)

The wiring part, basic track. Part 1 grew a small set of standalone nodes around
the handbook; here the tester turns that scatter into a connected graph: a link
checker, a publish skill that pulls three pieces together, the handbook becoming
a real hub, and a close-up on confidence. Every connector on this lens is a
**markdown reference** (`[text](path)`); there is no `/`-invoke or `@`-mention
here, those are rich-track features. `pace: auto-advance`, `preflight: seed`
(builds on the Part 1 harness; `harness-built`). Shared conventions live in
`_core.md`. Narrate with `<provider_dir>` = `.agents/skills`.

## Chapter `check-links` - The link checker (~3 min)

**Context**: the harness needs a guard that runs before publishing: a skill that
walks every page and checks the internal links resolve. We create it here (a
standalone `skill` node); the `publish` skill in the next chapter is what calls
it.

Lay the `check-links` skill (content lives in `fixtures-data/`). Backstage
(silent):

```
node .claude/skills/sm-tutorial/scripts/fixtures.js lay harness --only "__PROVIDER__/skills/check-links/SKILL.md" --provider <provider> --lang <lang>
```

Tell the tester:

> I added a new helper to your harness: a skill called `check-links` (its job is
> to make sure every internal link on the site works before you publish). A new
> `skill` node appeared on the **Map**. It stands alone for now, the next step
> gives it a caller.
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

**Context**: the handbook (`AGENTS.md`) has been a lonely node since Part 1. Here
it becomes the hub: two bullets point it at the content editor and the publish
skill. We also give the content editor a reference to the style guide it follows.

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

**Context**: skill-map records how sure it is of every connection and draws it as
opacity. In this harness every link resolves to a real file, so they all read
solid (1.00); the broken case is the one from the prologue (the `demo-guideline`
link with no `.md`, drawn as no arrow and flagged at 0.50, then fixed by hand).

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
> So confidence here is really about resolution: **1.00** for a link that lands on
> a real file, **0.50** for one flagged broken. The opacity on the canvas is just
> that number drawn as transparency.
>
> **Note:** why does confidence matter? It mirrors how an agent resolves a
> reference, a deterministic name-and-path lookup, no guessing. That is cheaper
> and does not fail, the same reason a clean, well-named harness is worth keeping.
>
> Do you see every badge reading 1.00 in the Inspector?

Wait for confirmation. Mark `confidence`: done. Last chapter of the part: apply
§Closing a part (name the part by its title, route back to the menu; do NOT lead
into the next part from here).
