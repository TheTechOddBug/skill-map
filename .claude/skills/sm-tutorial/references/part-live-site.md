# Part 6: Ship the site (the full publish pipeline) (step library, finale, `pipeline` + `golive`)

The finale, the climax of the whole campaign. In Part 3 you ran the
harness once, the simple way (generate two pages, serve them). Here you
operate it exactly as it was designed: you drive the `/publish` command
end to end, the way the handbook says to ship, and put a richer
multi-page site live next to the full graph. Pace `auto-advance`,
preflight `seed` (`harness-connected`), so a tester can jump straight
here. Two chapters, in order: `pipeline` (run `/publish`: check the
links, brief the editor, follow the deploy runbook) then `golive` (run
the server and click through the finished site). Shared conventions
live in `_core.md`.

## Chapter `pipeline` - Run /publish end to end (check-links, brief, deploy runbook) (~4 min)

**Context**: the harness is not just a picture, it is a set of
instructions, and `/publish` is the one that ties them together. Its
body says: run `/check-links`, brief `@content-editor` on any fix, then
follow the deploy runbook. Here the tester (playing the harness) walks
exactly those steps on a richer site. This is still Layer 1 vs Layer 2:
the pages are output, so the Map stays put while the files change, same
as Part 3, no need to re-teach it, just do not call it a bug if they
notice.

**Preparation** (the agent does this, playing `content-editor`):

1. Ensure the two base pages exist. If they are not already on disk
   from Part 3 (a tester can land here via the seed), lay
   `public/index.html` and `public/about.html` exactly as in
   part-run-harness.md, chapter `generate`. They are the single source
   for those two pages; do not restate their markup, copy it from
   there.
2. Add a **Projects** link to the home nav. `Edit` `public/index.html`,
   turning the About line of the nav into:

```html
      <a href="/about.html">About</a> ·
      <a href="/projects.html">Projects</a>
```

3. `Write` the new page `public/projects.html` (plain markup, links
   back home, per the style guide):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Projects</title>
  </head>
  <body>
    <h1>Projects</h1>
    <p>A few small things I have shipped.</p>
    <nav>
      <a href="/">Home</a>
    </nav>
  </body>
</html>
```

```bash
# Still nothing to run in the terminal. The publish steps below are
# you walking the harness; the server comes in the next chapter.
```

Tell the tester:

> Time to ship it the way your handbook says to. Open
> `.claude/commands/publish.md` and look at its steps: that command is
> the recipe, and you are about to run it by hand, the way the agent
> would. Three pages now live under `public/`: home, about, and a new
> projects page, with the home nav linking all three.
>
> **Step 1, check the links** (`/check-links`). Walk the three pages
> and follow every internal link: `/` resolves to the home page,
> `/about.html` and `/projects.html` to files that exist, and each
> page links back home. Nothing points at a missing file, so the link
> check is clean.
>
> **Step 2, brief the editor** (`@content-editor`). The check found
> nothing to fix, so there is no brief to hand off this time, that is
> the happy path. (Part 4 is where a link actually breaks and this
> step earns its keep.)
>
> **Step 3, follow the deploy runbook** (`docs/DEPLOY.md`). It lists:
> generate the pages (done), run the link check (done), start the
> server (next chapter). You have walked the whole `/publish` flow.
>
> Glance at the Map one more time: it did not move while you added a
> page and ran the pipeline. The pages are Layer 2 output; the harness
> on the canvas is Layer 1, and that is what skill-map maps.
>
> Ready to put it live?

Wait for confirmation. You MAY `Read` the three files in `public/`
afterwards to confirm the edit and the new page landed. Mark
`pipeline`: done. Auto-advance to `golive`.

## Chapter `golive` - Ship it: the richer site live next to the full graph (~3 min)

**Context**: the climax. The tester starts the tiny Express server the
pre-flight left in `server.js` and clicks through the three-page site,
ending with the running portfolio on one side and the full skill-map
graph of the harness that built it on the other. This is one of the
few chapters where the tester runs non-`sm` commands themselves
(`npm install`, `node server.js`); guide them, do not run it for them.
`npm install` is idempotent, so it is safe whether or not they already
ran it in Part 3.

**Preparation**: none. `server.js` and `package.json` exist from the
kickoff pre-flight; the three pages exist from the `pipeline` chapter.
The tester runs everything here.

```bash
npm install
node server.js
```

Tell the tester:

> Last step, the fun one. In your terminal, run these two commands:
>
> `npm install` downloads the one small library the server needs
> (Express). If you already ran it in Part 3 it just confirms it is
> there. Then `node server.js` starts the server; it prints a line
> like `Listening on http://localhost:3000`.
>
> Open `http://localhost:3000`. Click **About**, **Projects**, and
> **Home** to move between all three pages. Those are the pages your
> harness produced, shipped through the publish flow you just ran by
> hand.
>
> Now take it all in at once. On one side, the real running site you
> can click through. On the other, the skill-map graph of the harness
> that built it: the handbook, the content editor, the style guide,
> the publish command, the link checker, the MCP tool, all wired
> together. You started in an empty folder with nothing, and you have
> ended with a real, running site and a living map of how it all fits.
>
> Does the site load, and can you click between Home, About and
> Projects?

Wait for confirmation. The tester runs the commands; do not run them
for them. If `npm install` fails, check they are in the project root
and Node is on PATH (`node --version` should print 24 or higher). If
the port is busy, stop the server with Ctrl+C and apply the ports edge
case. Remind them the server stays running until they press Ctrl+C.

This is the campaign finale. Congratulate them plainly: they went from
an empty directory to a real, running portfolio plus a complete map of
its harness. Mark `golive`: done. Last chapter of the part: apply
§Closing a part (name the part by its title; since this closes the
campaign spine, if every active part is now done route to the §Final
wrap-up instead of the menu).
