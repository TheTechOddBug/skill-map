# Runtime quirks, how vendor runtimes read markdown

Operating manual for understanding **what every supported runtime
actually does** with `@<mention>`, `/<command>`, `[label](path)`, and
`http(s)://` URLs that appear inside the body of a `.md` file (skill,
agent, command, `AGENTS.md`, `CLAUDE.md`). The conclusions here drive
why `src/kernel/util/strip-code-blocks.ts` exists and why every body
extractor calls it before matching.

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
| **OpenAI Codex** (`openai`) | Composer-only. Codex deprecated user slash commands; the runtime does not scan body content for them. | Composer-only (`@` opens a fuzzy file search). Sub-agents are referenced via `@<name>` but the resolution is LLM-interpreted. | LLM-interpreted. `AGENTS.md` is concatenated as text, not parsed for references. | Yes. |
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
matches. Callers (`core/markdown-link`, `core/external-url-counter`,
`claude/slash-command`, `claude/at-directive`) inherit the policy uniformly.
Do not bypass `stripCodeBlocks` to "recover" tokens hidden inside
backticks; the discard is correct because the runtime would never
follow them.

Per-extractor `precondition.provider` gates do **not** override this
policy. They scope **which** prose surface gets scanned, never
**whether** code regions count. A future provider-specific extractor
(e.g. an Antigravity slash flavour) must still call `stripCodeBlocks`
on the body it inspects.

If you ever feel the urge to "fix" the strip because the LLM might
still notice a backticked `@foo`, re-read §1. The LLM might, but the
runtime never resolves it deterministically, and the graph models
deterministic edges.

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
