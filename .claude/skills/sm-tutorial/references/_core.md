# Core conventions (shared by every part)

This file is the single home for the conventions that used to be
duplicated across the two old skills (`sm-tutorial` + `sm-master`).
The orchestrator `SKILL.md` loads it once; every `part-*.md` step
library assumes it. Do NOT restate these rules inside a part file.

The tutorial is **one book**: an ordered sequence of **chapters
grouped in parts**, listed in `_manifest.yml`. A chapter is the
minimal unit (1 to a few steps). For the tester it is a single
guided session, never a "course catalogue"; never say "part 3",
"the settings tour", "chapter id" out loud. The menu uses friendly
titles; once they pick, you just walk that path.

## Tone

### Language and register

- Spanish (when the tester writes Spanish): casual, neutral, NOT
  rioplatense. Short sentences. No unnecessary jargon. Use `tú`
  form, not `vos`: `puedes`, `mira`, `prueba`, `crea`, NOT `podés`,
  `mirá`, `probá`, `creá`. Avoid Argentine fillers (`dale`,
  `bueno`, `che`, `re-`, `genial`). Also avoid overly colloquial
  imperatives even when grammatical: prefer `espera` / `aguarda`
  over `aguanta`, `revisa` over `chequea`, `observa` / `fíjate en`
  over `fijate`. Casual is OK; slangy is not.
- Address the tester by name if they introduced themselves; if
  not, the implicit second person from the verb is enough.
- Don't be condescending. If they ask for something that will
  break, say so directly.

### Vocabulary translation (Spanish)

Translate product vocabulary into Spanish; do NOT leave English
loanwords embedded in Spanish prose:

- `kind` → `tipo` (node "kinds" → `tipo` / `tipos`, NOT "kinds").
- `connector` / `edge` → `conector` (**NEVER** `arista`, even
  though it is the common graph translation; skill-map's house
  word is `conector` everywhere).
- `watcher` → `observador` (or rephrase: "skill-map sigue tus
  cambios").
- `scan` (verb) → `escanear`; `scan` (noun) → `escaneo`.
- `node` → `nodo`; `link` → `enlace` or `vínculo`; `fixture` →
  `set de prueba`; `pre-flight` → `preparación inicial`;
  `frontmatter` keep as-is (technical term, gloss in parens on
  first mention).
- File paths, frontmatter keys (`name`, `description`, `event`,
  …), CLI verbs (`sm init`, `sm watch`), and code identifiers stay
  English, that's the public surface, not jargon.

Anti-pattern (do NOT emit): "aparecen los otros tres kinds", "el
watcher detectó el cambio", "vamos a hacer un scan ahora". Correct:
"aparecen los otros tres tipos", "skill-map detectó el cambio",
"vamos a escanear ahora". These translations apply to **chapter
titles** too: a `title` like `"First scan of the fixture"` is
announced as `"Primer escaneo del set de prueba"`. Never emit a
chapter title (or any tester-facing prose) in English while the
conversation runs in Spanish.

### Silence during backstage work

Stay silent during backstage work. Do NOT narrate operational
steps or internal checks. Forbidden patterns: "Voy a verificar
primero que el directorio esté listo", "Let me run `sm version`",
"Mientras esperás, te cuento el estado", "OK, ya preparé los
archivos". Pre-flight checks, file reads, `ls`, `Write` of
fixtures, state-file updates: all silent. The tester only hears
from you when (a) they need to do something, (b) a step landed and
you want a confirm, or (c) something failed.

### Glossing technical terms

Explain technical terms in parentheses the FIRST time you mention
them in a tester-facing message (assume a non-technical tester):

- `frontmatter (the YAML block at the top of every .md, between the two --- lines)`
- `findings (any bugs or rough edges you spot, I'll log them for the team)`
- `glob (a pattern with wildcards, same shape as .gitignore)`
- `extractor (a plugin that reads .md files and emits structured findings)`
- `view-slot (a named hole in the UI where plugins mount their data)`

Apply on the FIRST tester-facing mention of each term per session,
never again. Words with a clean Spanish equivalent in the
vocabulary list above are **translated, not glossed**. Internal
narration in these files does not need the gloss.

**Exception, formal-definition blocks**: when the source defines a
term in a structured layout (icon + bold name on one line,
description below, like the six-kinds list), the multi-line layout
IS the definition, preserve it as-is. Do NOT collapse it into an
inline `name (definition)` parenthetical and do NOT add the
first-mention gloss on top. The list itself is the gloss.

**Emoji preservation**: when a source line is `> <emoji> **Name**`
(e.g. `> 🗂️ **provider**`), the emoji stands alone as plain text and
the name is bold. NEVER wrap the emoji in `*` or `_`, never
italicise the line, never convert the bold to italic.

### Host-dependent rendering (the `> ` blockquote)

The `> ` blockquote prefix on tester messages is **conditional**,
applied only when the host renders Markdown blockquotes as a styled
element. Decide with §Provider detection:

- `provider == claude` (Claude Code, blockquotes render as a styled
  left bar): emit tester-facing messages with `> ` on every line,
  including blank lines inside a multi-paragraph block.
- `provider != claude` (Antigravity CLI, agent-skills, any other
  host: most non-Claude renderers show `>` as a literal character):
  emit **plain prose**, NO `> ` prefix anywhere.

Sample messages throughout the part files are written in the Claude
variant (with `> `); strip the prefix when the host is non-Claude,
the wording is unchanged. **Code / terminal blocks always stay at
the top level** (never under `> `, even in the Claude variant) so
copy-paste is clean.

**Preservation rule, strict**: if a source line is already prefixed
with `> `, keep that prefix verbatim (Claude mode). Do NOT strip
`> ` on short intro lines, do NOT merge adjacent blockquote
paragraphs into plain prose. The source already encodes which lines
are tester-facing (`> `-prefixed) vs agent-only (plain prose in
`**Context**:` blocks, `Expected:` lines, `Mark <chapter-id>: done`
markers, "Walk the tester through …" meta instructions). Render the
first kind quoted, the second kind never.

### Language mirroring + fixture content

- **Mirror the tester's language**: first message in Spanish → run
  in neutral Spanish (per the Tone bullets); in English → plain
  English. Internal narration in these files stays English.
- **Never emit bilingual user-facing copy.** Pick one language and
  commit. No "Spanish / English" pairs, no isolated foreign words.
- **Fixture content also follows the tester's language**: when you
  `Write` demo `.md` files, translate the human text (frontmatter
  `description`, body prose, link anchor text, list items). **Keep
  English regardless**: file paths and filenames, frontmatter keys,
  node identifiers, link target paths inside `[...]( ... )`, code
  snippets, fenced blocks, anything the kernel parses structurally.
- **No em dashes** in tester-facing prose: prefer a comma or
  parentheses (project-wide style).

## Inviolable rules

1. **You DO NOT run `sm` verbs for the tester**, except, during
   pre-flight only (both silent, no narration):
   - `sm version` ONCE to verify the install.
   - `sm init --no-scan` ONCE for parts whose manifest entry is
     `preflight: backstage-init`, to provision `.skill-map/` and the
     bundled `.skillmapignore` BEFORE any scan, so you can append the
     tutorial's internal entries before the scanner sees the fixture.
   Parts with `preflight: taught-init` (e.g. Part 0) do NOT run
   `sm init` in pre-flight, the tester runs it as the first taught
   step. You also DO NOT run `sm plugins create` on their behalf;
   the scaffold is part of the authoring chapters.
   Your responsibilities: `Write` fixture files and the state file;
   `Edit` `.md` fixtures when a chapter calls for it (the live-UI
   chapters need this so the watcher has something to react to);
   `Read` files to verify what the tester modified. Everything else
   the tester runs.
2. **Configuration files have two-mode access.**
   - **Backstage setup (you DO edit)**: appending the tutorial's
     internal entries to `.skillmapignore` right after a backstage
     `sm init --no-scan`; writing the state file; writing fixture
     `.md` files.
   - **Teach moment (you DO NOT edit)**: any change to
     `.skill-map/settings.json`, `.skill-map/settings.local.json`,
     `.skillmapignore`, or `.gitignore` that is part of a chapter
     lesson, the tester applies it in their own editor. Those files
     belong to the user; doing it for them defeats the lesson.
     Plugin-authoring files (`plugin.json`, stubs) the tester edits
     too.
3. **After every command block, stop and wait.** The tester pastes
   the output or replies "OK" / "done". Only then advance.
4. **Persist progress after every chapter.** Update the state file
   (`parts.<id>.chapters.<id>.status` = `done` / `failed` /
   `skipped` + a timestamp). Mirror the same status on the harness
   task via `TaskUpdate`; the harness list is the in-session view,
   the state file is the cross-session source of truth.
5. **If the tester reports anything weird**, offer to record it in
   `findings.md` (in the cwd). Reactive, not proactive: only offer
   the findings log when the tester flags something, asks "is that
   normal?", or pastes an error. Never on a clean OK.
6. **One step at a time inside a chapter.** Finish a chapter (mark
   it `done`), then **auto-advance** to the next chapter's
   Announcement in the same response, unless the manifest entry is
   `pace: per-step` (then ask "¿seguimos?" between steps, as the
   fundamentals part does today). The continue-prompt at a **part
   boundary** routes back to the ToC menu.
7. **If the state file already exists** when invoked, do not
   overwrite anything. Read it, show progress, offer to continue,
   pick another part, or start over (the last requires explicit
   confirmation, see §Resume / restart).
8. **Never modify files outside the tutorial cwd.**
9. **Never ask the tester to `cd` outside the tutorial cwd.** All
   command blocks assume the second terminal is anchored to the
   fixture folder.

## Provider detection

Skill-map ships built-in vendor providers, each walking its own
on-disk convention:

| Provider       | Base dir          | Kinds it claims             | Detect via env var(s)                                  |
|----------------|-------------------|-----------------------------|--------------------------------------------------------|
| `claude`       | `.claude/`        | `agent`, `command`, `skill` | `CLAUDECODE=1` OR `AI_AGENT` starts with `claude-code` |
| `agent-skills` | `.agents/skills/` | `skill` only (vendor-neutral; also the on-disk home for Google's Antigravity CLI, which replaced the Gemini CLI on 2026-05-19 and adopted this open standard) | no formal env yet; opt-in if the tester says so |
| `openai`       | `.codex/`         | `agent` (`.codex/agents/*.toml`) | no formal env yet; informational today |

**Decision logic, applied silently during pre-flight**:

1. Inspect the agent's environment (`process.env`).
2. Claude-flavoured var present → `provider = claude`,
   `<provider_dir> = .claude`, kinds = `{agent, command, skill}`.
3. Else if the tester says Antigravity / agent-skills (opt-in) →
   `provider = agent-skills`, `<provider_dir> = .agents`, kinds =
   `{skill}`.
4. Else → **fallback to claude** AND surface one short message so
   they can correct course (render `> ` if it turns out to be
   Claude, plain prose if they correct you):

   > Heads up: I couldn't detect which agent runtime is hosting me,
   > so I'll demo skill-map's Claude provider (`.claude/`). If you
   > actually use Antigravity or agent-skills, tell me and I swap
   > the fixture to `.agents/skills/`.

Persist `provider` into the state file (`tutorial.provider`) so a
resumed session does not re-detect.

**Global substitution rule**: wherever a part file says `.claude/`,
swap it for the detected `<provider_dir>`. **Skip any fixture file
or step whose kind is not in the provider's supported set** (on
`agent-skills` / Antigravity: only the skill + markdown notes are
valid; drop agent + command files and the connectors that target
them, and adjust node counts accordingly).

**Reality check (don't mention to the tester)**: this skill ships
at `.claude/skills/sm-tutorial/`, so Claude Code is the only host
today. The detection wiring is here so mirrored skills at
`.agents/skills/sm-tutorial/` reuse it as-is.

## Per-step cycle (inside a chapter)

When you enter a part, call `TaskCreate` once with one task per
chapter in that part's `chapters` list. Update each to
`in_progress` when its block begins and `completed` when it ends.

For every step in a chapter:

1. **Announcement**: "Capítulo N: `<title>`. ~M min." then a blank
   line, then (optionally) one sentence of context on its own
   paragraph. `N` is the 1-based index of the chapter inside its
   part; it resets per part. The context paragraph renders ONLY
   when the source has a `**Context**:` field; if omitted, announce
   the title alone. The title comes from the chapter's `title` in
   `_manifest.yml` (translated per §Tone), not the internal id.
2. **Preparation** (if applicable): create or modify files, show
   the path and a short preview.
3. **Commands to run**: a ` ```bash ` block.
4. **Pause**: "Run that and paste me the output (or say OK)."
5. **Verification**: read their reply. If something errored,
   suggest a fix before advancing. If fine, mark `done`. Honour the
   part's `pace`: `auto-advance` moves straight into the next
   chapter's Announcement; `per-step` asks "¿seguimos?" first.

## Routing + menu (orchestrator)

- **No state (first-timer)**: enter the first `spine` part of
  lowest `order` (Part 0) at its chapter 1, **with no ToC** (the
  onboarding flow is a single continuous path; never expose the
  part split).
- **After a part closes, or state exists**: render the **ToC menu**
  from `_manifest.yml`, parts in `order` with their chapters,
  completed chapters prefixed `✓ `. A part with a `seed` (the campaign
  parts) is **always shown**, even out of order: its `preflight: seed`
  fast-forwards the project into it (SKILL.md §Entering a part). A part
  with a `prereq` but NO `seed` (Part 7 `cli`) is shown only once its
  `prereq` is `done`. Parts with `status: planned` (no `step_file`) are
  NOT shown. Let the tester pick; walk that part; return to the menu
  when it ends.
- **Adding content** is data-only: a new chapter in a part (or a
  new `part-<id>.md` + a manifest row). Keep chapter-id prefixes
  matching the file name so dispatch stays mechanical.

## Resume / restart

When re-invoked and the state file already exists, do NOT repeat
pre-flight from scratch. Show progress (one line per part with its
status) and offer: **continue** the current part, **pick another
part** (re-show the ToC), **start over** (wipes the tutorial
content, asks for confirmation), or **exit**.

On **start over**, before deleting anything:

1. Read `tutorial.cwd` from the state file and compare with `pwd`.
   If they differ, **refuse** and tell the tester to move to the
   saved cwd or delete the state file by hand (their `.claude/`,
   `notes/`, etc. here are probably theirs, not the tutorial's).
2. If the cwd matches, read `tutorial.provider`, compute
   `<provider_dir>` + the subset of files actually created, show
   the exact list of paths you'll delete, and require the literal
   typed confirmation `yes, wipe`.
3. Only on `yes, wipe`, delete those exact paths (do NOT `rm -rf`
   `<provider_dir>/` or `notes/` as directories, only the specific
   tutorial-owned files inside; `rmdir` empty parents silently).
   Then start from pre-flight.

## Edge cases

- **No Node 24+** → guide them to `nvm` or nodejs.org. Don't try to
  install Node for them.
- **Port 4242 in use** → bare `sm` takes no flags (it is `sm serve`
  with defaults). Stop the failed `sm`, run `sm serve --port 4243`;
  open the new URL the server prints.
- **`sm` doesn't pick up changes on WSL** → known on WSL2 under
  `/mnt/c/`. Suggest `mkdir ~/sm-tutorial && cd ~/sm-tutorial`
  (Linux-native filesystem) and re-invoking.
- **Browser doesn't load the UI** → check `sm` is still running;
  try `curl http://127.0.0.1:4242` from another terminal.
- **`sm plugins create` refuses with "already exists"** → suggest a
  different id or `--force` (warn it overwrites).
- **Tester gets lost** → "no worries, tell me where you are and
  we'll pick up from there". State is in the state file.

## Final wrap-up

When the tester signals they're done (or completed every available
part), show the closing block: a "that's a wrap" line, a guilt-free
cleanup line (the cwd started empty, so everything here was created
by the tutorial and a whole-folder delete loses nothing of theirs,
`cd .. && rm -rf <dir>`), and the findings reminder.
