# Part 6 (b): Extend skill-map - plugins (step library, `tour-*` ids)

Guided tour of the **built-in plugins** that ship with `sm`. Three
steps: a quick mental model of what plugins are plus a peek at
the catalogue, then the six extension kinds rounded off by opening
one plugin to see them in the wild, and finally a deeper drill
into a single extension (detail view, diagnostic, disable/enable
toggle). By the end the tester has the mental model and knows
which verbs reach which surface.

## Precondition check

Before announcing the first step, verify the fixture is initialised
(the cwd has `.claude/agents/master-agent.md`,
`.claude/skills/master-skill/SKILL.md`, AND `.skill-map/` with
`settings.json` and `skill-map.db`). The `extend` part's
`backstage-init` preflight ran `sm init --no-scan` to provision it;
the universal `.skillmapignore` from pre-flight keeps the tutorial's
own files out of the scan. If any of that is missing, surface the
bootstrap mismatch ("tutorial-state.json says we are running, but
the bootstrap is missing. Re-run the tutorial from an empty dir or
restore the files.") and stop.

## Step `tour-1-intro` - how plugins work (~4 min)

> Plugins are how skill-map gets extended. A **plugin** is the
> deployable unit: one directory with a `plugin.json` manifest and,
> per extension, an `extension.json` beside its code. It groups one
> or more **extensions**, the
> actual code units that run inside the kernel. So when we say
> "skill-map has a plugin for Claude", what we really mean is
> "there is a plugin called `claude` that contains one extension
> (a provider) which knows how to walk `.claude/`".
>
> Two ways plugins reach your project:
>
> 📦 **Built-in plugins**
>    Travel inside the CLI itself. Available the moment you
>    `npm install -g @skill-map/cli`.
>
> 📥 **Drop-in plugins**
>    You (your company, or someone else) drop them by hand under
>    `<cwd>/.skill-map/plugins/`. The directory lives inside the
>    project, so a plugin committed here travels with the repo
>    and the rest of the team picks it up on the next pull.

> Now let's look at what's actually installed. `sm plugins list`
> shows every plugin the CLI shipped with. Run it in your second
> terminal:

```bash
sm plugins list
```

> There are the five plugins. The next step zooms into the six
> kinds of extension that a plugin can carry, you'll see at least
> one of each living inside `core`.

Mark `tour-1-intro: done`.

## Step `tour-2-kinds` - the six extension kinds (~5 min)

> An extension has a **kind**. The kind tells the kernel where it
> plugs into the pipeline. There are exactly six kinds:
>
> 🗂️ **provider**
>    Decides what kind each `.md` file is. The `claude` provider,
>    for instance, walks `.claude/` and types each file it finds
>    (agent, command, or skill).
>    Examples: `claude`, `antigravity`, `codex`, `agent-skills`.
>
> 🔍 **extractor**
>    Reads a node's body and emits structured findings (links,
>    counts, annotations).
>    Example: `markdown-link`, `external-url-counter`, `tools-counter`.
>
> 🩺 **analyzer**
>    Cross-checks the scan and emits issues plus various
>    detections (errors, warnings, informational signals: broken
>    refs, stale annotations, schema drift, and more).
>    Example: `reference-broken`, `node-stability`, `annotation-field-unknown`.
>
> ⚡ **action**
>    Performs a write operation on a node, the graph, or the
>    filesystem. May modify your `.md` files (frontmatter, body)
>    ONLY with your explicit permission.
>    Examples: `node-bump`, `node-set-stability`.
>
> 🎨 **formatter**
>    Renders a result in a specific shape (`sm export --format md`
>    and `--format json`).
>    Example: `ascii`, `json`.
>
> 🎣 **hook**
>    Fires on one of 10 lifecycle events (`boot`, `scan.started`,
>    `shutdown`, etc.). `update-check`, for instance, listens on
>    `boot` and prints a banner if a newer skill-map is available
>    on npm.
>    Example: `update-check`.
>
> Putting it together: a **plugin** packages one or more
> **extensions**, each extension has a **kind**, the kind decides
> where it plugs into the kernel.
>
> Heads up: every `sm plugins` verb you'll run in this part is
> also available from the UI. From any `sm` session, open the
> **Settings** panel (the sliders icon, top-right) and its
> **Plugins** tab to browse and toggle plugins from there. CLI and
> UI use the same store, so a change in one is reflected in the
> other.

> Now let's see those six kinds inside a real plugin. Open `core`
> in your second terminal:

```bash
sm plugins list core
```

Expected: the extensions grouped by kind, each row showing its
kind and qualified id (e.g. `extractor  core/markdown-link`). You
can spot at least one of each of the six kinds you just read about,
all packed into a single plugin. A few rows are marked `✕` with an
`(experimental)` tag, those extensions ship disabled by default;
you'll toggle one yourself in the next step.

Mark `tour-2-kinds: done`.

## Step `tour-3-explore` - explore one extension up close (~4 min)

> Pick one extension and look at its details. We'll use
> `core/external-url-counter`, an extractor that counts how many
> external URLs each node body contains:

```bash
sm plugins show core/external-url-counter
```

Expected: a focused detail block for that one extension, the header
line (`✓ core/external-url-counter built-in`) plus its Kind
(`extractor`) and Description.

> Now run the diagnostic. The `doctor` verb reports every plugin
> and extension status in one go: enabled, disabled, load errors,
> spec compatibility, manifest validity.

```bash
sm plugins doctor
```

Expected on a clean machine: `30 enabled extensions · 0 issues · 0 warnings`.
That counts the enabled extensions only, the experimental ones you
saw marked `✕` ship disabled, so they sit outside this total. If any
plugin reports a load error, manifest validity issue, or
spec-compatibility mismatch, `doctor` is the verb that flags it.

> Last, toggle one extension off and back on so you see the state
> persists across CLI invocations. We'll use the same one you
> inspected above:

```bash
sm plugins disable core/external-url-counter
sm plugins list core
sm plugins enable core/external-url-counter
sm plugins list core
```

Expected: between the two `list core` calls, the
`core/external-url-counter` row flips its marker from `✓` (enabled)
to `✕` (disabled) and back. The change persists in the project DB;
if you restarted `sm`, the disabled state would still be there.

Mark `tour-3-explore: done`.

## Wrap-up

> All set. You now know:
>
> - What plugins, extensions, and the six kinds are.
> - Five plugins ship pre-installed (`claude`, `antigravity`,
>   `codex`, `agent-skills`, `core`).
> - How to list, inspect, diagnose, and toggle extensions from
>   the CLI (and the same lives in the UI).
>
> If you want to dig deeper, the next chapters take you into
> authoring your own plugin and into settings + view-slots. Or
> if you've seen enough, "I'm done for today" closes us out.
>
> Anything weird worth logging? If not, back to the menu.

Mark the chapters done (rule #4) and return to the menu in `SKILL.md`.

## Reference: how `sm` decides what to load

Not for the tester unless they ask. Cheat sheet for the agent:

- Built-in plugins live inside the CLI bundle and are always
  discovered first.
- Project plugins live under `<cwd>/.skill-map/plugins/`; the
  authoring chapters use this path. There is no user / global
  scope, `-g/--global` and `~/.skill-map/plugins/` were removed
  in v0.27.x.
- Load order: built-in → project (project ids that collide with
  built-in are surfaced by `doctor`).
- `disable`/`enable` writes the state into the project DB; it
  survives restarts.
- Escape hatch for one-off probing without committing a plugin to
  the project: pass `--plugin-dir <path>` on the `sm plugins …`
  verb family.
