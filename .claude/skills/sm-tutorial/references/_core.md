# Core conventions (shared by every part)

This file is the single home for the conventions shared by every part
of the tutorial. The orchestrator `SKILL.md` loads it once; every
`part-*.md` step library assumes it. Do NOT restate these rules inside
a part file.

The tutorial is **one book**: an ordered sequence of **chapters
grouped in parts**, listed in `_manifest.yml`. A chapter is the
minimal unit (1 to a few steps). For the tester it is a single
guided session, never a "course catalogue": refer to a chapter by its
tester-facing `section.chapter` number (§Numbering) plus its friendly
title, never by a raw "chapter id" or tour jargon ("the settings
tour"). The menu uses friendly titles; once they pick, you just walk
that path.

## Numbering (the `section.chapter` scheme)

Two numbering systems coexist; keep them apart:

- **Internal (authoring only)**: the `order` field in `_manifest.yml`
  and the `# Part N` file headers, 0-based (Part 0 the prologue …
  Part 3 the CLI deep-dive, Part 4 the Extend dev section; `mcp` at Part 5 is parked / hidden). Use it
  in author notes; NEVER say it to the tester, it is off by one from
  what they see.
- **Tester-facing (`S.N`)**: every part is a **section** numbered by
  its 1-based position in the menu (section `1` is the prologue), and
  every chapter inside it carries a `section.chapter` number like a
  semver minor, resetting per section: section `5`'s chapters are
  `5.1`, `5.2`, … This `S.N` form is the ONLY number you say out loud;
  it matches the menu number the tester picked.

So the third chapter of section 5 announces as `5.3`, and the
prologue's first chapter is `1.1`. The numbers are derived at render
time from the menu order and the chapter's position in its part,
nothing is stored in the manifest.

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
- `watcher` and `browser` stay **English**, do NOT translate them to
  `observador` / `navegador`. They are words the tester reads in
  skill-map's own UI and docs, keep them recognisable. If a bare
  English noun reads oddly mid-sentence, rephrase ("skill-map sigue
  tus cambios" instead of forcing "el watcher detecta...").
- `scan` (verb) → `escanear`; `scan` (noun) → `escaneo`.
- `node` → `nodo`; `link` → `enlace` or `vínculo`; `fixture` →
  `set de prueba`; `pre-flight` → `preparación inicial`;
  `frontmatter` keep as-is (technical term, gloss in parens on
  first mention).
- File paths, frontmatter keys (`name`, `description`, `event`,
  …), CLI verbs (`sm init`, `sm watch`), and code identifiers stay
  English, that's the public surface, not jargon.

Anti-pattern (do NOT emit): "aparecen los otros tres kinds", "vamos a
hacer un scan ahora". Correct: "aparecen los otros tres tipos", "vamos
a escanear ahora" (and `watcher` / `browser` stay as-is in English). These translations apply to **chapter
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
  including blank lines inside a multi-paragraph block. This is the
  only active path today.
- `provider != claude` (experimental: Antigravity CLI, agent-skills,
  any other host where most non-Claude renderers show `>` as a
  literal character): emit **plain prose**, NO `> ` prefix anywhere.
  Kept as the wiring for the experimental providers; not exercised
  while the tutorial demos `claude` only.

Sample messages throughout the part files are written in the Claude
variant (with `> `).

**The rule, in one line**: every tester-facing line of prose carries
the `> ` bar in the Claude variant, context sentences, intros, tips,
expectations, confirmations, all of it, so a run of contiguous prose
reads as one continuous separator bar (put `>` on the blank lines
between paragraphs to keep the bar unbroken). The ONLY things that sit
at the top level are the command / code / terminal blocks the tester
copies (never under `> `, even in the Claude variant, so copy-paste is
clean). A command block in the middle of a message naturally splits
the bar, prose above it is one bar, prose below it another, and that
is correct: commands are meant to stand outside the bar. The two
documented exceptions to "all prose is quoted" are the plain
`Capítulo S.N:` announcement line (§Per-step cycle) and the menu
(§Menu format); everything else the tester reads is quoted.

**Preservation rule, strict**: if a source line is already prefixed
with `> `, keep that prefix verbatim (Claude mode). Do NOT strip
`> ` on short intro lines, do NOT merge adjacent blockquote
paragraphs into plain prose. The source already encodes which lines
are tester-facing (`> `-prefixed) vs agent-only (plain prose,
`Expected:` lines, `Mark <chapter-id>: done` markers, "Walk the
tester through …" meta instructions). Render the
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
- **Copyable blocks are byte-exact**: when you render a fenced block
  the tester copies verbatim (a `SKILL.md` / command body, a config
  snippet), reproduce it line for line, preserving every line break,
  indentation level, and tab. NEVER soft-wrap a long line, and in
  particular NEVER let a newline fall inside a markdown link: the
  `[text](path)` token, above all the `(path)` half, must stay on one
  physical line. A break inside the path (`(../content-` then a newline
  then `editor/SKILL.md)`) splits it, the link stops resolving, and no
  arrow is drawn.
- **No em dashes** in tester-facing prose: prefer a comma or
  parentheses (project-wide style).

## Inviolable rules

1. **You DO NOT run `sm` verbs for the tester**, except, during
   pre-flight only (both silent, no narration):
   - `sm version` ONCE to verify the install.
   - `sm init --no-scan` ONCE for parts whose manifest entry is
     `preflight: backstage-init`, to provision `.skill-map/` BEFORE
     any scan. The universal `.skillmapignore` written in pre-flight
     already keeps the tutorial's own files out, so there is nothing
     to append here.
   Parts with `preflight: taught-init` (e.g. Part 0) do NOT run
   `sm init` in pre-flight, the tester runs it as the first taught
   step. You also DO NOT run `sm plugins create` on their behalf;
   the scaffold is part of the authoring chapters.
   **The tutorial's own backstage scripts are NOT teaching `sm` verbs.**
   `node .claude/skills/sm-tutorial/scripts/fixtures.js …` (lays /
   seeds / clears fixtures) and `…/scripts/state.js …` (owns the state
   file) are machinery you run silently, the same class as `Write`.
   Your responsibilities: run those scripts to lay / seed / clear
   fixtures and to read / update progress; `Edit` a fixture `.md` when
   a chapter's live-UI beat needs the watcher to react, or generate
   tester-specific content yourself when a chapter calls for it (the
   daily loop's pages); `Read` files to verify what the tester
   modified. Everything else the tester runs.
2. **Configuration files have two-mode access.**
   - **Backstage setup (you DO run the scripts)**: laying the
     universal files (`.skillmapignore`, `findings.md`) and every
     fixture via `fixtures.js`; reading / updating progress via
     `state.js`. You never embed file content or hand-edit the state
     file; the scripts own both.
   - **Teach moment (you DO NOT edit)**: any change to
     `.skill-map/settings.json`, `.skill-map/settings.local.json`,
     `.skillmapignore`, or `.gitignore` that is part of a chapter
     lesson, the tester applies it in their own editor. Those files
     belong to the user; doing it for them defeats the lesson.
     Plugin-authoring files (`plugin.json`, stubs) the tester edits
     too.
3. **After every command block, stop and wait.** The tester pastes
   the output or replies "OK" / "done". Only then advance.
4. **Persist progress after every chapter** by running
   `node .claude/skills/sm-tutorial/scripts/state.js mark <part> <chapter> done|failed|skipped`.
   The script owns `tutorial-state.json` (stamps the timestamp and
   auto-promotes the part to `done` when its last chapter lands);
   never hand-edit the file. The state file is the ONLY progress
   tracker. Do NOT create harness tasks (`TaskCreate` / `TaskUpdate`)
   for tutorial progress, they clutter the tester's task list and add
   nothing the state file does not already hold.
5. **If the tester reports anything weird**, offer to record it in
   `findings.md` (in the cwd). Reactive, not proactive: only offer
   the findings log when the tester flags something, asks "is that
   normal?", or pastes an error. Never on a clean OK.
6. **The chapter's confirmation IS the go-ahead.** When the tester
   confirms a chapter, mark it `done` and advance straight to the next
   chapter's Announcement. NEVER ask a separate "¿seguimos?" / "shall
   we continue?" between chapters, the per-chapter confirmation already
   gates advancement and a second question is exactly the redundancy
   testers complain about. The ONLY continue-prompt is at a **part
   boundary**, where you route back to the ToC menu. (`pace` controls
   batching only, see the per-step cycle: `per-step` walks one chapter
   per exchange, `auto-advance` may chain chapters that need no tester
   action; neither asks "¿seguimos?".)
7. **If the state file already exists** when invoked, do not
   overwrite anything. Run `state.js status`, show progress, offer to
   continue, pick another part, or start over (the last requires
   explicit confirmation, see §Resume / restart).
8. **Never modify files outside the tutorial cwd.**
9. **Never ask the tester to `cd` outside the tutorial cwd.** All
   command blocks assume the second terminal is anchored to the
   fixture folder.

## Provider detection (and the track it selects)

A skill-map project reads its files through exactly ONE active lens
(provider). The built-in providers and what each claims:

| Provider       | Asset layout                              | Kinds                          | Connectors that form           | Marker             | Stability        | Track   |
|----------------|-------------------------------------------|--------------------------------|--------------------------------|--------------------|------------------|---------|
| `claude`       | `.claude/` (agents, commands, skills)     | agent, command, skill, markdown| `/` invokes, `@` mentions, refs| `.claude/`         | stable           | rich    |
| `codex`        | `.codex/agents/*.toml` + `.agents/skills/`| agent (TOML), skill, markdown  | `$` invokes, `@` file-refs, refs| `.codex/`         | beta             | rich    |
| `antigravity`  | `.agents/skills/` + `.agent/workflows/`   | skill, workflow, markdown      | `/` invokes, `@` file-refs, refs | `.agent/workflows/`| beta             | basic   |
| `agent-skills` | `.agents/skills/`                         | skill, markdown                | refs only                      | `.agents/`         | stable (default) | basic   |

`core/markdown` classifies every orphan `.md` under whatever lens is
active; it is the universal base, never a selectable lens.

**Two tracks, by capability** (the axis is "does the lens have an
`agent` kind?"):

- **rich** (`claude`, `codex`): agents + skills (+ commands on claude).
  Claude wires `/` invocations and `@` mentions; Codex wires `$` invocations
  (skills) and `@`-FILE references (Codex's `@` is a file picker, it cannot
  mention an agent by name, and `/` is a Codex built-in command, not a skill
  invocation). Both also use markdown references.
- **basic** (`agent-skills`, `antigravity`): the open-standard family,
  built on `skill` + `markdown` and wired with **markdown references**
  (`[text](path)`), the one connection the Agent Skills standard
  documents. They diverge on what Antigravity bolts on top of the
  standard: `agent-skills` is the pure subset (skill + markdown,
  references only, no `@`), while `antigravity` adds its OWN `workflow`
  kind (`.agent/workflows/*.md`), `/`-invocation (the slash resolves to
  both skills and workflows), and `@`-file references (a file-shaped
  `@path` token, the same file-picker grammar Codex uses, distinct from
  Claude's `@`-agent-mention). That slash, the `workflow` kind, and the
  `@`-file refs are Antigravity-only, NOT part of the neutral standard,
  so under the `agent-skills` lens only markdown references form.

Why references and not slash on the open standard: the Agent Skills
spec (agentskills.io) activates a skill by its `description` and
connects files by relative markdown links; it has no invocation sigil.
Vendors add their own on top: claude `/`-invokes and `@`-mentions; Codex
`$`-invokes skills and treats `@` as a file picker (`/` is a Codex
built-in command, not a skill invocation).

**Decision logic, applied silently at pre-flight:**

1. The provider is the lens the scaffold set up. Check the vendor markers
   FIRST (they ride on top of the shared `.agents/skills/` skill home), then
   the skill home itself:
   - a `.codex/` dir present (the marker `sm tutorial --for codex` drops) →
     `provider = codex`, `track = rich`.
   - else a `.agent/workflows/` dir present → `provider = antigravity`,
     `track = basic`.
   - else skill under `.claude/skills/sm-tutorial/` → `provider = claude`,
     `<provider_dir> = .claude`, `track = rich`.
   - else skill under `.agents/skills/sm-tutorial/` → `provider = agent-skills`,
     `<provider_dir> = .agents/skills`, `track = basic`.
   **Lens precedence for codex / antigravity**: both adopt the open
   `.agents/skills/` layout, so the scaffold leaves the vendor marker
   (`.codex/` or `.agent/workflows/`) alongside the `agent-skills` marker
   (`.agents/`). The vendor marker WINS: `sm init` resolves `codex` /
   `antigravity` outright with no prompt (the `.agents/` open default only
   competes when no vendor marker is present). So the codex book runs
   exactly like claude, `sm init` then `sm`, with no lens prompt and no
   `sm config set activeProvider` step anywhere (tester chapters or
   backstage seeds). The fixture engine still renders the right shape:
   codex its TOML agents + command-as-skill, antigravity reuses the
   `agent-skills` overlays.
2. `state.js init --provider <p>` persists `provider` plus the derived
   `track`, so a resumed session never re-detects.
3. Render only the parts whose `track` is `tutorial.track` (or `both`).
   Never offer a rich-only part under the basic track, or vice versa.

**Global substitution rule**: the fixture scripts do the file-level
work. You pass `--provider <p>` (the value persisted in
`tutorial.provider`) and `--lang <l>`, and they resolve the
`__PROVIDER__` path token, skip files whose kind the provider does not
claim, lay any per-provider skill overlay (the open standard renders an
agent/command as a `skill`), and report the adjusted `nodeCount` plus
the `skipped` list. Narrate with `<provider_dir>` resolved to the value
above, never a hard-coded `.claude/`.

**Reality check (don't mention to the tester)**: the source skill ships
at `.claude/skills/sm-tutorial/` (this repo is itself a Claude project);
`sm tutorial` materializes it under `.claude/skills/` (rich) or
`.agents/skills/` (basic). Both are real, walkable books.

### Rendering the rich book on Codex

The rich track has two lenses, `claude` and `codex`. They teach the same
lessons, but Codex's CONNECTOR GRAMMAR differs from claude's (see the
Connectors bullet below), so the rich part bodies are written in the `claude`
shape; when `tutorial.provider == codex`, apply these substitutions:

- **Agents are TOML.** A Codex agent is a single `.codex/agents/<name>.toml`
  file (the prompt lives in its `developer_instructions` field), NOT a
  `.claude/agents/<name>.md`. The fixtures lay them, so when a chapter says
  "open the agent file" point at the `.toml`; a chapter that has the tester
  read or tweak an agent works on the TOML frontmatter / `developer_instructions`.
- **Connectors differ.** Codex invokes a skill with `$<name>` (NOT `/`, which
  is a Codex built-in command), and `@<name>` is a FILE picker, not an agent
  mention. So where the claude book writes `/check-links` (invoke) say
  `$check-links`; where it writes `@content-editor` (mention an agent),
  reference the agent's FILE instead, a markdown link `[content-editor](<rel-path>.toml)`
  or a file-shaped `@<file>.md` / `@<file>.toml`; a bare `@<name>` (no
  path/extension) forms NOTHING on Codex. The codex fixture overlays already
  carry the `$`/file-ref shapes, narrate them, do not re-derive.
- **No `command` kind.** Where the claude book authors a `command` (the
  `/publish` command), Codex uses a **skill** at `.agents/skills/<name>/SKILL.md`.
  The body uses the CODEX grammar (`$check-links` to invoke, a file reference to
  `content-editor` instead of an `@`-mention, per Connectors above); the codex
  fixture overlay already carries that shape, so the create-the-file block
  (`cat <set> --file … --provider codex`) stays a copy-paste.
- **No reserved skill names on Codex.** Codex `$`-invokes skills, a namespace
  disjoint from its `/` built-in commands, so a skill named like a built-in
  (`model`) does NOT collide with `/model` and is NOT flagged. The claude
  `reserved` chapter (a `/model` COMMAND collides) has no Codex equivalent; the
  daily-loop `reserved` Codex delta reframes / skips it (see that chapter).
  **Apply every substitution silently.** Use the Codex path, kind and file
  directly in the tester-facing prose, but never EXPLAIN the substitution or
  compare it to the claude shape. The Codex tester only ever sees a `skill`
  where the claude book has a command; never tell them "Codex has no `command`
  kind", never say a node "is a command that shows as a skill" or that it
  "replaces" / "stands in for" / "reemplaza" a command, never append a parenthetical
  like "(in Codex this replaces the command)", never reference "the claude command". On Codex these nodes were always skills, there is
  nothing to explain. (Same for the TOML-agent and path swaps above: point the
  tester at the real `.toml` / `.agents/` file when they interact with it, just
  do not narrate that it "would be" something else on claude.)
- **Skills** live under `.agents/skills/<name>/SKILL.md` (the open layout Codex
  adopted), same as the basic family.
- Everything else (the `@`/`/` syntax, the confidence numbers, the hub, the
  broken-reference contrast) is identical to claude; the graph topology matches.

## Per-step cycle (inside a chapter)

A **chapter is the unit of confirmation**. Walk it as ONE beat:
announce it, do the preparation, hand the tester everything they need
to do, and ask for confirmation **exactly once, at the end**. Do NOT
pepper a chapter with several "tell me when…" / "¿viste X?" prompts,
bundle the actions into a single instruction ("hacé A, después B, y
avisame cuando el mapa muestre …"). Split a chapter's confirmation
ONLY when a later action genuinely cannot start until the tester
finished an earlier one (e.g. they must have the browser open before
they can watch a node change), and even then keep it to the minimum.
Never call `TaskCreate` / `TaskUpdate` (Inviolable rule #4).

For every chapter:

1. **Announcement**: "Capítulo S.N: `<title>`. ~M min." as a plain
   line (NOT quoted), then a blank line. `S` is the section number
   (the part's 1-based menu position) and `N` is the 1-based index of
   the chapter inside that part, resetting per part (§Numbering), so
   section 5's third chapter announces as `Capítulo 5.3`. The title
   comes from the chapter's `title` in `_manifest.yml` (translated per
   §Tone), not the internal id. Announce the title alone, then go
   straight into the chapter's instructions.
2. **Preparation** (if applicable): create or modify the fixture
   files the chapter calls for (silently, per §Silence).
3. **The tester's part**: the command block(s) and instructions,
   bundled into one flow, closed by the single confirmation.
4. **Verification**: read their reply. If something errored, suggest
   a fix before advancing. If fine, mark `done` and move straight into
   the next chapter's Announcement (the confirmation is the go-ahead,
   Inviolable rule #6, NO "¿seguimos?"). `pace` only decides batching:
   `per-step` presents one chapter per exchange, `auto-advance` may
   chain chapters that need no tester action into one response.
   **Either pace still emits every chapter's `Capítulo S.N` Announcement
   (step 1).** `auto-advance` drops only the inter-chapter "¿seguimos?"
   pause, never the per-chapter announcement, so any chapter with a
   tester-facing beat always opens with its number, even when it
   follows straight on from the previous one.

## Routing + menu (orchestrator)

- **Always start at the menu.** On the first invocation (no state)
  AND after any part closes / on resume, render the **start menu**:
  the book ToC, numbered, and let the tester pick a part by number.
  Part 0 (the prologue) is option 1, the recommended starting point,
  so a brand-new tester just types `1`. Do NOT auto-enter a part; the
  menu is the entry point every time. On later renders, mark completed
  parts with a `✓` in their description line, not on the title (see
  §Menu format).
- **Which parts to list**: parts in `order`, `status: active` only
  (`planned` parts are hidden), AND **matching the active track**, a
  part whose `track` is `tutorial.track` (`rich` or `basic`) or `both`.
  The rich and basic campaigns share titles and `order`, so the track
  filter is what keeps the menu showing exactly ONE book, never both;
  list a part once, by the track the session resolved at pre-flight.
  A part with a `seed` (the campaign parts plus `cli`) is always shown,
  even out of order, its `preflight: seed` fast-forwards the project
  into it (SKILL.md §Entering a part). A part with a `prereq` but NO `seed` would be
  shown only once its `prereq` is `done`; no active part is in that
  state today (`cli` used to be, now it self-seeds).
- **After the tester picks**: walk that part; when it ends, run
  §Closing a part (a tester-facing close, then this menu).
- **Adding content** is data-only: a new chapter in a part (or a new
  `part-<id>.md` + a manifest row). Keep chapter-id prefixes matching
  the file name so dispatch stays mechanical.

### Closing a part

A part must FEEL finished before the menu comes back: the tester
should never slide into the next part as if it auto-continued. When a
part's last chapter (the last in `_manifest.yml` order) is confirmed,
before re-rendering the menu emit a short tester-facing close:

- A `✓` line naming the part just finished BY ITS TITLE (from
  `_manifest.yml`), not the internal "Part N" index, which is off by
  one from the menu numbering the tester sees.
- One line recapping what they built or learned (same source as the
  menu description).
- A hand-off line: back to the menu, pick the next part.

Then render the menu (§Menu format) with this part now marked done (a
`✓` in its description line, not on the title); its intro may lean to
"what's next" on a post-part render. The last
chapter's own confirmation stays scoped to that chapter, it does NOT
promise or pre-announce the next part, the close and the menu own the
transition. Sample (Claude variant, mirror the tester's language,
apply the host rendering rule):

> ✓ Listo, terminaste **El harness desde cero**. Levantaste un
> proyecto real, su handbook y el harness `.claude/` con sus primeros
> nodos.
>
> Volvés al menú, elegí con qué seguir.

If every active part is now `✓` (nothing left to pick), skip the menu
and go straight to §Final wrap-up.

### Menu format

Render the menu numbered and formatted (NOT a bare list), translated
to the tester's language. A one-line intro, then per part a **bold
numbered title line** (the section number + title + `(~M min)`, that
number is the `S` major in the chapter `S.N` scheme, §Numbering) as plain prose,
immediately followed by a single-level `> ` blockquote one-line
description (what the part covers, derived from its title + chapters).
A **completed part** keeps its plain title (NO `✓` on the title line)
and swaps its description for the done marker: `> ✓ ` plus a short
"already done" note (e.g. `✓ Ya la hiciste.`). The green check lives
inside the content, mirroring the `✓` confirmations used elsewhere,
never as a title prefix.
NO blank line between a title and its description; ONE blank line
between parts; NO outer blockquote around the whole menu. Close with a
short "¿Cuál?" / "Which one?" on its own line.

**Developer aside for section 5 (Extend)**: append to its one-line
description a short note that this section is mostly for developers
who want to get more out of skill-map (writing plugins, tuning
settings, moving view-slots). Mirror the tester's language.

Sample (Claude variant,
fill the parts and durations from `_manifest.yml`):

```
¿Por dónde querés arrancar? Podés volver al menú cuando termines cada parte.

**1. El mapa en vivo** (~12 min)
> El prólogo: corrés `sm`, abrís el browser y ves el mapa actualizarse en vivo mientras editás `.md`. Si es tu primera vez, empezá por acá.

**2. El harness desde cero** (~8 min)
> Arrancás un proyecto real (un portfolio) y su harness `.claude/`.

¿Cuál?
```

This menu is the ONE exception to the "wrap tester-facing prose in a
single blockquote" rule: the intro, the bold titles and the trailing
"¿Cuál?" are plain prose; only the description lines carry `> `. On
non-Claude hosts the `> ` collapses to plain prose, indent each
description two spaces so it stays subordinate to its title.

Same menu after Part 1 is done (the `✓` sits in the description line,
the title stays plain):

```
**1. El mapa en vivo** (~12 min)
> ✓ Ya la hiciste.

**2. El harness desde cero** (~8 min)
> Arrancás un proyecto real (un portfolio) y su harness `.claude/`.
```

## Resume / restart

When re-invoked and the state file already exists, do NOT repeat
pre-flight from scratch. Run
`node .claude/skills/sm-tutorial/scripts/state.js status` and render
progress from its `parts[]` (one line per part with its status), then
offer: **continue** the current part, **pick another part** (re-show
the ToC), **start over** (wipes the tutorial content, asks for
confirmation), or **exit**.

On **start over**, the script owns the path computation and the cwd
safety check:

1. Run `state.js wipe-list`. It re-checks `tutorial.cwd` against the
   current dir and returns a `cwd-mismatch` error if they differ;
   surface that refusal (tell the tester to move to the saved cwd or
   delete `tutorial-state.json` by hand, their `.claude/`, `notes/`,
   etc. here are probably theirs).
2. Show the returned `paths` and require the literal typed
   confirmation `yes, wipe`.
3. Only on `yes, wipe`, run `state.js wipe --confirm` (it deletes
   exactly those paths and `rmdir`s empty parents, never a whole user
   dir). Then start from pre-flight.

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
