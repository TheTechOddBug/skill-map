# Part 3: The daily loop (step library, `daily-loop`)

The campaign's payoff and finale fused into one part: the tester operates the
harness they built the way they would on any normal day, **for real**. Three
acts: **add** content, **modify / improve** it (where skill-map earns its
keep), and **publish** it through the real pipeline. Every agent, skill, and
command runs for real, no role-play: the orchestrator invokes the
`content-editor` via the Task tool, and the publish + link-check flow actually
executes. `pace: auto-advance`, `preflight: seed` (`harness-connected`, so a
tester can jump straight here). Shared conventions (tone, provider detection /
substitution, the `> ` rendering rule, the per-step cycle, §Closing a part,
§Final wrap-up) live in `_core.md`; do not restate them.

**The site is the tester's.** The `setup` chapter asks who it is for and builds
it around that answer. Identity lives in Layer 2 (the HTML / CSS under
`public/`), which skill-map does not map, so the graph stays identical no matter
what the tester names their portfolio. Persist the answer with
`state.js set-identity --name "<name>" --tagline "<tagline>"` (it records
`tester.site_identity` in `tutorial-state.json`).

**Provider note (read once).** Substitute `.claude/` with the detected
`<provider_dir>`. On `agent-skills` / Antigravity the `content-editor` is a
**skill**, not an agent (invoke it as a skill); there is no `command` kind, so
the `reserved` chapter is skipped and the `broken-ref` / `publish` chapters use
their agent-skills variant (notes inline).

**Real-execution contract (read once).** When invoking the `content-editor` via
the Task tool, instruct it explicitly to write ONLY `.html` files under
`public/`, to NOT create any `.md` file, and to NOT touch the harness or its own
definition. After it runs, `Read` what it wrote before telling the tester what
landed (this keeps the node-count promises honest). If the subagent is not
invocable in the tester's setup, act as the `content-editor` yourself following
its rules and `docs/STYLE.md`, so the beat still lands.

---

**Act A - Add**

## Chapter `setup` - Make it yours, make it presentable (~3 min)

**Context**: the harness is wired (you built it in the earlier parts). Now you
put it to work on a real day. First, make the site yours and give it a look you
would not be embarrassed to share. The honest beat: the HTML and CSS are
Layer 2 (the harness's output); skill-map maps the harness (Layer 1, the `.md`
files), so the site landing on disk does NOT move the graph, and that is
correct, not a bug.

**Preparation**:

1. Ask the tester, in one short exchange: what the site should be called (their
   name or a title) and one line about what it is for. Keep it light; if they do
   not care, offer defaults ("My Portfolio" / "Small, sturdy things on the
   web"). Persist both with
   `node .claude/skills/sm-tutorial/scripts/state.js set-identity --name "<name>" --tagline "<tagline>"`
   (it writes `tester.site_identity` into `tutorial-state.json`).
2. Backstage, `Write` `public/style.css` exactly as below (Layer 2, ignored by
   the scan; one stylesheet shared by every page).
3. `Write` `public/index.html` and `public/about.html` from the templates below,
   substituting the identity. These overwrite the placeholder `public/index.html`
   the kickoff left.

`public/style.css`:
```css
:root {
  --bg: #fbfbfa; --surface: #fff; --ink: #1a1a1a; --ink-soft: #585858;
  --accent: #3b5bdb; --border: #e7e7e3; --radius: 10px; --maxw: 46rem;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14151a; --surface: #1c1e26; --ink: #f0f0f2; --ink-soft: #a0a3ad;
    --accent: #8aa1ff; --border: #2a2d38;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--ink); line-height: 1.65;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: var(--maxw); margin: 0 auto; padding: 0 1.25rem; }
header.site { border-bottom: 1px solid var(--border); padding: 1.4rem 0; margin-bottom: 2.5rem; }
header.site .wrap { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.brand { font-weight: 700; font-size: 1.15rem; letter-spacing: -0.01em; text-decoration: none; color: var(--ink); }
nav a { color: var(--ink-soft); text-decoration: none; margin-left: 1.25rem; font-size: 0.95rem; transition: color 0.15s ease; }
nav a:hover { color: var(--accent); }
main { padding-bottom: 4rem; }
h1 { font-size: 2.4rem; line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 0.4rem; }
h2 { font-size: 1.3rem; margin: 2.5rem 0 0.75rem; letter-spacing: -0.01em; }
.tagline { font-size: 1.2rem; color: var(--ink-soft); margin: 0 0 2rem; }
p { margin: 0 0 1.1rem; }
a { color: var(--accent); }
ul.cards { list-style: none; padding: 0; display: grid; gap: 1rem; }
ul.cards li { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 1.1rem 1.25rem; }
ul.cards h3 { margin: 0 0 0.3rem; font-size: 1.05rem; }
ul.cards p { margin: 0; color: var(--ink-soft); font-size: 0.95rem; }
footer.site { border-top: 1px solid var(--border); padding: 2rem 0; color: var(--ink-soft); font-size: 0.9rem; }
@media (max-width: 30rem) {
  h1 { font-size: 1.9rem; }
  header.site .wrap { flex-direction: column; gap: 0.5rem; }
  nav a { margin: 0 1.25rem 0 0; }
}
```

`public/index.html` (substitute `[NAME]`, `[TAGLINE]`, `[INTRO]` with the identity):
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>[NAME]</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <header class="site">
      <div class="wrap">
        <a class="brand" href="/">[NAME]</a>
        <nav>
          <a href="/">Home</a>
          <a href="/about.html">About</a>
        </nav>
      </div>
    </header>
    <main class="wrap">
      <h1>[NAME]</h1>
      <p class="tagline">[TAGLINE]</p>
      <p>[INTRO]</p>
    </main>
    <footer class="site"><div class="wrap">© [NAME]</div></footer>
  </body>
</html>
```

`public/about.html` (same shell, substitute `[NAME]` and a short `[ABOUT]`):
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>About · [NAME]</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <header class="site">
      <div class="wrap">
        <a class="brand" href="/">[NAME]</a>
        <nav>
          <a href="/">Home</a>
          <a href="/about.html">About</a>
        </nav>
      </div>
    </header>
    <main class="wrap">
      <h1>About</h1>
      <p>[ABOUT]</p>
    </main>
    <footer class="site"><div class="wrap">© [NAME]</div></footer>
  </body>
</html>
```

Then tell the tester to serve it (the tester runs these; do not run them):

```bash
npm install
node server.js
```

> Your portfolio has a face now. `npm install` pulls the one small library the
> server needs (Express, on the Node you already have), and `node server.js`
> starts it and prints a line like `Listening on http://localhost:3000`.
>
> Open `http://localhost:3000`: there is your site, named after you, with a
> clean layout. Click **About** and back to **Home**.
>
> Now glance at the Map: it did not move. Everything you watched grow on the
> canvas is your harness, the `.md` files and how they reference each other
> (Layer 1). The pages and the stylesheet are Layer 2, what the harness
> produces, and skill-map maps the harness, not its output. Two layers, one
> project.
>
> Does the site load and look clean?

Wait for confirmation. Mark `setup`: done. Auto-advance to `add-page`.

## Chapter `add-page` - Add a page with your agent (~4 min)

**Context**: the daily move. You want a new page, so you ask your
`content-editor` to write it. This is the first time it runs **for real** (no
more playing the agent). It reads `docs/STYLE.md` and the shared stylesheet and
writes a new page into `public/`. The graph does not move (HTML is Layer 2).

**Preparation**: none until the tester asks.

Tell the tester:

> Your turn to delegate, the way you would on a real day. Tell me what page to
> add, in your own words, for example "add a projects page" or "add a page about
> my talks". I'll hand it to your `content-editor` agent and let it write the
> page.

When the tester answers, invoke the project's `content-editor` (the
`<provider_dir>/agents/content-editor.md` agent, or the skill on `agent-skills`)
via the Task tool, honouring the real-execution contract above: write ONE new
`.html` page under `public/` named after the topic (default `public/projects.html`),
following the agent's own steps and `docs/STYLE.md` (the shared shell, link
`/style.css`, one `<h1>`, a nav link back to Home), and add the new page to the
home nav. Do NOT write any `.md`, do NOT touch the harness. Then `Read` the file
it produced.

> Your `content-editor` ran for real and wrote `public/projects.html`, linked
> from the home nav. Refresh the site: the new page is there, in the same style
> as the rest.
>
> Now glance at the Map: same nodes as before, nothing new. The page is Layer 2
> output; the harness on the canvas is Layer 1. Your nodes are not a diagram,
> they are runnable, and you just ran one.
>
> See the new page on the site, and the Map unchanged?

Wait for confirmation. Mark `add-page`: done. Auto-advance to `orphan-draft`.

## Chapter `orphan-draft` - A page nobody links to yet (~2 min)

**Context**: mid-day you jot an idea for the next page but do not wire it up yet.
skill-map shows it as an **orphan**: a real node with nothing pointing at it.

**Preparation**: `Write` `docs/draft.md` (markdown kind):
```markdown
---
name: draft
description: |
  A rough idea for the next page. Not linked from anywhere yet.
---

# Draft

Notes toward a posts page. Nothing wired up.
```

Tell the tester to run:

```bash
sm scan
sm show docs/draft.md
```

> A new `docs/draft` node appeared on the Map as a floating dot, no arrows in or
> out. `sm show docs/draft.md` has no "Links in" section: nothing references it.
> That is an **orphan**, a valid node with no incoming links.
>
> An orphan is NOT an error: run `sm check` and the harness still reads clean.
> It is just a node nobody points at yet. Keep three ideas apart: an **orphan**
> (a real node, no incoming link), a **broken reference** (a link with no target
> on the other end), and an **issue** (a rule violation `sm check` flags). You
> will meet the other two in a moment.
>
> See the floating dot, and the empty "Links in"?

Wait for confirmation. Mark `orphan-draft`: done. Auto-advance to `wire-and-improve`.

---

**Act B - Modify / improve**

## Chapter `wire-and-improve` - Wire the draft in (~3 min)

**Context**: you turn the draft into a real page and link it, so it stops being
an orphan. Two moves: the `content-editor` writes the actual page (Layer 2), and
you add a link to the draft note from the handbook (Layer 1), which gives the
orphan an incoming edge.

**Preparation**: invoke the `content-editor` via the Task tool (real-execution
contract) to write `public/posts.html` from the draft idea (a couple of short
sample posts, shared shell, nav link back to Home). `Read` it afterwards.

Then tell the tester to wire the note in (their file, Inviolable rule #2):

> Two moves to close the loop on that draft. First, I had your `content-editor`
> turn it into a real page: `public/posts.html` now exists (Layer 2, so the Map
> stays put for it). Second, your turn: open `AGENTS.md` and add this line to
> the body, so the handbook actually points at the draft note:
>
> ```markdown
> - The next page started as notes in [draft](docs/draft.md).
> ```
>
> Save it, then re-scan and look at the draft again:

```bash
sm scan
sm show docs/draft.md
```

> `docs/draft` is no longer an orphan: `sm show` now lists `Links in (1)
> ← references AGENTS.md`, and on the Map the floating dot is connected to the
> handbook. One incoming link is all it took to fold it into the graph.
>
> Did the draft connect to the handbook?

Wait for confirmation. Mark `wire-and-improve`: done. Auto-advance to `broken-ref`.

## Chapter `broken-ref` - A rename breaks a link (~4 min)

**Context**: real reorganizing breaks things, and this is where skill-map earns
its keep. You rename a doc, and a link that pointed at the old name goes stale.
skill-map catches it the moment you re-scan.

On `agent-skills` / Antigravity there is no `/publish` command holding the deploy
link; use the variant in the note at the end of this chapter (rename
`docs/STYLE.md` to break the `content-editor`'s style-guide reference instead).

**Preparation**: none (the tester drives).

Tell the tester to rename the deploy runbook (their file):

```bash
mv docs/DEPLOY.md docs/DEPLOYMENT.md
sm scan
sm check
```

> You renamed the deploy runbook, but `/publish` still links to the old path.
> `sm check` flags it:
>
> ```
> sm check: 1 error
>
>   .claude/commands/publish.md
>     ✕  reference-broken   Broken references reference → docs/DEPLOY.md
> ```
>
> That is the `reference-broken` analyzer: a link whose target no longer exists.
> On the Map the `publish → docs/DEPLOY.md` arrow has disappeared: a broken link
> resolves to no node, so skill-map stops drawing it and flags the `publish` card
> with a red error instead. `sm check` runs the full analyzer catalogue (around a
> dozen rules); to narrow it to one rule:

```bash
sm check --analyzers reference-broken
```

> Now fix it the way you would for real: open `.claude/commands/publish.md` and
> point the deploy-runbook link at `docs/DEPLOYMENT.md` (the new name). Then
> re-scan and re-check:

```bash
sm scan
sm check
```

> `✓ No issues`. The arrow is solid again. That is the daily safety net: rename
> and move things freely, and skill-map tells you exactly what you forgot to
> update, before it ships broken.
>
> Did `sm check` go from 1 error back to clean?

Wait for confirmation. The harness MUST read `✓ No issues` before Act C (the
real `/publish` later follows this runbook). Mark `broken-ref`: done.
Auto-advance to `reserved`.

On `agent-skills` / Antigravity (no `command` kind), run the same beat on a link
that exists there: `mv docs/STYLE.md docs/STYLE-GUIDE.md`, which breaks the
`content-editor` skill's `[style guide]` reference; `sm check` flags
`reference-broken` on the `content-editor`; fix the link in the skill body and
re-check to clean.

## Chapter `reserved` - A reserved name collides (~2 min)

**Context**: you add a quick command to scaffold new pages and, without
thinking, name it `init`, a name Claude Code already owns for its own slash
command. skill-map warns you before the runtime silently ignores your file.

On `agent-skills` / Antigravity there is no `command` kind: **skip this chapter**
and fold a one-line mention ("skill-map also warns when a file's name collides
with a runtime built-in") into the close of the previous chapter. Adjust the
section's chapter count accordingly.

**Preparation**: `Write` `.claude/commands/init.md`:
```markdown
---
name: init
description: |
  Scaffolds a new empty page in public/ from the shared template.
---

# init

Creates a blank page so you can start writing.
```

Tell the tester to scan and check:

```bash
sm scan
sm check
```

> `sm check` warns:
>
> ```
> sm check: 1 warning
>
>   .claude/commands/init.md
>     ⚠  name-reserved   .claude/commands/init.md shadows a built-in claude command. The runtime ignores this file in favour of its own built-in. Rename the file or `frontmatter.name` to a non-reserved value.
> ```
>
> `init` is one of Claude Code's own slash commands (like `/help`, `/clear`,
> `/config`), so your file would be silently ignored, it never runs. The fix is
> to give it a name the runtime does not own.

Rename the command to `new-page`: rename the file `.claude/commands/init.md` to
`.claude/commands/new-page.md`, AND change `frontmatter.name` to `new-page` and
the H1 to `# new-page` (a command's H1 stays a plain title, never `# /new-page`).
Then have the tester re-scan and re-check:

```bash
sm scan
sm check
```

> `✓ No issues`. Notice what cleared the warning: changing the **name**, not
> just the filename. The reserved check looks at the command's name (its
> `frontmatter.name`), which is why the warning told you to rename "the file or
> `frontmatter.name`". Now `new-page` is yours and the runtime will actually run
> it.
>
> Did the warning clear after the rename?

Wait for confirmation. Mark `reserved`: done. Auto-advance to `publish`.

---

**Act C - Publish**

## Chapter `publish` - Ship it: run /publish for real (~4 min)

**Context**: the harness is not a picture, it is a set of instructions, and
`/publish` ties them together. You run it **for real** now: it invokes the link
checker over your pages, briefs the `content-editor` if anything needs a fix,
then follows the deploy runbook. This is the same Layer 1 / Layer 2 split, the
pages are output, so the Map stays put while the pipeline runs.

On `agent-skills` / Antigravity there is no `/publish` command: run the
`check-links` skill directly over `public/`, then follow `docs/DEPLOYMENT.md` by
hand. Everything else in this chapter is identical.

**Preparation**: make sure the pages exist (`index`, `about`, `projects`,
`posts` from the earlier chapters; lay any that are missing from the templates in
`setup`). When the tester asks to publish, **execute the publish flow for real**
by following `.claude/commands/publish.md`: run the `check-links` logic over
every `.html` under `public/` (does each internal `href` resolve to a file that
exists?); if any link is broken, brief the `content-editor` to fix it and
re-run the check; then walk the deploy runbook steps. Do not role-play it.

Tell the tester:

> The site is ready. Tell me to publish (or type `/publish`) and I'll run your
> publish command for real: I follow its steps, run the link check across your
> pages, fix anything through the `content-editor`, and walk the deploy runbook,
> exactly what the command says to do.

After running the flow, report what actually happened (keep the promises
conditional on the real result):

> Here is what just ran, for real:
>
> - **check-links** walked every page under `public/` and followed each internal
>   link. Result: 0 broken links. (Had it found one, the next step would have
>   briefed `content-editor` to fix it, then re-checked, that is what step 2 is
>   for.)
> - the **deploy runbook** (`docs/DEPLOYMENT.md`) lists the ship steps:
>   regenerate the pages (done), run the link check (done), start the server
>   (next chapter).
>
> And the Map did not move while the pipeline ran: the pages are Layer 2 output;
> the harness on the canvas is Layer 1, and that is what skill-map maps.
>
> Did the publish run report the link check clean?

Wait for confirmation. Mark `publish`: done. Auto-advance to `sidecar`.

## Chapter `sidecar` - Annotate the handbook (.sm and consent) (~3 min)

**Context**: skill-map keeps its own metadata in co-located `.sm` sidecars, right
next to each file, leaving the vendor file untouched. Writing the first one needs
your consent. Good moment now that the site shipped: leave a metadata note on the
handbook.

**Preparation**: none for a first-time tester. (If re-entering a dir where the
sidecar already exists, reset consent first with `rm -f AGENTS.sm
.skill-map/settings.local.json` so the prompt shows again.)

Tell the tester:

```bash
sm sidecar annotate AGENTS.md
```

> The first time you write a `.sm`, skill-map asks for consent: answer `y` at the
> `[Y/n]` prompt. It then scaffolds `AGENTS.sm` next to `AGENTS.md`:
>
> ```
> ✓  Created AGENTS.sm. Edit it, then run `sm bump AGENTS.md` to commit the version.
> ```
>
> Look at the two new artifacts:

```bash
cat AGENTS.sm
cat .skill-map/settings.local.json
```

> `AGENTS.sm` holds an `identity:` block (hashes that tie it to the live file)
> and an empty `annotations: {}` ready for you to fill in. And
> `.skill-map/settings.local.json` now records your consent,
> `{ "allowEditSmFiles": true }`, so skill-map will not ask again in this
> project. Open the Inspector for the `AGENTS` node: it now has a **Metadata**
> section it did not have before.
>
> See `AGENTS.sm` and the consent flag?

Wait for confirmation. Mark `sidecar`: done. Auto-advance to `golive`.

## Chapter `golive` - Your portfolio, live next to the graph (~3 min)

**Context**: the climax. Serve the finished multi-page site and click through it,
ending with the running portfolio on one side and the full harness graph on the
other. One of the few chapters where the tester runs non-`sm` commands
themselves; guide them, do not run it for them. `npm install` is idempotent, so
it is safe whether or not they ran it in `setup`.

**Preparation**: none. `server.js` / `package.json` exist from the kickoff; the
pages exist from the earlier chapters.

```bash
npm install
node server.js
```

> Last step, the fun one. `npm install` confirms the one small library is there,
> and `node server.js` starts the server (`Listening on http://localhost:3000`).
>
> Open `http://localhost:3000` and click through Home, About, Projects, and
> Posts, the pages your harness produced and shipped through the publish flow you
> just ran.
>
> Now take it in at once. On one side, your real running portfolio, named after
> you, that you could deploy as-is. On the other, the skill-map graph of the
> harness that built it: the handbook, the content-editor, the style guide, the
> publish command, the link checker, the deploy runbook, all wired together. You
> started in an empty folder and ended with a real, running site and a living
> map of how it all fits.
>
> Does the site load, and can you click between all the pages?

Wait for confirmation. The tester runs the commands; do not run them. If
`npm install` fails, check they are in the project root and Node is on PATH
(`node --version` should print 24 or higher). If the port is busy, stop the
server with Ctrl+C and apply the ports edge case.

This is the campaign finale. Congratulate them plainly: they went from an empty
directory to a real, running portfolio plus a complete map of its harness. Mark
`golive`: done. Last chapter of the part: apply §Closing a part (name the part
by its title); since this closes the campaign spine, if every active part is now
done route to the §Final wrap-up instead of the menu.
