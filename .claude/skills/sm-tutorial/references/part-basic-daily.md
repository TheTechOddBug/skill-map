# Part 3 (basic track): The daily loop (step library, `daily-loop`)

The campaign's payoff and finale, basic track. The tester operates the harness
they built the way they would on any normal day, **for real**. Three acts:
**add** content, **modify / improve** it (where skill-map earns its keep), and
**publish** it. The `content-editor` and the publish flow run for real, no
role-play. Every connector on this lens is a **markdown reference**. `pace:
auto-advance`, `preflight: seed` (`harness-connected`, so a tester can jump
straight here). Shared conventions (tone, the `> ` rendering rule, the per-step
cycle, §Closing a part, §Final wrap-up) live in `_core.md`. Narrate with
`<provider_dir>` = `.agents/skills`.

**The site is the tester's.** The `setup` chapter asks who it is for and builds
it around that answer. Identity lives in Layer 2 (the HTML / CSS under
`public/`), which skill-map does not map, so the graph stays identical no matter
what the tester names their portfolio. Persist the answer with
`state.js set-identity --name "<name>" --tagline "<tagline>"`.

**Real-execution contract (read once).** When invoking the `content-editor`
skill via the Task tool, instruct it to write ONLY `.html` files under `public/`,
to NOT create any `.md` file, and to NOT touch the harness. After it runs, `Read`
what it wrote before telling the tester what landed. If the subagent is not
invocable, act as the `content-editor` yourself following its steps and
`docs/STYLE.md`.

**Live-map note (read once).** Every chapter is watched on the live **Map**, so
`sm` MUST be running before you start. If the tester entered via seed or closed
it, have them run `sm` from the project root and open the URL first. This part
has NO `sm scan` / `sm check` steps: the watcher re-scans on every save.

---

**Act A - Add**

## Chapter `setup` - Make it yours and bring it up (~5 min)

**Context**: the harness is wired. Now put it to work on a real day. First make
the site yours and give it a look you would share, then serve it. The HTML and
CSS are Layer 2 (the harness's output); skill-map maps the harness (Layer 1, the
`.md` files), so the site landing on disk does NOT move the graph.

**Preparation**:
1. Ask the tester, in one short exchange: what the site should be called and one
   line about what it is for. If they do not care, offer defaults ("My Portfolio"
   / "Small, sturdy things on the web"). Persist both with
   `node .claude/skills/sm-tutorial/scripts/state.js set-identity --name "<name>" --tagline "<tagline>"`.
2. Backstage, `Write` `public/style.css`, `public/index.html`, and
   `public/about.html` from the templates in the rich daily-loop's `setup`
   chapter (`part-daily-loop.md`), they are Layer 2, identical on every lens, so
   reuse them verbatim, substituting the identity into the HTML.

The site is styled now, so bring it up. `sm` is still running, so the server
needs a **third terminal** in the same folder:

```bash
npm install
node server.js
```

> **Note:** I gave your site a face: a shared stylesheet plus a styled **Home**
> and **About** page, named after you. These are Layer 2 (the harness's output),
> so the **Map** did not move, and that is correct: skill-map maps the harness
> (the `.md` files, Layer 1), not the HTML it produces.
>
> Now bring your site up. Open a **third terminal** in this same folder and run
> the two commands. `npm install` pulls Express, and `node server.js` starts it
> and prints `Listening on http://localhost:3000`.
>
> Open `http://localhost:3000`: there is your site, named after you. Click
> **About** and back to **Home**.
>
> Now glance at the Map: it did not move. What you watched grow is your harness
> (Layer 1, the `.md` files and their references). The pages and stylesheet are
> Layer 2, what the harness produces. Two layers, one project.
>
> Does the site load and look clean?

Wait for confirmation. If `node server.js` reports `Cannot find module
'express'`, run `npm install` first. Mark `setup`: done. Auto-advance to
`add-page`.

## Chapter `add-page` - Add a page with your skill (~4 min)

**Context**: the daily move. You want a new page, so you ask your
`content-editor` to write it, the first time it runs **for real**. It reads
`docs/STYLE.md` and the shared stylesheet and writes a new page into `public/`.
The graph does not move (HTML is Layer 2).

Tell the tester:

> Your turn to delegate, the way you would on a real day. Tell me what page to
> add, in your own words ("add a projects page", "add a page about my talks").
> I'll hand it to your `content-editor` skill and let it write the page.

When the tester answers, invoke the project's `content-editor`
(`<provider_dir>/content-editor/SKILL.md`) via the Task tool, honouring the
real-execution contract: write ONE new `.html` page under `public/` named after
the topic (default `public/projects.html`), following the skill's steps and
`docs/STYLE.md`, and add the new page to the home nav. Do NOT write any `.md`.
Then `Read` the file it produced.

Report back using the block below (adapt the page name; keep the ENTIRE report
inside the `> ` blockquote):

> Your `content-editor` ran for real and wrote `public/projects.html`, linked
> from the home nav. Refresh the site: the new page is there, in the same style.
>
> Now glance at the Map: same nodes as before, nothing new. The page is Layer 2
> output; the harness on the canvas is Layer 1. Your nodes are not a diagram,
> they are runnable, and you just ran one.
>
> See the new page on the site, and the Map unchanged?

Wait for confirmation. Mark `add-page`: done. Auto-advance to `broken-ref`.

---

**Act B - Modify / improve**

## Chapter `broken-ref` - A rename breaks a link (~4 min)

**Context**: real reorganizing breaks things, and this is where skill-map earns
its keep. You rename a doc, and a link that pointed at the old name goes stale.
skill-map catches it the moment the watcher re-scans.

**Preparation**: none (the tester drives). Everything is watched live.

Tell the tester to rename the deploy runbook (their file):

```bash
mv docs/DEPLOY.md docs/DEPLOYMENT.md
```

> You renamed the deploy runbook, but the `publish` skill still links to the old
> path. Watch the **Map**: the `publish -> docs/DEPLOY.md` arrow disappears (a
> broken link resolves to no node, so skill-map stops drawing it) and the
> `publish` card gets a red **broken-reference** marker. Open the `publish`
> inspector and the broken reference is listed there.
>
> Now fix it the way you would for real: open `<provider_dir>/publish/SKILL.md`
> and point the deploy-runbook link at `docs/DEPLOYMENT.md` (the new name). Save.
>
> Watch the **Map** again: the arrow snaps back, solid, and the red marker
> clears, all live. That is the daily safety net: rename and move things freely,
> and skill-map shows you exactly what you forgot to update before it ships
> broken.
>
> Did the broken marker appear and then clear?

Wait for confirmation. The harness MUST be clean again before Act C. Mark
`broken-ref`: done. Auto-advance to `reserved`.

## Chapter `reserved` - A reserved name collides (~2 min)

**Context**: you add a quick helper skill and, without thinking, name it
`config`, a name the agent runtime already owns for its own built-in slash verb.
skill-map warns you before the runtime silently ignores your skill.

**Preparation**: `Write` `<provider_dir>/config/SKILL.md`:
```markdown
---
name: config
description: |
  Scaffolds a new empty page in public/ from the shared template.
---

# config

Creates a blank page so you can start writing.
```

The watcher picks up the new skill. Tell the tester:

> I added a skill named `config`. Watch the **Map**: the new `config` skill node
> appears, but flagged with a **warning** marker. Open its inspector: it reads
> `name-reserved`, `config` shadows one of the agent runtime's own built-in verbs
> (like `help`, `clear`, `model`), so the runtime would silently ignore your
> skill, it never runs. The fix is a name the runtime does not own.
>
> Rename it to `new-page`: first rename the folder `<provider_dir>/config/` to
> `<provider_dir>/new-page/`. Then open `new-page/SKILL.md` and, at the top where
> the frontmatter says `name: config`, change it to `name: new-page`; also change
> the H1 to `# new-page`. Save.
>
> Watch the **Map** again: the warning clears and the node is now `new-page`, all
> live. Notice what cleared it: changing the **name** (`frontmatter.name`), which
> for a skill must match its folder, so you rename both. Now `new-page` is yours
> and the runtime will actually run it.
>
> Did the warning clear after the rename?

Wait for confirmation. Mark `reserved`: done. Auto-advance to `publish`.

---

**Act C - Publish**

## Chapter `publish` - Ship it: run the publish skill for real (~4 min)

**Context**: the harness is a set of instructions, and the `publish` skill ties
them together. You run it **for real**: it runs the link checker over your pages,
hands off to the `content-editor` if anything needs a fix, then follows the
deploy runbook. Same Layer 1 / Layer 2 split, the pages are output, so the Map
stays put while the pipeline runs.

**Preparation**: make sure the pages exist (`index`, `about`, `projects`). When
the tester asks to publish, **execute the publish flow for real** by following
`<provider_dir>/publish/SKILL.md`: run the `check-links` logic over every `.html`
under `public/` (does each internal `href` resolve to a file that exists?); if
any link is broken, hand it to the `content-editor` and re-run; then walk the
deploy runbook. Do not role-play it.

Tell the tester:

> The site is ready. Tell me to publish and I'll run your `publish` skill for
> real: I follow its steps, run the link check across your pages, fix anything
> through the `content-editor`, and walk the deploy runbook, exactly what the
> skill says to do.

After running the flow, report what actually happened (keep promises conditional
on the real result):

> Here is what just ran, for real:
>
> - **check-links** walked every page under `public/` and followed each internal
>   link. Result: 0 broken links. (Had it found one, the next step would hand it
>   to `content-editor` to fix, then re-check.)
> - the **deploy runbook** (`docs/DEPLOYMENT.md`) lists the ship steps:
>   regenerate the pages (done), run the link check (done), start the server
>   (next chapter).
>
> And the Map did not move while the pipeline ran: the pages are Layer 2 output;
> the harness on the canvas is Layer 1.
>
> The link check came back clean and `publish` is wired correctly across your
> pages. Shall we continue?

Wait for confirmation. Mark `publish`: done. Auto-advance to `stability`.

## Chapter `stability` - Set a node's stability (and the `.sm` sidecar) (~3 min)

**Context**: real maintenance includes marking how mature each piece is. skill-map
lets you tag a node's **stability** from the inspector. That is skill-map's own
metadata, so it lands in a co-located **`.sm` sidecar** next to the file (the
vendor file stays untouched), and the first `.sm` write asks for your consent.

This chapter is lens-agnostic: follow the `stability` chapter in the rich
daily-loop (`part-daily-loop.md`) verbatim, marking the `AGENTS` handbook node
`stable` from the inspector, confirming the consent dialog, and watching the
`stable` badge plus the `AGENTS.sm` sidecar appear. Nothing here depends on the
lens.

Mark `stability`: done. Auto-advance to `golive`.

## Chapter `golive` - Your portfolio, live next to the graph (~3 min)

**Context**: the climax. Serve the finished multi-page site and click through it,
ending with the running portfolio on one side and the full harness graph on the
other. Lens-agnostic: follow the `golive` chapter in the rich daily-loop
(`part-daily-loop.md`) verbatim (the serve commands and the closing congratulation
are identical), except when you name the harness pieces on the graph, say "the
handbook, the content-editor, the style guide, the publish skill, the link
checker, the deploy runbook" (all skills + notes on this lens, no command).

Mark `golive`: done. Last chapter of the part: apply §Closing a part; since this
closes the campaign spine, if every active part is now done route to the §Final
wrap-up instead of the menu.
