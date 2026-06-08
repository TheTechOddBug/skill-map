# Part 3: Run the harness (your site, live) (step library, `generate` + `serve`)

The first payoff: the harness you built and wired in the earlier parts
finally does its job and you see a real site running, without waiting
for the finale. Pace `auto-advance`, preflight `seed` (`harness-connected`,
so a tester can jump straight here). Two chapters, in order:
`generate` (the agent writes the HTML pages) then `serve` (the tester
runs the site and sees it next to the graph). This is a deliberately
simple, working pass: maintenance, MCP and the full publish pipeline
come in the parts after it. Shared conventions live in `_core.md`.

These two HTML pages are the canonical site fixture: the full
publish finale (`live-site`) lays the same `public/index.html` and
`public/about.html` from here before adding its own extra page, so keep
them in sync here only.

## Chapter `generate` - The agent generates the HTML in public/ (~3 min)

**Context**: the `content-editor` agent exists to write the site's
pages, so now you (playing that agent) generate the actual HTML into
`public/`. The honest beat the tester must hear: writing HTML does NOT
move the skill-map graph. The graph is Layer 1, the `.md` harness that
builds the site; the HTML is Layer 2, the harness's OUTPUT, and
skill-map does not map it (HTML is not `.md`). So the Map will sit
still while real files land on disk, and that is correct, not a bug.
Keep the markup plain per the style guide: no framework, no client JS,
one H1 per page, every page links back home.

**Preparation**: `Write` two static pages into `public/`. The
pre-flight already left a placeholder `public/index.html`; this
overwrites it with the real home page and adds an about page. Keep the
markup plain.

`public/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My Portfolio</title>
  </head>
  <body>
    <h1>My Portfolio</h1>
    <p>Hi, I build small, sturdy things on the web.</p>
    <nav>
      <a href="/">Home</a> ·
      <a href="/about.html">About</a>
    </nav>
  </body>
</html>
```

`public/about.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>About</title>
  </head>
  <body>
    <h1>About</h1>
    <p>A short page about the person behind the portfolio.</p>
    <nav>
      <a href="/">Home</a>
    </nav>
  </body>
</html>
```

```bash
# Nothing for you to run yet. Look at both halves of your screen.
```

Tell the tester:

> Your `content-editor` agent just did its real job: it wrote the
> actual web pages. Two HTML files landed in your project under
> `public/`: the home page (`public/index.html`) and an about page
> (`public/about.html`), plain static markup that follows the style
> guide you set up earlier.
>
> Now glance at the Map. It did not change, and that is exactly
> right. Everything you watched grow on the canvas is your harness:
> the `.md` files and how they reference each other (call that
> Layer 1). The HTML pages are Layer 2, what the harness PRODUCES.
> skill-map maps the harness, not the pages it outputs (HTML is not
> `.md`), so writing real site files leaves the graph untouched. Two
> layers, one project: the graph that builds the site, and the site
> itself.
>
> Ready to see the site running?

Wait for confirmation. Mark `generate`: done. Auto-advance to `serve`.

## Chapter `serve` - node server.js: your portfolio, live next to the graph (~3 min)

**Context**: the tester installs the single dependency (Express) and
starts the tiny server that the pre-flight already left in
`server.js`, then opens the site in the browser. They end with two
things side by side: the real portfolio they can click through, and
the skill-map graph of the harness that built it. Express runs on
Node, which the tester has from pre-flight (Node 24+), so no new
install beyond `npm install`. This chapter is one of the few where the
tester runs a non-`sm` command themselves (`npm install`,
`node server.js`); guide them, do not run it for them.

**Preparation**: none. `server.js` and `package.json` already exist
from the kickoff pre-flight; the pages exist from the `generate`
chapter. The tester runs everything in this chapter.

```bash
npm install
node server.js
```

Tell the tester:

> You have the pages; now let's serve them. In your terminal, run
> these two commands:
>
> The first, `npm install`, downloads the one small library the
> server needs (Express, a tiny web server). It runs on Node, which
> you already installed at the very start, so there is nothing new to
> set up.
>
> The second, `node server.js`, starts the server. It prints a line
> telling you it is listening, something like `Listening on
> http://localhost:3000`.
>
> Open `http://localhost:3000` in your browser. There it is: your
> portfolio, live. Click the **About** link, then the **Home** link
> to come back. Those are the very pages your harness produced.
>
> Take a second to look at both halves: on one side the running site
> you can click through, on the other the skill-map graph of the
> harness that built it. You built the harness, wired it, and now you
> have run it once end to end.
>
> Does the site load, and can you click between Home and About?

Wait for confirmation. The tester runs the commands; do not run them
for them. If `npm install` fails, check they are in the project root
(the cwd they have used all along) and that Node is on PATH (`node
--version` should print 24 or higher). If the port is busy, they can
stop the server with Ctrl+C and the edge case for ports applies the
same as elsewhere. Remind them they can leave the server running or
stop it with Ctrl+C; either way the next parts do not need it.

Mark `serve`: done. Last chapter of the part: apply §Closing a part
(the close names the part by its title and routes back to the menu;
this is a mid-campaign payoff, NOT the campaign finale, so do not
sign the campaign off here).
