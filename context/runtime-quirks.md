# Runtime quirks, how vendor runtimes read markdown

Operating manual for understanding **what every supported runtime
actually does** with `@<mention>`, `/<command>`, `[label](path)`, and
`http(s)://` URLs that appear inside the body of a `.md` file (skill,
agent, command, `AGENTS.md`, `CLAUDE.md`). The conclusions here drive
why `src/kernel/util/strip-code-blocks.ts` exists and why every
prose-side body extractor calls it before matching (the two code-region
exceptions are in §5).

**Authority**: same level as `AGENTS.md` (Topical annexes table). The
runtimes themselves are the source of truth; this annex captures the
research that produced our extractor policy and the upstream bugs we
deliberately do not replicate.

---

## 1. The core rule

There is **no deterministic parser** in any supported runtime that
scans the body of an authored `.md` file looking for `@x` or `/y` to
"resolve" or "execute". What does exist:

1. **A composer-side parser in the user's prompt UI**. Autocomplete
   for `@<path>` and `/<command>` lives in the TUI / IDE composer
   (Claude Code, Codex CLI, Antigravity TUI). It never touches the
   contents of a `.md` file on disk.
2. **The LLM reads the markdown body as text**. By markdown
   convention (`` `…` `` and ```` ``` ` ```` denote literal code), the
   LLM interprets backtick-wrapped tokens as quotation, not as
   invocation. This is a behavioural convention learned at training
   time, not a guarantee enforced by the runtime.

That is why our body extractors strip code regions before matching:
mirroring the LLM's interpretation of the same prose is the only sound
default. Emitting a link from a backtick-wrapped reference would
manufacture an edge the runtime would never traverse.

## 2. Behaviour per supported provider

| Provider | `/cmd` in body | `@mention` in body | `[label](path)` | `` `…` `` is literal? |
|---|---|---|---|---|
| **Claude Code** (`claude`) | Not invoked. Docs are explicit: "A command is only recognized at the start of your message." | Composer-only feature. `CLAUDE.md` has a special `@AGENTS.md` import at line start, but mid-prose mentions are LLM-interpreted. | LLM-interpreted. | Yes (by convention). See §3 for the `` !`cmd` `` exception. |
| **OpenAI Codex** (`codex`) | Composer-only. Codex deprecated user slash commands; the runtime does not scan body content for them. | Composer-only (`@` opens a fuzzy file search). Sub-agents are referenced via `@<name>` but the resolution is LLM-interpreted. | LLM-interpreted. `AGENTS.md` is concatenated as text, not parsed for references. | Yes. |
| **Antigravity** (`antigravity`) | TUI built-ins (`/agents`, `/help`, `/quit`, `/skills`, `/hooks`) live in the composer; not parsed from `.md` bodies. | Same as composer behaviour above. | LLM-interpreted. | Yes. |
| **Agent Skills standard** (`agent-skills`) | Not defined by the spec. The spec says body content has "no format restrictions". | Not defined. The spec references files via `[label](path)`, never `@archivo`. | Standard markdown link, LLM follows the path if asked. | Yes (markdown default). |
| **AGENTS.md standard** (`agentsmd`) | Not applicable. | `@filename` at the top of `AGENTS.md` is a documented import; mid-prose mentions are LLM-interpreted. | LLM-interpreted. | Yes. |

The matrix collapses to the same conclusion across vendors: the body
of a `.md` is **text the LLM reads**, not a script the runtime
executes.

## 3. The one documented exception

Claude Code's SKILL.md inline shell substitution. Syntax:

```
## Current changes

!`git diff HEAD`
```

`` !`cmd` `` is processed deterministically by the Skill loader
during skill activation: the `cmd` is executed, the output replaces
the placeholder, and the LLM sees the substituted text. From the
official docs: *"The inline form is only recognized when `!` appears
at the start of a line or immediately after whitespace. If `!`
follows another character, as in `KEY=!\`cmd\``, the placeholder is
left as literal text and the command does not run."*

This is **not** the same as a backtick-wrapped reference. The `!`
prefix is mandatory; a bare `` `…` `` stays literal. Our extractors
do not emit any "shell substitution" link kind, so stripping these
regions along with regular code spans is correct for the graph model.
They are payload of the runtime, not pointers between nodes.

## 4. Known upstream bugs (Claude Code)

The Skill loader in Claude Code has a recurring class of bugs where
backtick-wrapped content is mishandled as shell input. These are
**Anthropic-side bugs**, not skill-map's; we cannot fix them and we
do not replicate them (we never shell-eval the contents of a `.md`).
Keep the list current as Anthropic ships fixes:

| Issue | Symptom |
|---|---|
| [anthropics/claude-code#13655](https://github.com/anthropics/claude-code/issues/13655) | Skill tool parses markdown inline code as shell commands. |
| [anthropics/claude-code#13932](https://github.com/anthropics/claude-code/issues/13932) | Skill tool fails on markdown files containing backticks or single quotes. |
| [anthropics/claude-code#17119](https://github.com/anthropics/claude-code/issues/17119) | Skill parser executes `` `!…` `` as bash. |
| [anthropics/claude-code#24510](https://github.com/anthropics/claude-code/issues/24510) | SKILL.md content with backticks triggers shell evaluation errors. |
| [anthropics/claude-code#25792](https://github.com/anthropics/claude-code/issues/25792) | Skill loader executes inline code as bash when content ends with `!`. |
| [anthropics/claude-code#8197](https://github.com/anthropics/claude-code/issues/8197) | Backticks and exclamations in slash command definitions trigger permission checks. |

These bugs confirm, by contradiction, that the **expected** runtime
contract is: backticks denote literal markdown. The loader is meant
to read SKILL.md as text and only act on the documented `` !`cmd` ``
shape (§3).

## 5. What this means for skill-map

`src/kernel/util/strip-code-blocks.ts` replaces fenced blocks and
inline spans with same-length whitespace before any body extractor
matches (`stripCodeBlocks`), and `stripHtml` does the same for raw HTML
(comments + tag tokens). The prose-side extractors (`core/markdown-link`,
`core/external-url-counter`, `claude/slash-command`, `claude/at-directive`)
call the composed `stripCodeAndHtml` so both regions are masked uniformly.
Do not bypass it to "recover" tokens hidden inside backticks or HTML;
for invocation tokens (`/command`, URLs) the discard is correct because
the runtime never resolves them from code regions, and the same logic
extends to references buried in HTML (no runtime renders the `.md`'s
HTML to follow `<a href>` / load `<img src>`). The HTML
strip is bounded to comments and tag tokens, never the content between
an open and close tag, so markdown nested in a `<div>` block survives.
It is kept independent of `stripCodeBlocks`: `extractCodeRegions` is the
diff against `stripCodeBlocks`, so folding HTML in would make
`core/backtick-path` resurrect HTML interiors as code regions. HTML is
not a code region.

**The one sanctioned exception: relative `.md` file paths.** The
original "the runtime would never follow them" rationale is FALSE for
file paths: prose like ``Read `references/rules.md` `` is the dominant
cross-reference shape in agent-authored skills, the Agent Skills open
standard mandates that agents "load these on demand", and every major
harness (Claude Code, Codex, Gemini CLI / Antigravity, Copilot, Cursor)
documents the model following them. Verified empirically in-repo:
12/12 runs across opus / sonnet / haiku / fable followed backtick path
references, including multiple paths inside a single fenced block.
`core/backtick-path` covers exactly that class, matching ONLY inside
code regions via `extractCodeRegions` (the exact inverse mask of
`stripCodeBlocks`, exported from the same module), `.md`-only, with a
spec-pinned grammar. It never recovers `@` / `/` tokens. Normative
contract: `spec/architecture.md` §Extractor · code-region file
references.

**The second exception: trigger tokens (`@handle` mentions, `/command`
and `$skill` invocations), resolution-gated.** Authors wrap invocations
in backticks as stylistic highlighting (``use `@reviewer` for the
final pass``, ``run `/deploy` before shipping``) and the LLM follows
them exactly like the unwrapped form, so three code-region siblings
recover them with the SAME grammar as their prose extractors:
`claude/backtick-mention` (bare handles, claude lens),
`core/backtick-slash` (slash commands, claude / antigravity / opencode
lenses, grammar shared via `kernel/util/slash-token.ts`), and
`codex/backtick-dollar` (dollar skills, codex lens, grammar shared via
`kernel/util/dollar-token.ts`). But the base rate is inverted versus
file paths: most trigger-shaped tokens in code regions are code
payload (npm scopes `@changesets/cli`, decorators `@Injectable`, shell
paths `/tmp`, shell variables `$file`, CSS at-rules `@media`), and an
unresolved trigger link would flag a red `reference-broken` error. So
the emission is paired with a resolution gate: the post-walk
`prune-unresolved-code-triggers` transform drops every `mentions` /
`invokes` link that resolves to no node and whose every occurrence
carries a code-region `Signal.context` (`'inline-code'` /
`'code-block'`). A token naming a real entity becomes an edge; payload
silently vanishes. Prose triggers keep the dangling-is-broken
behaviour with one severity nuance (2026-07-27): an unresolved prose
`@`-trigger whose verbatim token is CODE-SHAPED per
`kernel/util/code-shaped-token.ts` (uppercase identifier `@ApiSecurity`
/ `@Injectable`, or single-slash npm scope `@nestjs/swagger`) emits
`reference-broken` at `warn` instead of `error`, prose about code is
likelier than a typoed reference, so the signal stays visible without
tripping exit 1; and ANY residual false positive is operator-dismissable
per (analyzer, value) via `sm issues dismiss` /
`annotations.issueSuppressions` (emission-time suppression,
`spec/db-schema.md` §scan_issues). `core/link-self-loop` skips its warn
when a self-loop is sourced only from code regions (a doc showing its
own usage is not a loop risk). Under the claude lens the mention matrix is
priority-ordered `['agent', 'skill', 'markdown']` (Decision #135), so
backticked `@deploy-site` reaches a skill and `@playbook` reaches a
plain doc by basename. Normative contract: `spec/architecture.md`
§Extractor · code-region triggers (Decisions #134 / #135). File-shaped
`@docs/api.md` in code regions stays out of the mention grammar; its
`.md` path half is already a `points` edge via `core/backtick-path`.

Per-extractor `precondition.provider` gates do **not** override this
policy. They scope **which** prose surface gets scanned, never
**whether** code regions count. A future provider-specific extractor
(e.g. an Antigravity slash flavour) must still call `stripCodeBlocks`
on the body it inspects.

If you ever feel the urge to widen the recovery further (a backticked
URL), re-read §1. The LLM might notice them, but the runtime never
resolves them deterministically, and the graph models edges the
consuming runtime acts on. File paths earned a full exception
(documented, cross-vendor, normative follow-through); backticked
trigger tokens (`@handle`, `/command`) earned a CONDITIONAL one, the
edge exists only when resolution confirms the hypothesis, precisely
because their base rate in code regions is dominated by non-trigger
payload.

## 6. Cursor, community-pending

Cursor is named in passing inside a few extractor doc-comments
(`at-directive`, `slash`, `strip-code-blocks`) as a peer runtime that
treats backticks the same way. **Cursor is not a supported provider
in skill-map today.** No `cursor` Provider is registered, no
`.cursor/` territory is classified, and no Cursor-specific extractor
gates exist. The mentions are deliberately preserved so that the day
a contributor lands a `cursor` Provider (PR welcome), the doc-comments
already reflect that Cursor's prose-reading conventions match the
established matrix in §2. Treat any Cursor reference in the codebase
as anticipatory documentation, not active support.

## 7. Known gap, deferred

We do not currently **measure** how many tokens the strip discards.
An author who writes `` `@target` `` thinking they are creating a
link gets no feedback. The fix is a post-strip diff that counts
tokens which would have matched if the body had no backticks; that
analyzer is intentionally out of scope right now. Mark it as the
follow-up to revisit alongside the next pass over link-graph quality
signals.

The file-path half of this gap is closed: a backticked relative `.md`
path is no longer discarded, `core/backtick-path` (§5) turns it into a
real `points` edge (Decision #127), and a path pointing at a missing
file surfaces through `core/reference-broken`. The trigger half is
half-closed (Decisions #134 / #135): a backticked `@handle` or
`/command` that resolves becomes a real `mentions` / `invokes` edge via
`claude/backtick-mention` / `core/backtick-slash` (§5), but one that
does NOT resolve (including a typo'd `@reviewr` or `/deply`) is
silently pruned by the resolution gate, no feedback. The remaining gap
is therefore URL tokens (fully discarded) and unresolved / typo'd
triggers (pruned without a warning); the post-strip discard-feedback
analyzer stays the deferred fix for both.
