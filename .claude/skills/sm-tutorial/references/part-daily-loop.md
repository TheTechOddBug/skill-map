# Part 2: The daily loop (step library, `daily-loop`)

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

**Provider note (read once).** This is the rich track; the bodies below are the
`claude` layout (`.claude/`). The open-standard family (agent-skills /
antigravity) walks its own `basic-daily` part. **Codex deltas** (when
`tutorial.provider == codex`): the `content-editor` is a TOML agent at
`.codex/agents/content-editor.toml`, and Codex has no `command` kind, so
`publish` is a **skill** at `.agents/skills/publish/SKILL.md`. The `@`/`/`
connectors all resolve on Codex, so every beat lands the same; only the path /
kind of those two nodes changes. Per chapter:

- `add-page`: invoke the `content-editor` TOML agent via the Task tool (same flow).
- `broken-ref`: the deploy link that breaks lives in the `publish` SKILL; fix it
  in `.agents/skills/publish/SKILL.md` (not a `.claude/commands/` file).
- `reserved`: Codex has no command, so create a SKILL with a reserved name
  instead, `Write` `.agents/skills/config/SKILL.md` named `config` (it shadows
  the open-standard `COMMONS_RESERVED_NAMES`); clear it by renaming the folder +
  `frontmatter.name` to `new-page`, exactly like the basic track's `reserved`
  chapter, on a skill.
- `publish`: run the `publish` SKILL's steps for real (same `/check-links` +
  `@content-editor` + deploy runbook).

**Real-execution contract (read once).** When invoking the `content-editor` via
the Task tool, instruct it explicitly to write ONLY `.html` files under
`public/`, to NOT create any `.md` file, and to NOT touch the harness or its own
definition. After it runs, `Read` what it wrote before telling the tester what
landed (this keeps the node-count promises honest). If the subagent is not
invocable in the tester's setup, act as the `content-editor` yourself following
its rules and `docs/STYLE.md`, so the beat still lands.

**Live-map note (read once).** Every chapter here is watched on the live
**Map**, so skill-map's UI (`sm`) MUST be running before you start, watcher
picking up edits. In the full campaign the tester booted it back in the kickoff
chapter and kept it open; if they entered this part directly (via seed) or
closed it, have them start it now, run `sm` from the project root and open the
URL it prints, before the first chapter. This part has NO `sm scan` / `sm check`
steps: the watcher re-scans on every save, and the Map shows new nodes,
broken-reference markers, and confidence live.

---

**Act A - Add**

## Chapter `setup` - Make it yours and bring it up (~5 min)

**Context**: the harness is wired (you built it in the earlier parts). Now you
put it to work on a real day. First, make the site yours, about whatever you
like, then serve it and open it in the browser, the early payoff before the
daily loop fills it with pages. The honest beat: the HTML
and CSS are Layer 2 (the harness's output); skill-map maps the harness (Layer 1,
the `.md` files), so the site landing on disk does NOT move the graph, and that
is correct, not a bug. The tester runs the serve commands themselves (one of the
few non-`sm` beats); guide them, do not run them.

**Preparation**:

1. Ask the tester the two questions straight, with no "before we build, let's
   make it yours" lead-in: what the site should be called (their name or a
   title) and one line about what it is for. Keep it light; if they do not care,
   offer defaults ("My Portfolio" / "Small, sturdy things on the web"). Persist
   both with
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

The site is styled now, so bring it up in the same beat (the tester runs the
serve commands themselves). `sm` is still running in their second terminal, so
the server needs a **third terminal** anchored to the same project folder:

```bash
npm install
node server.js
```

> **Note:** I gave your site a face: a shared stylesheet plus a styled **Home**
> and **About** page, named after you. These are Layer 2 (the harness's output),
> so the **Map** did not move, and that is correct: skill-map maps the harness
> (the `.md` files, Layer 1), not the HTML it produces.
>
> Now bring your site up. `sm` is still running in your second terminal, so open
> a **third terminal** in this same project folder and run the two commands
> there. `npm install` pulls the one small library the server needs (Express, on
> the Node you already have), and `node server.js` starts it and prints a line
> like `Listening on http://localhost:3000`.
>
> Open `http://localhost:3000`: there is your site, named after you, with a
> clean layout. Click **About** and back to **Home**.
>
> Does the site load and look clean?

Wait for confirmation. If `node server.js` reports `Cannot find module
'express'`, `npm install` did not run first, run it (it reads `package.json` and
pulls Express), then retry; if `npm install` itself fails, check they are in the
project root and Node is on PATH. Mark `setup`: done. Auto-advance to
`add-page`.

## Chapter `add-page` - Add a page with your agent (~4 min)

**Preparation**: none until the tester asks.

Tell the tester:

> Your turn to delegate, the way you would on a real day. Tell me what page to
> add, in your own words, for example "add a projects page" or "add a page about
> my talks". I'll hand it to your `content-editor` agent and let it write the
> page.

When the tester answers, invoke the project's `content-editor` (the
`.claude/agents/content-editor.md` agent) via the Task tool, honouring the
real-execution contract above: write ONE new
`.html` page under `public/` named after the topic (default `public/projects.html`),
following the agent's own steps and `docs/STYLE.md` (the shared shell, link
`/style.css`, one `<h1>`, a nav link back to Home), and add the new page to the
home nav. Do NOT write any `.md`, do NOT touch the harness. Then `Read` the file
it produced.

Report back using the block below as the template: adapt the page name and add a
one-line description of what it actually wrote, but keep the ENTIRE report inside
the `> ` blockquote, do NOT drop the bar when you personalise it.

> Your `content-editor` ran for real and wrote `public/projects.html`, linked
> from the home nav. Refresh the site: the new page is there, in the same style
> as the rest.
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

**Context**: the daily safety net, and where skill-map earns its keep: rename and
move things freely, and skill-map shows you exactly what you forgot to update
before it ships broken.

**Preparation**: none (the tester drives). Everything here is watched live on
the Map; no `sm` commands.

Tell the tester to free the third terminal, then rename the deploy runbook
themselves (their file):

> In your **third terminal** (the one running `node server.js`), press
> **Ctrl+C** to stop the site server, then rename the deploy runbook there:

```bash
mv docs/DEPLOY.md docs/DEPLOYMENT.md
```

> You renamed the deploy runbook, but `/publish` still links to the old path.
> Watch the **Map**: the `publish → docs/DEPLOY.md` arrow disappears (a broken
> link resolves to no node, so skill-map stops drawing it) and the `publish`
> card gets a red **broken-reference** marker, a link whose target no longer
> exists. Open the `publish` node's inspector and the broken reference is listed
> there.
>
> Now fix it the way you would for real: open `.claude/commands/publish.md` and
> point the deploy-runbook link at `docs/DEPLOYMENT.md` (the new name). Save.
>
> Watch the **Map** again: the arrow snaps back, solid, and the red marker
> clears, all live, no command to run.
>
> Did the broken marker appear and then clear?

Wait for confirmation. The harness MUST be clean again (the red marker gone)
before Act C (the real `/publish` later follows this runbook). Mark `broken-ref`:
done. Auto-advance to `reserved`.

## Chapter `reserved` - A reserved name collides (~2 min)

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

The watcher picks up the new command. Tell the tester:

> I added a command named `init`. Watch the **Map**: the new `init` command node
> appears, but flagged with a **warning** marker. Open its inspector: it reads
> `name-reserved`, `init` shadows one of Claude Code's own slash commands (like
> `/help`, `/clear`, `/config`), so the runtime would silently ignore your file,
> it never runs. The fix is a name the runtime does not own.
>
> Rename it to `new-page`: first rename the file `.claude/commands/init.md` to
> `.claude/commands/new-page.md`. Then open it in your text editor / IDE and, at
> the top, where the frontmatter says `name: init`, change it to
> `name: new-page`. Save.
>
> Watch the **Map** again: the warning clears and the node is now `new-page`,
> all live. What cleared it was changing `frontmatter.name` (not just the
> filename), the reserved check looks at the name. Now `new-page` is yours and
> the runtime will run it.
>
> Did the warning clear after the rename?

Wait for confirmation. Mark `reserved`: done. Auto-advance to `publish`.

---

**Act C - Publish**

## Chapter `publish` - Ship it: run /publish for real (~4 min)

**Preparation**: make sure the pages exist (`index`, `about`, `projects` from the
earlier chapters; lay any that are missing from the templates in `setup`). When the tester asks to publish, **execute the publish flow for real**
by following `.claude/commands/publish.md`: run the `check-links` logic over
every `.html` under `public/` (does each internal `href` resolve to a file that
exists?); if any link is broken, brief the `content-editor` to fix it and
re-run the check; then walk the deploy runbook steps. Do not role-play it.

Tell the tester:

> The site is ready. Tell me to publish (or type `/publish`) and I'll run your
> publish command for real: I follow its steps, run the link check across your
> pages, fix anything through the `content-editor`, and walk the deploy runbook,
> exactly what the command says to do. (You can read the command's content
> anytime by clicking the `publish` node on the Map, then opening its **Body**
> section.)

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
> As you saw in the lines just above, I did not report anything odd: the link
> check came back clean and `/publish` is wired correctly across your pages.
> Shall we continue?

Wait for confirmation. Mark `publish`: done. Auto-advance to `stability`.

## Chapter `stability` - Set a node's stability (and the `.sm` sidecar) (~3 min)

**Preparation**: none for a first-time tester. (If re-entering a dir where the
sidecar already exists, reset consent first with `rm -f AGENTS.sm
.skill-map/settings.local.json` so the consent prompt shows again.)

Tell the tester:

> Your harness shipped, so let's set its **stability**. Open the Inspector for
> the `AGENTS` node (click it on the **Map**) and click the **Set stability**
> button. Pick any of `experimental` / `stable` / `deprecated` from the list.
>
> The first time skill-map writes its own metadata it asks for **consent**:
> confirm it in the dialog that pops up. Two things happen at once: a stability
> badge for the stage you picked appears on the `AGENTS` node, and skill-map
> creates a **`.sm` sidecar file** (`AGENTS.sm`) right next to the handbook to
> hold that metadata, your `AGENTS.md` itself is never touched. Your consent is
> remembered for the project, so it will not ask again.
>
> That sidecar is where skill-map keeps what it knows about a node that does not
> belong in the vendor file (stability, version, tags).
>
> See the new stability badge on the handbook?

Wait for confirmation. Mark `stability`: done. Auto-advance to `golive`.

## Chapter `golive` - Your website, live next to the graph (~3 min)

One of the few chapters where the tester runs non-`sm` commands themselves;
guide them, do not run it for them. `npm install` is idempotent, so it is safe
whether or not they ran it in `setup`.

**Preparation**: none. `server.js` / `package.json` exist from the kickoff; the
pages exist from the earlier chapters.

```bash
npm install
node server.js
```

> Last step, the fun one. `npm install` confirms the one small library is there,
> and `node server.js` starts the server (`Listening on http://localhost:3000`).
>
> Open `http://localhost:3000` and click through Home, About, and Projects, the
> pages your harness produced and shipped through the publish flow you just ran.
>
> Now take it in at once. On one side, your real running website, named after
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
directory to a real, running website plus a complete map of its harness. Then
invite them to keep going on their own:

> And this site is yours to keep playing with: add more pages, refine the style
> guide, wire a new command, then watch the map react. Creating and maintaining a
> small site like this, by hand, is the best practice there is for getting a feel
> for how to build a harness.

Mark `golive`: done. Last chapter of the part: apply §Closing a part (name the
part by its title); since this closes the campaign spine, if every active part is
now done route to the §Final wrap-up instead of the menu.
