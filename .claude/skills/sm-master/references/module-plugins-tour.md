# Module: plugins-tour

Guided tour of the **built-in plugins** that ship with `sm`. Six
extension kinds, four bundles, twenty-seven extensions enabled by
default. The tester comes out of this knowing what each kind does,
how to inspect them, and how to toggle individual ones.

## Precondition check

Before announcing the first step, verify the fixture is initialised
(the cwd has `.claude/agents/master-agent.md` and
`.claude/skills/master-skill/SKILL.md`). If `master-state.yml`
exists but the fixture files are gone, refuse and surface the
state mismatch ("master-state.yml says we are running, but the
fixture is missing. Run `sm-master` from an empty dir or restore
the files.").

`.skill-map/` will NOT exist yet, that's what step 1 creates.

## Step `tour-1-init` — `sm init` and scan the fixture (~1 min)

**Context**: The other modules can run from a different fixture
shape; this one needs the initial scan to anchor everything to a
graph the tester can poke at.

First the tester runs `sm init` on its own (so the
`.skillmapignore` file exists before the agent appends to it):

```bash
sm init
```

Expected: `init` creates `.skill-map/skill-map.db` and
`settings.json` / `settings.local.json`, plus a starter
`.skillmapignore` at the cwd root.

**Then, before `sm scan` runs**, append the master-tutorial's
internal entries to the freshly created `.skillmapignore` (silent
backstage edit with `Edit`, per Inviolable rule #2). The append
MUST land before the scan; otherwise the scanner picks up
`sm-master.md` / `findings.md` as graph nodes:

```
# sm-master internal files
sm-master.md
master-state.yml
findings.md
```

Once the ignore is in place, run scan + list:

```bash
sm scan
sm list
```

Expected: `scan` walks the cwd and counts 3 nodes (`master-agent`,
`master-skill`, `notes/ideas`); `list` shows them with their kinds
(`agent`, `skill`, `markdown`). The internal files (`sm-master.md`,
`findings.md`) do NOT appear because the scanner respected the
ignore list.

Mark `tour-1-init: done`.

## Step `tour-2-anatomy` — what plugins are (~2 min)

**Context**: Before we touch any `sm plugins` verb, the tester
needs the mental model. This step is concept-only, no commands,
two minutes of "what each word means". The next step puts the
words into practice.

> Plugins are how skill-map gets extended. A **plugin** groups one
> or more **extensions**, the actual code units that run inside
> the kernel. So when we say "skill-map has a plugin for Claude",
> what we really mean is "there is a plugin called `claude` that
> contains one extension (a provider) which knows how to walk
> `.claude/`".
>
> Plugins ship as **bundles**. A bundle is the deployable unit,
> one directory with a `plugin.json` manifest and the extension
> code. Two ways they reach your project:
>
> - **Built-in bundles**, shipped inside the CLI itself, available
>   the moment you `npm install -g @skill-map/cli`.
> - **Drop-in bundles**, you (or someone else) place under
>   `<cwd>/.skill-map/plugins/` (project scope, committed to git)
>   or `~/.skill-map/plugins/` (user scope, your machine only).
>
> An extension has a **kind**. The kind tells the kernel where it
> plugs into the pipeline. There are exactly six kinds:
>
> | Kind | What it does | Example |
> |---|---|---|
> | **provider** | Decides which `.md` files belong to a node and what kind they are. | `markdown` |
> | **extractor** | Reads a node's body and emits structured findings (links, counts, annotations). | `markdown-link`, `external-url-counter`, `tools-count` |
> | **analyzer** | Cross-checks the scan and surfaces issues (broken refs, stale annotations, schema drift). | `broken-ref`, `stability`, `unknown-field` |
> | **action** | Performs a write operation on the graph or the filesystem (`sm bump` lives here). | `bump`, `mark-superseded` |
> | **formatter** | Renders a query result in a specific shape (`sm export --format md` and `--format json`). | `ascii`, `json` |
> | **hook** | Fires on a lifecycle event (`update-check` runs after `sm init`, etc.). | `update-check` |
>
> Putting it together: a **bundle** packages one or more
> **extensions**, each extension has a **kind**, the kind decides
> where it plugs into the kernel. So when you ran `sm scan` a
> moment ago: a **provider** sorted the three files into agent /
> skill / markdown, the **extractors** read each body, the
> **analyzers** then cross-checked everything. **Actions** only
> run when you ask (`sm bump`), **formatters** only when you call
> `sm export`, **hooks** ride lifecycle events.
>
> Heads up: every `sm plugins` verb you'll run in the next steps
> (list, show, doctor, disable, enable) is also available from
> the UI. From any `sm serve` session, open the **gear icon →
> Plugins** tab to browse and toggle plugins from there. CLI and
> UI hit the same store, so a change in one is reflected in the
> other. We'll stay in the CLI for this tour because it lays out
> the full surface in a few keystrokes, but day-to-day you can
> use either.

Mark `tour-2-anatomy: done`.

## Step `tour-3-list` — survey the built-in catalogue (~2 min)

> Now let's look at what's actually installed. `sm plugins list`
> shows every bundle the CLI shipped with, plus their source
> (built-in / user) and how many extensions each one carries.

```bash
sm plugins list
```

Expected output (the version numbers will drift, the shape will
not):

```
✓  claude        1 ext   built-in
     claude
✓  gemini        1 ext   built-in
     gemini
✓  agent-skills  1 ext   built-in
     agent-skills
✓  core         24 ext   built-in
     markdown, annotations, at-directive, external-url-counter, ...
```

Walk the tester through the four bundles:

> Four bundles came pre-installed:
>
> - **claude**: one provider extension that walks `.claude/` and
>   claims `.claude/agents/*.md`, `.claude/commands/*.md`, and
>   `.claude/skills/<name>/SKILL.md`. Vendor-specific to Anthropic
>   Claude Code.
> - **gemini**: one provider extension that walks `.gemini/` and
>   claims `.gemini/agents/*.md` and `.gemini/skills/<name>/SKILL.md`.
>   Empty on most machines that don't use Gemini CLI, that's fine.
> - **agent-skills**: one provider extension that walks
>   `.agents/skills/<name>/SKILL.md`, the **vendor-neutral open
>   standard** jointly adopted by Anthropic, OpenAI, and Google.
>   Owns the path so future Codex / Gemini integrations don't
>   collide.
> - **core**: the big one. 24 extensions covering the other five
>   kinds from the table you just read. Includes `core/markdown`
>   (the provider-agnostic fallback for any `.md` outside the
>   three vendor scopes, e.g. `notes/`, `CLAUDE.md`, `GEMINI.md`).
>
> The first three are **bundle-granularity**: you toggle the
> whole bundle on or off. `core` is **extension-granularity**:
> you can toggle individual extensions inside.
>
> 🔀 The three vendor providers are **siblings**, none of them
> reclaims another's path. Your fixture today lives under
> `<provider_dir>` because that's the provider detected at boot
> (see §Provider detection in `SKILL.md`); the other two
> providers are loaded and idle, waiting for files in their own
> directories.

If the tester wants to see the extensions inside `core` (24 rows
is a lot but the table is informative), run:

```bash
sm plugins show core
```

Each row carries `kind:id@version` so the tester can spot one of
each kind from the catalog they just learned.

Mark `tour-3-list: done`.

## Step `tour-4-show` — inspect one extension (~2 min)

> Let's pick one extension and look at its details. We'll use
> `core/external-url-counter`, an extractor that counts how many
> external URLs each node body contains.

```bash
sm plugins show core/external-url-counter
```

Expected: `show` accepts the qualified id but renders the
**parent bundle's** detail (the full `core` listing). The
extension you named lives in that list, highlighted by its row in
the table. This is by design, see §Why `show` resolves up below.

> Notice the verb did not narrow to a single extension. That is
> deliberate, ask me if you want the reasoning.

If the tester asks: **Why `show` resolves up**.

> Forcing you to memorise the bundle id just to read one
> extension's row would be hostile. So `show` accepts the
> qualified form `<bundle>/<ext-id>` and resolves up to the
> bundle. To narrow further, scroll the table or use
> `sm plugins doctor` (which gives a per-extension status).

Mark `tour-4-show: done`.

## Step `tour-5-doctor` — run `sm plugins doctor` (~2 min)

> `doctor` is the diagnostic verb. It reports every plugin and
> extension status in one go: enabled, disabled, load errors,
> spec compatibility, manifest validity.

```bash
sm plugins doctor
```

Expected on a clean machine: `27 enabled · 0 issues · 0 warnings`.
If any plugin reports a load error, manifest validity issue, or
spec-compatibility mismatch, `doctor` is the verb that flags it.
On a fresh install over the fixture you should see zero of each.

Mark `tour-5-doctor: done`.

## Module wrap-up

> All set. You now know:
>
> - Four bundles ship pre-installed (`claude`, `gemini`,
>   `agent-skills`, `core`).
> - Six extension kinds (provider, extractor, analyzer, action,
>   formatter, hook).
> - How to list, inspect, and diagnose extensions.
>
> Disabling and re-enabling extensions was already covered in the
> basic tutorial (Step 12), so we skip it here, the verbs are the
> same: `sm plugins disable <id>` / `sm plugins enable <id>`.
>
> Anything weird worth logging? If not, back to the menu.

Mark module `plugins-tour: done` in `master-state.yml`, update the
matching harness task, return to the menu in `SKILL.md`.

## Reference: how `sm` decides what to load

Not for the tester unless they ask. Cheat sheet for the agent:

- Built-in plugins live inside the CLI bundle and are always
  discovered first.
- User plugins live under `~/.skill-map/plugins/` (per-user) or
  `<cwd>/.skill-map/plugins/` (per-project). The authoring module
  uses the per-project path.
- Load order: built-in → user (project beats user-global on id
  collisions, surfaced by `doctor`).
- `disable`/`enable` writes the state into the project DB; it
  survives restarts.
