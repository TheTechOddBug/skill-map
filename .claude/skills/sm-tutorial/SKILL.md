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
> catalogue. Never say "part 6", "chapter id", "the settings tour"
> out loud. Use the friendly titles from the manifest.

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

> ⚠️ Heads up: throughout the tutorial you'll be using **two
> terminals**.
>
> 1. **This terminal**: the one you're using right now to talk to
>    me (Claude Code). I show you the commands, you paste me the
>    output, and I verify.
> 2. **A second terminal**: open it now (new window or tab). In it
>    run `cd <cwd>` so it's anchored **exactly to this folder**.
>    That's where you copy and paste every `sm` command.
>
> Keep both terminals open until the end. If you accidentally close
> the second one, reopen it and `cd <cwd>` again.
>
> Got the second terminal open and anchored to the folder? Confirm
> before we move on.

### 5. Lay the Part 0 fixture and route

Part 0 (`fundamentals`) is `preflight: taught-init`: pre-lay its
fixture now (silently), so the tester's `sm init` in the `init`
chapter produces a clean scan, but the tester runs `sm init`
themselves. Write, substituting `<provider_dir>` per detection:

- `<provider_dir>/agents/demo-agent.md` (the single boot node).
- `.skillmapignore` (block below). Write it NOW, before `sm init`,
  so the first scan never sees the tutorial's own files. `sm init`
  only writes `.skillmapignore` when absent, so this stays put.
- `findings.md` (block below).
- `tutorial-state.yml` (template below).

Then **route** per §Routing in `_core.md`: no prior state → enter
Part 0 at chapter `init`, **with no menu**. After Part 0 closes,
render the ToC menu.

## Fixture blocks (Part 0 / `taught-init`)

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
parts:
  fundamentals:
    status: "in_progress"   # not_started | in_progress | done | declined
    chapters:
      init:        { status: "pending" }   # pending | done | failed | skipped
      kinds:       { status: "pending" }
      first-edit:  { status: "pending" }
      connectors:  { status: "pending" }
      inspector:   { status: "pending" }
      edit-link:   { status: "pending" }
      workspace:   { status: "pending" }
      ignore:      { status: "pending" }
findings_file: "./findings.md"
```

When the tester enters another part from the menu, add a
`parts.<id>` entry for it (with a `chapters` map seeded from the
manifest) the first time it starts. Planned parts are not tracked
until they have content.

## Entering a part

When a part begins, honour its `preflight` from the manifest:

- **`taught-init`** (Part 0): the fixture + `.skillmapignore` were
  pre-laid in pre-flight; the tester runs `sm init` inside the
  first chapter. Nothing to do here.
- **`backstage-init`** (Part 6 `extend`): silently, with no
  narration: run `sm init --no-scan` from the cwd, then `Edit` the
  freshly created `.skillmapignore` to append the tutorial's
  internal entries (the `sm-tutorial.md` / `findings.md` /
  `tutorial-state.yml` / skill-dir block above), then `Write` the
  part's fixture (read `references/fixtures.md` for the verbatim
  `master-agent` / `master-skill` / `notes/ideas` files; skip kinds
  the provider doesn't claim). If `sm init --no-scan` fails because
  the dir was already initialised by an earlier part, that is fine:
  the DB already exists, skip the init and just ensure the fixture
  files are present.
- **`reuse`** (Part 7 `cli`): assumes the fundamentals fixture and
  `.skill-map/` already exist. The menu only offers this part when
  its `prereq` (`fundamentals`) is done, so they will. If
  `.skill-map/` is somehow missing, point the tester back to the
  prologue rather than re-initialising mid-part.

Then walk the part's chapters in manifest order, dispatching each
chapter id to its `step_file` per the §Per-step cycle in `_core.md`
and the part's `pace`.

## Menu, resume, wrap-up

All three are specified in `_core.md`:

- **Routing + menu**: §Routing + menu. The first-timer skips the
  menu and lands in Part 0; the menu (the ToC rendered from
  `_manifest.yml`, completed chapters ticked, `planned` parts
  hidden, `prereq` respected) appears after a part closes or on
  resume.
- **Resume / restart**: §Resume / restart. On start-over, the exact
  wipe list is whatever the tester's parts actually created:
  `tutorial-state.yml`, `findings.md`, `.skillmapignore`,
  `.skill-map/`, the Part 0 fixture
  (`<provider_dir>/agents/demo-agent.md`,
  `<provider_dir>/skills/demo-skill/`,
  `<provider_dir>/commands/demo-command.md`, `notes/todo.md`,
  `notes/demo-guideline.md`, `notes/private-credentials.md`), the
  Part 6 fixture if `extend` ran
  (`<provider_dir>/agents/master-agent.md`,
  `<provider_dir>/skills/master-skill/`, `notes/ideas.md`,
  `.skill-map/plugins/`), `link-validation/` if the CLI part ran,
  and any `export.*` / `dump.sql`. Confirm `pwd` matches
  `tutorial.cwd` and require the literal `yes, wipe`.
- **Final wrap-up**: §Final wrap-up. Reached when the tester says
  they're done or finishes every available part.
