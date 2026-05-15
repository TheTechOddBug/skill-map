# Module: plugins-tour

Guided tour of the **built-in plugins** that ship with `sm`. Two
steps: a conceptual README plus a peek at the catalogue, then a
deeper drill into `core` (the big bundle) including a single
extension's detail, the diagnostic verb, and the disable/enable
toggle. By the end the tester has the mental model and knows
which verbs reach which surface.

## Precondition check

Before announcing the first step, verify the fixture is initialised
(the cwd has `.claude/agents/master-agent.md`,
`.claude/skills/master-skill/SKILL.md`, AND `.skill-map/` with
`settings.json` and `skill-map.db`). Pre-flight already ran
`sm init --no-scan` and appended the master entries to
`.skillmapignore`. If any of that is missing, surface the
bootstrap mismatch ("master-state.yml says we are running, but
the bootstrap is missing. Run `sm-master` from an empty dir or
restore the files.") and stop.

## Step `tour-1-intro` — how plugins work (~5 min)

**Context**: A short tour of the plugin model: what they are,
how they're packaged, the six kinds of extension, and a peek at
the four bundles that ship pre-installed. Mostly reading; one CLI
verb at the end to see the catalogue.

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
> - **provider**
>   Decides which `.md` files belong to a node and what kind they
>   are.
>   Example: `markdown`.
>
> - **extractor**
>   Reads a node's body and emits structured findings (links,
>   counts, annotations).
>   Example: `markdown-link`, `external-url-counter`, `tools-count`.
>
> - **analyzer**
>   Cross-checks the scan and surfaces issues (broken refs, stale
>   annotations, schema drift).
>   Example: `broken-ref`, `stability`, `unknown-field`.
>
> - **action**
>   Performs a write operation on the graph or the filesystem. May
>   modify your `.md` files (frontmatter, body) ONLY with your
>   explicit permission. Each action asks for confirmation before
>   touching disk.
>   Example: `mark-superseded`.
>
> - **formatter**
>   Renders a query result in a specific shape (`sm export
>   --format md` and `--format json`).
>   Example: `ascii`, `json`.
>
> - **hook**
>   Fires on a lifecycle event (`update-check` runs after `sm
>   init`, etc.).
>   Example: `update-check`.
>
> Putting it together: a **bundle** packages one or more
> **extensions**, each extension has a **kind**, the kind decides
> where it plugs into the kernel. **Actions** only run when you
> ask and prompt before modifying anything, **formatters** only
> when you call `sm export`, **hooks** ride lifecycle events.
>
> Heads up: every `sm plugins` verb you'll run in this tour is
> also available from the UI. From any `sm serve` session, open
> the **gear icon → Plugins** tab to browse and toggle plugins
> from there. CLI and UI hit the same store, so a change in one
> is reflected in the other. We'll stay in the CLI for the tour
> because it lays out the full surface in a few keystrokes.

Now let's look at what's actually installed. `sm plugins list`
shows every bundle the CLI shipped with, plus their source
(built-in / user) and how many extensions each one carries.
Run it in your second terminal:

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

> Four bundles came pre-installed. The first three are **vendor
> providers**: each one ships a single provider extension that
> claims a vendor-specific path on disk, sorts the `.md` files
> living there into the right node kind, and stays silent on
> everything else. They differ only in *which* path and *whose*
> standard they implement:
>
> - **claude**: walks `.claude/`, claims `.claude/agents/*.md`,
>   `.claude/commands/*.md`, and `.claude/skills/<name>/SKILL.md`.
>   Vendor-specific to Anthropic Claude Code.
> - **gemini**: walks `.gemini/`, claims `.gemini/agents/*.md` and
>   `.gemini/skills/<name>/SKILL.md`. Empty on most machines that
>   don't use Gemini CLI, that's fine.
> - **agent-skills**: walks `.agents/skills/<name>/SKILL.md`, the
>   **vendor-neutral open standard** jointly adopted by Anthropic,
>   OpenAI, and Google. Owns the path so future Codex / Gemini
>   integrations don't collide.
>
> The fourth bundle is different:
>
> - **core**: the big one. 24 extensions covering the other five
>   kinds. Includes `core/markdown` (the provider-agnostic
>   fallback for any `.md` outside the three vendor scopes, e.g.
>   `notes/`, `CLAUDE.md`, `GEMINI.md`).
>
> The three vendor bundles are **bundle-granularity**: you toggle
> the whole bundle on or off. `core` is **extension-granularity**:
> you can toggle individual extensions inside with
> `sm plugins disable <id>` and `sm plugins enable <id>`. We'll
> try that in the next step.
>
> Your set de prueba today lives under `<provider_dir>` because
> that's the provider detected at boot.

Mark `tour-1-intro: done`.

## Step `tour-2-explore` — explore `core` up close (~5 min)

**Context**: Drill into the big bundle, see one extension's
detail, run the diagnostic, then toggle one off and back on so
you see the change persists.

First, open the `core` bundle to see what's inside:

```bash
sm plugins show core
```

Expected: a table with 24 rows, each carrying `kind/id@version`.
You can spot one of each of the six kinds the previous step
walked through.

Now pick a single extension. `core/external-url-counter` is an
extractor that counts how many external URLs each node body
contains:

```bash
sm plugins show core/external-url-counter
```

Expected: a focused detail block for that one extension (header,
Kind, Version, Stability, Description, Preconditions, Entry). If
instead the whole `core` listing comes back, you're on an older
`sm` (pre-0.27.x): the qualified-id detail view shipped in a
later patch. The tour still works, you just see more rows than
intended on that one command.

Now run the diagnostic:

> The diagnostic verb reports every plugin and extension status
> in one go: enabled, disabled, load errors, spec compatibility,
> manifest validity.

```bash
sm plugins doctor
```

Expected on a clean machine: `27 enabled · 0 issues · 0 warnings`.
If any plugin reports a load error, manifest validity issue, or
spec-compatibility mismatch, `doctor` is the verb that flags it.

Last, toggle one extension off and back on so you see the state
persists across CLI invocations. We'll use the same one you
inspected above:

```bash
sm plugins disable core/external-url-counter
sm plugins doctor
sm plugins enable core/external-url-counter
sm plugins doctor
```

Expected: between the two `doctor` calls, the
`core/external-url-counter` row flips from `enabled` to
`disabled` and back. The change persists in the project DB; if
you restarted `sm`, the disabled state would still be there.

Mark `tour-2-explore: done`.

## Module wrap-up

> All set. You now know:
>
> - What plugins, extensions, bundles, and the six kinds are.
> - Four bundles ship pre-installed (`claude`, `gemini`,
>   `agent-skills`, `core`).
> - How to list, inspect, diagnose, and toggle extensions from
>   the CLI (and the same lives in the UI).
>
> If you want to dig deeper, the next two menu options take you
> into authoring your own plugin and into settings + view-slots.
> Or if you've seen enough, "I'm done for today" closes us out.
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
