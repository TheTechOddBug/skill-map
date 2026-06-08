# Fixture templates

Fixtures the orchestrator lays for the auto-fixtured parts. Two sets
today: the **master fixture** (Part 7, "Extend skill-map",
`backstage-init`) right below, and the **portfolio fixture** (Part 1,
"The project from zero", `portfolio-init`) at the end of this file.
Read the set for the part being entered.

## Master fixture (Part 7): layout (per provider)

Per §Provider detection in `SKILL.md`, the `<provider_dir>`
placeholder resolves to `.claude/` or `.agents/skills/` depending
on the detected runtime (Google's Antigravity CLI, which replaced
Gemini CLI on 2026-05-19, adopted the same open standard as
`agent-skills`, so both share the `.agents/skills/` layout). Drop
any file whose kind is not in the provider's supported set: on
`agent-skills` / Antigravity only the skill + note are valid;
on `claude` (default) all three apply.

Canonical layout (substitute `<provider_dir>` per detection):

```
<cwd>/
├── <provider_dir>/
│   ├── agents/                    (claude only)
│   │   └── master-agent.md
│   └── skills/                    (both providers)
│       └── master-skill/
│           └── SKILL.md
├── notes/
│   └── ideas.md
└── findings.md
```

On `agent-skills` the `agents/` subtree is omitted (the provider
does not claim that kind); the skill lives at
`.agents/skills/master-skill/SKILL.md`.

Translate the natural-language prose (descriptions, body text,
list items) to the tester's language. Keep paths, frontmatter
keys, identifiers, and link targets in English.

## File: `.claude/agents/master-agent.md` (kind: agent)

```markdown
---
name: master-agent
description: |
  Example agent used by the advanced tutorial. Has a couple of
  tools so the `core/tools-counter` extractor emits a count.
tools: [Read, Bash, Edit]
model: sonnet
metadata:
  version: "1.0.0"
---

# master-agent

Walks the master-skill outputs and reports findings. Used as the
target node when we exercise extractors, analyzers, and the
plugin-authoring flow.
```

## File: `.claude/skills/master-skill/SKILL.md` (kind: skill)

```markdown
---
name: master-skill
description: |
  Example skill paired with the master-agent for the advanced
  tutorial. Links to the agent so extractors and analyzers have
  something to chew on.
inputs:
  - name: target
    type: path
    description: File to process.
    required: true
outputs:
  - name: report
    type: string
    description: Markdown summary.
metadata:
  version: "1.0.0"
---

# master-skill

Hands heavy work over to the
[master-agent](../../agents/master-agent.md) and emits a Markdown
report.

## Steps
1. Read the `target`.
2. Validate the frontmatter.
3. Delegate to the agent.
```

## File: `notes/ideas.md` (kind: markdown)

```markdown
---
name: Ideas backlog
description: |
  Free-form notes for the advanced tutorial. Demonstrates the
  catch-all markdown kind alongside the agent and skill.
tags: [notes, master]
metadata:
  version: "1.0.0"
---

# Ideas

- [ ] Compare extractor outputs side by side.
- [ ] Sketch a tiny plugin that surfaces a counter on the agent.
```

## File: `findings.md`

```markdown
# Findings

If you spot anything weird during the tutorial, log it here.

Per finding:
- **Chapter**: <id>
- **Command**: `sm ...`
- **Expected**: ...
- **Got**: ...
- **Notes**: ...
```

## Portfolio fixture (Part 1, `portfolio-init`)

Laid backstage before the tester's `sm init` in Part 1. The Express
skeleton (`server.js`, `package.json`, `public/index.html`) is plain
scaffolding, not `.md`, so the scan ignores it; it makes the project
real and runnable (Part 3 runs it, Part 6 ships it). The one boot node is the
handbook `AGENTS.md`. On `agent-skills` / Antigravity (no `agent`
kind) the harness still works: the agent member is created as a skill
in a later chapter.

Layout:

```
<cwd>/
├── <provider_dir>/            (harness, grown by the chapters)
├── docs/                      (created in the real-kinds chapter)
├── public/
│   └── index.html
├── AGENTS.md                  (the boot node)
├── server.js
└── package.json
```

### File: `AGENTS.md` (kind: markdown, the boot node)

No frontmatter: a real handbook is plain prose (this repo's own
`AGENTS.md` and the tutorial's `CLAUDE.md` carry none either), and a
`name:` that differs from the filename only confuses the tester. The
node displays by its path, `AGENTS.md`.

```markdown
# Portfolio handbook

A small static portfolio site, served by Express (`server.js`). The
`.claude/` harness maintains it: an agent writes the pages, a skill
checks the links, a command publishes. The conventions live in
`docs/STYLE.md`; the deploy steps in `docs/DEPLOY.md`.
```

### File: `server.js` (not scanned; runnable scaffolding)

```js
// Minimal static server for the portfolio. No framework, one dep.
const express = require('express');
const path = require('node:path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Portfolio live at http://localhost:${port}`));
```

### File: `package.json` (not scanned)

```json
{
  "name": "my-portfolio",
  "private": true,
  "scripts": { "start": "node server.js" },
  "dependencies": { "express": "4.21.2" }
}
```

### File: `public/index.html` (not scanned; placeholder until Part 3)

```html
<!doctype html>
<meta charset="utf-8">
<title>My portfolio</title>
<h1>My portfolio</h1>
<p>Pages land here once the content-editor generates them.</p>
```

### `.skillmapignore` additions

Append to the portfolio `.skillmapignore` (on top of the tutorial
internals from `SKILL.md`): `node_modules/` (the Express install) and
`public/` (generated HTML, not part of the harness graph).

## Seed snapshots (for `preflight: seed`, jumping into a campaign part)

When the orchestrator enters a campaign part out of order (its
predecessors are not `done`), it fast-forwards the project by laying
the snapshot below, then `sm init` (if `.skill-map/` is missing) +
`sm scan`. These are **checklists, not content**: each row names a file
and the chapter that holds its canonical content. Lay each file by
copying the content from the named chapter (substitute `<provider_dir>`
and skip provider-unsupported kinds per `_core.md`); an `EDIT` row is
applied on top of the file an earlier row laid. Keep these lists in
sync only when a harness FILE is added or removed, the file CONTENT
lives in the chapters, so editing a chapter needs no change here.

### Seed snapshot: `harness-built` (start of Part 2)

The portfolio skeleton plus the harness members Part 1 created, before
any cross-links:

1. `AGENTS.md`, `server.js`, `package.json`, `public/index.html`, and
   the portfolio `.skillmapignore` additions  <-  the `## Portfolio
   fixture` section above.
2. `CLAUDE.md` (`@AGENTS.md`)  <-  part-project-kickoff.md, chapter `manual`.
3. `<provider_dir>/agents/content-editor.md`  <-  part-project-kickoff.md, chapter `first-agent`.
4. `docs/STYLE.md` and `docs/DEPLOY.md`  <-  part-project-kickoff.md, chapter `real-kinds`.

### Seed snapshot: `harness-connected` (start of Parts 3-6)

Everything in `harness-built`, PLUS the Part 2 wiring:

5. `<provider_dir>/skills/check-links/SKILL.md`  <-  part-connect-harness.md, chapter `check-links`.
6. `<provider_dir>/commands/publish.md`  <-  part-connect-harness.md, chapter `publish`.
7. EDIT `AGENTS.md`: append the two hub bullets (mention `@content-editor`, invoke `/publish`)  <-  part-connect-harness.md, chapter `links`.
8. EDIT `<provider_dir>/agents/content-editor.md`: add the `[style guide](../../docs/STYLE.md)` line  <-  part-connect-harness.md, chapter `links`.

After laying a snapshot the map matches the state a tester would have at
the END of the part just before the one being entered.

