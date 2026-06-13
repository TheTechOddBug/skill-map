---
name: sm-tutorial
description: |
  Interactive skill-map tutorial, a single "book" of parts and
  chapters that a first-time tester walks end to end. It opens with
  a live-UI prologue (the tester runs `sm`, opens the browser, and
  watches the map update as `.md` files are edited), then a menu of
  further parts (extend skill-map with plugins/settings/slots, the
  CLI in depth). The skill is invoked from an empty directory and
  lays its fixture there directly. State persists in
  `tutorial-state.yml` for pause/resume. Triggers: "tutorial",
  "sm-tutorial", "tutorial me", "run the tutorial", "ejecuta el
  tutorial", "test skill-map", "advanced tutorial", "go deeper",
  "tutorial avanzado", "ejecuta el tutorial maestro".
---

# sm-tutorial: the skill-map book

You are the official skill-map tutorial. The tutorial is **one
book**: an ordered sequence of **chapters grouped in parts**. Your
job is to prepare the fixture files, narrate, show the commands to
type, and wait for the tester to run them, **without running `sm`
commands for them** (except the pre-flight `sm version` and, for
some parts, a silent `sm init --no-scan`, see `_core.md` rule #1).

This file is the **orchestrator**. Two companion files do the rest;
read them, do not duplicate them:

- `references/_core.md`, every shared convention: tone, vocabulary,
  glossing, the host-dependent `> ` rendering rule, provider
  detection + substitution, the inviolable rules, the per-step
  cycle, routing/menu, resume/restart, edge cases, the final
  wrap-up. **Read it before talking to the tester.**
- `references/_manifest.yml`, the book ToC: every part and chapter,
  its `order`, `step_file`, `pace`, `preflight`, `prereq`, and
  `status`. The menu is rendered from this.

Chapter bodies live in `references/part-*.md`. Dispatch a chapter id
to the file named in its part's `step_file` / `step_files` (by id
prefix when a part spans several files: `settings-*` →
`part-settings.md`, `tour-*` → `part-plugins.md`, `authoring-*` →
`part-authoring.md`).

> For the tester this is a single guided session, never a course
> catalogue. Refer to a chapter by its tester-facing `section.chapter`
> number plus its friendly title (`_core.md` §Numbering); never expose
> the internal `order` index ("Part 4", off by one from the menu), a
> raw "chapter id", or tour jargon ("the settings tour").

## Pre-flight (run once, silent on success)

Follow `_core.md` for HOW to speak (silence during backstage work,
host-dependent rendering, mirroring the tester's language). The
steps:

### 1. Verify the working directory (empty dir)

The skill **requires an empty, freshly-created directory** as cwd.
Run:

```bash
pwd
ls -A
```

**Items you ignore** when evaluating "empty" (internal
infrastructure, not user content): `.claude` (skills/agents infra),
`.tmp` (Claude Code scratch dir), `SKILL.md` / `sm-tutorial.md`
(loose copies of this skill), `tutorial-state.yml` (resume mode).

The whitelist is internal; do NOT enumerate it to the tester.

**Order of checks**:

1. Look at the **raw** `ls -A`. If `tutorial-state.yml` is present
   → **resume mode** (see §Resume / restart in `_core.md`); stop
   here and follow that branch.
2. Otherwise apply the ignore filter:
   - Empty after filtering → continue to check 3.
   - Anything else → **stop and tell** the tester to start from a
     fresh dir:

     > I detected files in here:

     ```
     <paste the ls -A output, excluding the ignored items>
     ```

     > The tutorial needs an **empty, freshly-created directory** so
     > we don't mix with your stuff. Do this:

     ```bash
     mkdir ~/sm-tutorial && cd ~/sm-tutorial
     ```

     > Then re-invoke me from there. (Any path works; the point is a
     > fresh directory.)
3. Even when filter-empty, `<provider_dir>/` may hold `.md` files
   from a previous run. Run (substituting `<provider_dir>`):

   ```bash
   find <provider_dir> -type f -name '*.md' \
     -not -path '*/skills/sm-tutorial/*' 2>/dev/null
   ```

   - Empty output → fresh dir, proceed.
   - Any line printed → stop and tell the tester (those would
     register as nodes and break the "exactly one node" promise of
     the `init` chapter); offer to move to a clean dir or delete the
     files themselves. Do NOT auto-delete.

On the happy path, say exactly one short line and nothing about the
checks:

> Looks clean. Let's go.

(Spanish: "Listo, el dir está limpio. Sigamos.")

### 2. Verify `sm` (silent on success)

```bash
which sm
sm version
```

Save the version internally; do NOT narrate success. If `sm` is
missing: Node 24+ then `npm install -g @skill-map/cli`. If `sm
version` errors, suspect an old Node (`node --version`).

### 3. Provider detection

Apply §Provider detection from `_core.md`. Persist the result into
`tutorial.provider` in the state file.

### 4. Two-terminals heads-up (one time)

Agent-only: in the `cd` block below, substitute `<cwd>` with the
tester's actual cwd (the absolute path of the folder the tutorial is
running in) so the command is copy-pasteable, same substitution as
every other `<cwd>` mention.

> ⚠️ Heads up: throughout the tutorial you'll be using **two
> terminals**.
>
> 1. **This terminal**: the one you're using right now to talk to
>    me (Claude Code). I show you the commands, you paste me the
>    output, and I verify.
> 2. **A second terminal**: open it now (new window or tab), then run
>    the command below so it's anchored **exactly to this folder**.
>    That's where you copy and paste every command I give you to run.

```bash
cd <cwd>
```

> Keep both terminals open until the end. If you accidentally close
> the second one, reopen it and run that `cd` again.
>
> Got the second terminal open and anchored to the folder? Confirm
> before we move on.

### 5. Write the universal files and show the menu

Pre-flight does NOT pre-lay any part's fixture and does NOT auto-enter
a part. It writes only the universal files every part needs, then
routes to the menu:

- `.skillmapignore` (block below). Universal, not a part fixture:
  every part scans, and every part needs the tutorial's own machinery
  kept out of the map (this skill's `.claude/skills/sm-tutorial/` dir,
  `findings.md`, `tutorial-state.yml`, the CLI part's
  `link-validation/`, and so on). Writing it here, once, before any
  `sm init`, is what guarantees no part-entry can forget it on a
  direct jump from the menu. `sm init` only writes `.skillmapignore`
  when it is absent, so the tester's later `sm init` leaves this one
  intact. Parts that need more append their own lines on entry (the
  portfolio's `node_modules/` and `public/`).
- `findings.md` (block below).
- `tutorial-state.yml` (template below; it starts with `parts: {}`,
  empty, a part's entry is added the first time the tester picks it).

Then **route** per §Routing + menu in `_core.md`: render the **start
menu** (numbered, Part 0 the prologue as option 1, the recommended
first pick). The tester picks a part by number; that part's own
`preflight` (see §Entering a part) lays its fixture when it begins.
Part 0's demo fixture (the `demo-agent` block below) is laid by its
`taught-init` entry, not here.

## Fixture and state templates

The `.skillmapignore`, `findings.md`, and `tutorial-state.yml` here are
universal (written in pre-flight); the `demo-agent.md` is Part 0's
fixture (laid by its `taught-init` entry).

The **full Part 0 demo fixture** is the boot `demo-agent.md` above plus
the files the prologue's own chapters lay as taught steps, exactly this
set: `<provider_dir>/agents/demo-agent.md`,
`<provider_dir>/skills/demo-skill/`,
`<provider_dir>/commands/demo-command.md`, `notes/todo.md`,
`notes/demo-guideline.md`, `notes/demo-guideline2.md`,
`notes/private-credentials.md`. This is the
single source for that list. Four entry points delete exactly this set
when the prologue ran first in the dir: `portfolio-init`, the campaign
`seed` fast-forward, and `backstage-init` (Part 4), each so the part's
own fixture starts from a clean slate, plus start-over (§Menu, resume,
wrap-up). Part 5 `cli` is the inverse
consumer: its `prologue-built` seed *lays* this fixture (the
connector-chapter subset, without `notes/private-credentials.md`)
instead of deleting it, see `fixtures.md` §Seed snapshots. Keep the list
here in sync if a prologue chapter adds or drops a demo file.

`<provider_dir>/agents/demo-agent.md`:
```markdown
---
name: demo-agent
description: |
  Example agent that handles read and shell tasks. Solo node at
  boot; gets connected to the rest of the demo fixture during the
  Live UI step.
tools: [Read, Bash]
model: sonnet
---

# demo-agent

Processes inputs and logs every action to stderr. Will be wired up
to the rest of the demo fixture later in the walkthrough.

Rules:
- Never run destructive commands without confirmation.
- Log every action to stderr.
```

`findings.md`:
```markdown
# Findings: sm-tutorial

If you spot anything weird during the tutorial, log it here.

Per finding:
- **Chapter**: <id>
- **Command**: `sm ...`
- **Expected**: ...
- **Got**: ...
- **Notes**: ...
```

`.skillmapignore` (tutorial entries + the minimum bundle defaults
the tutorial exercises; mirror new lines from
`src/config/defaults/skillmapignore` if a chapter starts exercising
them):
```
# Bundled defaults that matter inside the tutorial scope.
.git/
.skill-map/
.tmp/
.DS_Store

# sm-tutorial internal files. Without these, the first sm init scan
# reports the tutorial's own .md files as project nodes.
sm-tutorial.md
findings.md
tutorial-state.yml

# sm-tutorial skill installation (loaded as a project-local skill).
.claude/skills/sm-tutorial/
.agents/skills/sm-tutorial/

# Tutorial outputs that may land at the root.
export.*
dump.sql

# The reference-paths chapter spawns a self-contained sub-project
# under link-validation/hijoA with its own .skill-map/.
link-validation/
```

`tutorial-state.yml` (state shape **version 2**: a `parts.<id>`
map, each with a `chapters.<id>.status`):
```yaml
tutorial:
  version: 2
  started_at: "<ISO-8601 now>"
  cwd: "<output of pwd>"
  sm_version: "<output of sm version>"
  provider: "<claude | agent-skills | antigravity>"
tester:
  level: 2
  # site_identity: { name, tagline } is added by the daily-loop `setup`
  # chapter when the tester names their portfolio; absent until then.
parts: {}   # filled in as the tester picks parts from the menu
findings_file: "./findings.md"
```

When the tester picks a part from the menu, add its `parts.<id>`
entry the first time it starts, seeded from the manifest, e.g.:

```yaml
parts:
  fundamentals:
    status: "in_progress"   # not_started | in_progress | done | declined | skipped
    chapters:
      init:        { status: "pending" }   # pending | done | failed | skipped
      kinds:       { status: "pending" }
      # … one row per chapter in the part's manifest entry
```

Planned parts are not tracked until they have content. Parts the
`seed` mechanism fast-forwards past are recorded with `status:
"skipped"`.

## Entering a part

When a part begins, honour its `preflight` from the manifest:

- **`taught-init`** (Part 0): silently, before the tester's `sm init`
  in the `init` chapter, `Write` the demo fixture (the
  `<provider_dir>/agents/demo-agent.md` boot node, in the §Fixture
  blocks above), substituting `<provider_dir>` per detection. The
  universal `.skillmapignore` is already on disk from pre-flight, so
  the first scan never sees the tutorial's own files; nothing to lay
  here for it. The tester runs `sm init` themselves in the first
  chapter (`sm init` only writes `.skillmapignore` when absent, so it
  leaves the pre-flight one intact).
- **`portfolio-init`** (Part 1 `project-kickoff`): the campaign's
  real project begins. Backstage, before the tester's `sm init` in
  the `kickoff` chapter: (1) if the prologue ran first in this dir,
  clear its demo fixture so the map starts clean, delete ONLY the full
  Part 0 demo fixture set (§Fixture and state templates) plus the
  stale `.skill-map/` DB (a fresh `sm init` rebuilds it), never the
  tester's own files; (2) `Write` the portfolio fixture from
  `references/fixtures.md` (the Express skeleton + the handbook
  `AGENTS.md`); (3) append the portfolio additions (`node_modules/`,
  `public/`) to the universal `.skillmapignore` pre-flight already
  wrote (its tutorial internals are already there). The tester runs `sm init`
  themselves in the first chapter. (The later campaign parts use
  `preflight: seed` to fast-forward into them directly, see the `seed`
  case below; `portfolio-init` is just Part 1's flavour of that,
  handling the Part 0 to Part 1 transition.)
- **`backstage-init`** (Part 4 `extend`): the part teaches plugins on
  its own **master fixture**, distinct from both the demo and the
  portfolio, so on entry make the master fixture the only one on disk.
  Silently, with no narration: (1) clear whatever prior-part fixture is
  present so the master map starts clean (never the tester's own files;
  the universal `.skillmapignore` stays):
  - Part 0 demo fixture present (the tester came from the prologue) →
    delete the full Part 0 demo fixture set (§Fixture and state
    templates);
  - portfolio fixture present instead (the tester ran the campaign) →
    delete everything `portfolio-init` and the campaign chapters lay
    (see `fixtures.md` §Portfolio fixture + §Seed snapshots);
  - in either of those cases also drop the stale `.skill-map/` DB so a
    fresh init rebuilds it.
  (2) run `sm init --no-scan` from the cwd (the universal
  `.skillmapignore` from pre-flight is already on disk, so init leaves
  it intact and the tutorial's own files stay out of the scan); (3)
  `Write` the part's fixture (read `references/fixtures.md` for the
  verbatim `master-agent` / `master-skill` / `notes/ideas` files; skip
  kinds the provider doesn't claim). If nothing needed clearing and the
  dir was already initialised with the master fixture in place (Part 4
  re-entry), that is fine: skip the init and just ensure the fixture
  files are present.
- **`seed: prologue-built`** (Part 5 `cli`): the part reads the **Part 0
  demo fixture**, NOT the cumulative portfolio, so on entry make that
  fixture the one on disk. Read the state, then:
  - Demo fixture already present (the tester came straight from the
    prologue) → just `sm scan`, nothing to lay.
  - **Portfolio** fixture present instead (the tester ran the campaign)
    → clear it first (the inverse of `portfolio-init`: delete the
    portfolio fixture, everything `portfolio-init` and the campaign
    chapters lay, see `fixtures.md` §Portfolio fixture + §Seed snapshots,
    plus the stale `.skill-map/` DB; never the tester's own files), then
    lay the `prologue-built` snapshot from `fixtures.md` (§Seed
    snapshots), `sm init`, `sm scan`.
  - Nothing there → lay the snapshot, `sm init`, `sm scan`.
- **`seed`** (the campaign parts `connect-harness` and `daily-loop`):
  the part builds on the accumulating portfolio harness, but the tester
  may have jumped straight here from the menu. On entry, read the state
  file:
  - If every predecessor campaign part up the `prereq` chain is `done`
    → reuse the accumulated state; an `sm scan` to refresh is enough,
    nothing to lay.
  - Else → **fast-forward, silently** (backstage, do not narrate the
    plumbing): first, if the prologue ran first in this dir, clear the
    full Part 0 demo fixture set (§Fixture and state templates) so the
    seeded campaign map does not carry the prologue's demo nodes (the
    `sm scan` below reconciles the removed files out of the DB). Then
    lay the part's `seed` snapshot from
    `references/fixtures.md` (§Seed snapshots) by following its
    checklist, copy each file's canonical content from the chapter the
    row names, apply the `EDIT` rows on top, substituting
    `<provider_dir>` and skipping provider-unsupported kinds per
    `_core.md`. The snapshot's `.skillmapignore` additions
    (`node_modules/`, `public/`) are appended to the universal
    `.skillmapignore` pre-flight already wrote, so the tutorial's own
    `.claude/skills/sm-tutorial/` files stay out of the scan even on a
    direct jump here. Then run `sm init` if `.skill-map/` is missing
    (it will not overwrite that `.skillmapignore`), then `sm scan` so
    the map reflects the seeded harness. Mark the skipped
    predecessor campaign parts `skipped` in the state (they stay in the
    menu for later). Then emit exactly ONE tester-facing line:

    > I set the project up to where this part begins, so you can start
    > here. The earlier parts that build up to this are still in the
    > menu if you want them later.

  Either way, then walk the part's chapters.

Then walk the part's chapters in manifest order, dispatching each
chapter id to its `step_file` per the §Per-step cycle in `_core.md`
and the part's `pace`.

## Menu, resume, wrap-up

All three are specified in `_core.md`:

- **Routing + menu**: §Routing + menu. The session always starts at
  the **numbered start menu** (Part 0 is option 1, the recommended
  first pick); the menu (the ToC from `_manifest.yml`, numbered,
  completed parts ticked, `planned` parts hidden (so `mcp` stays out of
  the menu), `prereq` gating only seedless parts, none today since
  `cli` now self-seeds) is the entry point on the first
  invocation and after every part closes / on resume. Render it with
  the format in `_core.md` §Menu format.
- **Resume / restart**: §Resume / restart. On start-over, the exact
  wipe list is whatever the tester's parts actually created:
  `tutorial-state.yml`, `findings.md`, `.skillmapignore`,
  `.skill-map/`, the full Part 0 demo fixture set (§Fixture and state
  templates), the portfolio fixture if any campaign part ran (see
  `fixtures.md` §Portfolio fixture + §Seed snapshots, including the Daily
  Loop's own additions: `docs/draft.md`, `public/style.css` and the
  generated pages, the renamed `new-page` command, `AGENTS.sm`, and
  `.skill-map/settings.local.json`), the Part 4 fixture if `extend` ran
  (`<provider_dir>/agents/master-agent.md`,
  `<provider_dir>/skills/master-skill/`, `notes/ideas.md`,
  `.skill-map/plugins/`), `link-validation/` if the CLI part ran,
  and any `export.*` / `dump.sql`. Confirm `pwd` matches
  `tutorial.cwd` and require the literal `yes, wipe`.
- **Final wrap-up**: §Final wrap-up. Reached when the tester says
  they're done or finishes every available part.
