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

```bash
sm init
sm scan
sm list
```

Expected: `init` creates `.skill-map/skill-map.db` and
`settings.json` / `settings.local.json`; `scan` walks the cwd and
counts 3 nodes (`master-agent`, `master-skill`, `notes/ideas`);
`list` shows them with their kinds (`agent`, `skill`, `markdown`).

After `sm init`, append the master-tutorial's internal entries to
`.skillmapignore` (silent backstage edit, per Inviolable rule #2):

```
# sm-master internal files
sm-master.md
master-state.yml
findings.md
sm-master-report.md
```

Mark `tour-1-init: done`.

## Step `tour-2-list` — survey the built-in catalogue (~2 min)

> Now let's look at what's already running. `sm plugins list`
> shows every plugin **bundle** the CLI shipped with, plus their
> source (built-in / user) and how many extensions each one has.

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
> - **claude**: one provider extension that knows how to read
>   files under `.claude/` (the directory you've been authoring
>   into). Tells `sm` "this `.md` is a Claude agent / skill /
>   command".
> - **gemini**: same idea for `~/.gemini/`. Empty on most
>   machines, that's fine.
> - **agent-skills**: same idea for `.agents/`. Also typically
>   empty.
> - **core**: the big one. 24 extensions covering the four other
>   kinds you'll learn next.
>
> The first three are **bundle-granularity**: you toggle the
> whole bundle on or off. `core` is **extension-granularity**:
> you can toggle individual extensions inside.

Mark `tour-2-list: done`.

## Step `tour-3-kinds` — the six extension kinds (~3 min)

**Context**: `core` is the easiest bundle to learn against because
it has at least one extension of every kind. Read the table to the
tester, do NOT make them memorise it.

> Inside `core` there are **six kinds of extension**. Each kind
> does a different job. Here is the catalogue:
>
> | Kind | What it does | Example in `core` |
> |---|---|---|
> | **provider** | Decides which `.md` files belong to a node and what kind they are. | `markdown` |
> | **extractor** | Reads a node's body and emits structured findings (links, counts, annotations). | `markdown-link`, `external-url-counter`, `tools-count` |
> | **analyzer** | Cross-checks the scan and surfaces issues (broken refs, stale annotations, schema drift). | `broken-ref`, `stability`, `unknown-field` |
> | **action** | Performs a write operation on the graph or the filesystem (`sm bump` lives here). | `bump`, `mark-superseded` |
> | **formatter** | Renders a query result in a specific shape (`sm export --format md` and `--format json`). | `ascii`, `json` |
> | **hook** | Fires on a lifecycle event (`update-check` runs after `sm init`, etc.). | `update-check` |
>
> So when you ran `sm scan` a moment ago: the **provider** sorted
> the three files into agent / skill / markdown, the
> **extractors** read each body, the **analyzers** then
> cross-checked everything. **Actions** only run when you ask
> (`sm bump`), **formatters** only when you call `sm export`,
> **hooks** ride lifecycle events.

To make it concrete, ask the tester to spot one of each kind by
running:

```bash
sm plugins list
sm plugins show core
```

The second command dumps the full `core` extension table with one
row per extension, showing the kind inline. The tester should be
able to pick out two extractors, two analyzers, two formatters,
etc.

Mark `tour-3-kinds: done`.

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

Some machines will surface informational warnings about
`explorationDir` not existing for `gemini/gemini` (`~/.gemini`) or
`agent-skills/agent-skills` (`.agents`). These are normal on a
machine that has not installed those tools, the providers declare
optional discovery paths and warn when the path is absent.
Nothing is broken; the providers just have nothing to scan.

> If you see warnings about `gemini` or `agent-skills`, those are
> normal. They are providers looking for their tool's directory
> (`~/.gemini`, `.agents`). On a machine that does not have those
> tools installed, the path is absent and the provider warns.
> Not a bug, just absence.

Mark `tour-5-doctor: done`.

## Step `tour-6-toggle` — disable and re-enable an extension (~2 min)

> Last step. We'll turn off one extension, watch the effect, then
> turn it back on. We pick `core/external-url-counter` because
> disabling it has the smallest blast radius (no other extension
> depends on its output).

First, give the tester a baseline: how many external-URL counts
exist on the current scan. Read `notes/ideas.md` and any other
fixture file to remind them what counts exist (the fixture above
has zero external URLs, so the baseline is `0`). Then:

```bash
sm plugins disable core/external-url-counter
sm plugins list
```

Expected: `list` now shows `core/external-url-counter` as
`disabled` (the symbol changes from ✓ to ○ or similar; the rest of
`core` stays enabled because it is extension-granularity).

> The extension is off. If we had real URLs in the fixture, a
> re-scan would no longer emit counts for them. Let's turn it
> back on.

```bash
sm plugins enable core/external-url-counter
sm plugins list
```

Expected: back to ✓ enabled.

> **Heads-up on ids**: `disable` and `enable` accept either the
> bundle id (`core`, toggles every extension in that bundle at
> once) OR the qualified extension id `<bundle>/<ext-id>`. The
> form you see in `plugins list` (`extractor:core/...@1.0.0`)
> includes the kind prefix and the version for readability,
> strip both when calling `disable` / `enable`. The bundles
> `claude`, `gemini`, and `agent-skills` are
> bundle-granularity, you can only toggle the whole bundle on
> those.

Mark `tour-6-toggle: done`.

## Module wrap-up

> All set. You now know:
>
> - Four bundles ship pre-installed (`claude`, `gemini`,
>   `agent-skills`, `core`).
> - Six extension kinds (provider, extractor, analyzer, action,
>   formatter, hook).
> - How to list, inspect, diagnose, and toggle extensions.
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
