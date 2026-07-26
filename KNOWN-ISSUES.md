# Known issues & non-issues

The per-runtime fine print: what each AI runtime's hook / tool surface can and cannot show on the live map, and the behaviors that look like bugs but are the documented shape of the product. Check here before filing an issue. The product overview lives in [`README.md`](./README.md); the normative real-time contract in [`spec/provider-activity.md`](./spec/provider-activity.md).

## Real-time activity: what lights up per runtime

What lights up depends on what each runtime's hook system exposes:

| Provider | Lights up | Known gaps (and why) |
|---|---|---|
| `claude` (Claude Code) | Slash commands, skills (typed or model-invoked), agents including nested delegation chains, markdown file reads, and live MCP tool calls (an `mcp__<server>__<tool>` call lights the `mcp://<server>` node; the whole agent → skill → MCP chain lights, skill included) | Auto-loaded context (`CLAUDE.md` at session start) fires no hook, so it stays invisible |
| `codex` (Codex CLI) | `$skill` invocations from your prompt, named agents from `.codex/agents/` (nested chains too if you raise `agents.max_depth`), spawn arrows between agents with per-edge conversation counters and opt-in conversation viewing, and live MCP tool calls (an `mcp__<server>__<tool>` call lights the `mcp://<server>` node, even from inside an agent or skill) | Markdown reads stay dark (Codex hooks do not fire for its `read_file` tool yet, [openai/codex#18491](https://github.com/openai/codex/issues/18491)); a skill that an agent follows also stays dark because Codex surfaces a skill only through a `$name` prompt token, so in an agent → skill → MCP chain the agent (spawn) and the `mcp://` node light up but the skill in the middle does not; spawns of the generic `worker` type match no node; execution totals (duration/tools/tokens) stay empty, the runtime does not report them |
| `antigravity` (Antigravity CLI) | Everything that gets READ: markdown files, a skill's `SKILL.md` and its resources whenever the agent views them, workflows followed in prose; the whole chain goes dark when the conversation goes FULLY idle (mid-run naps while subagents work no longer darken it) | `/skill` invocations stay dark (the runtime injects the content with no hook event, ask for the skill in prose instead); subagents have no on-disk definition and spawns return no child id, so there is no node to light and no spawn arrow to draw |
| `opencode` (OpenCode) | The richest surface: skills, commands and agents all arrive NAMED (they fire even when invoked in prose), markdown reads light by path, spawn arrows with per-edge conversation counters and opt-in conversation viewing (the child's full report arrives natively), and each session's whole chain goes dark the moment it idles (native `session.idle`) | Built-in agents without an on-disk file (`build`, `plan`) have no node to light; execution totals stay empty (per-message tokens exist on its bus but are not aggregated); delegation is **one hop deep**, the runtime refuses a `task` call made from inside a subagent (nesting limit), and since a refused call reports no completion its arrow lingers until the safety-net sweep clears it, so an agent → agent → agent chain is not something OpenCode can run (Claude Code and Codex do nest) |
| `markdown` | No runtime to hook; nothing lights | |

## Non-issues: things that look broken but are expected

Live use surfaces behaviors that read as bugs and are not: they are the documented shape of each runtime's hook / tool surface, or a deliberate skill-map design.

| Runtime | What you see | Why it is expected |
|---|---|---|
| any | A submitted job sits in **Queued** and nothing happens | Your processing agent's terminal is probably showing a permission prompt (first claim, first file read, first edit). Answer it there; the job resumes. |
| any | **Check Agent** goes red and every AI button disables | That is the gate working: no agent answered the probe, so probabilistic features switch off honestly instead of queueing work nobody will drain. Any successful claim (or a green re-check) re-enables everything. |
| any | Session capsules and spawn arrows vanish from the map | Live traces are ephemeral by design: they exist exactly as long as the run. Conversation counters and captured conversations (opt-in) survive on the edge. |
| any | A summary or finding shows a **stale** mark after you edit the file | Judgments age with the body they were made on. Re-run the action to refresh; nothing is lost. |
| any | The agent-skill row says **Update available** right after a CLI update | The installed skill copy is byte-compared against the one your CLI ships; one click on Update refreshes it. |
| claude | `CLAUDE.md` never lights up on the map | Auto-loaded session context fires no hook, so there is no event to draw. Reads of any other markdown do light. |
| codex | Markdown reads never light; the skill inside an agent → skill → MCP chain stays dark | Codex hooks do not fire for `read_file`, and a skill only surfaces through a `$name` prompt token. The spawn and the `mcp://` node still light. |
| codex | Spawns of the generic `worker` type light no node | There is no on-disk definition to match; only named agents from `.codex/agents/` resolve. |
| codex | Execution totals (duration / tokens) stay empty | The runtime does not report them. |
| codex | A parked `claim_job { wait }` gets cut short | Codex bounds every MCP call with a per-tool budget: raise `tool_timeout_sec` under `[mcp_servers.skill-map]` (see README §Processing agents, the setup gotchas). |
| antigravity | `/skill` invocations light nothing | The runtime injects the skill's content with no hook event. Ask for the skill in prose instead; the file READS light. |
| antigravity | No spawn arrows, ever | Subagents are runtime-only (no on-disk definition, no child id on the spawn result), so there is no node to light and no arrow to draw. |
| antigravity | There is no project-local MCP config file to commit or inspect | Antigravity's MCP registry is global-only (`~/.gemini/config/mcp_config.json`). That also matches README §MCP's rule: MCP registration is personal. |
| opencode | The built-in `build` / `plan` agents never light | They have no on-disk file, so there is no node to match. |
| opencode | An agent → agent → agent chain refuses to run | OpenCode caps delegation at one hop (the runtime rejects a `task` call made from inside a subagent). The refused arrow lingers briefly until the safety-net sweep clears it. |
| opencode | The whole lit chain goes dark the instant a turn ends | `session.idle` fires per turn and is the native release signal; the map reflects the runtime going quiet, not a lost connection. |

## Windows / WSL

skill-map runs under WSL2, but keep your project on the **Linux filesystem** (for example `~/projects/...`), not on a mounted Windows drive (`/mnt/c/...`).

The live map's file watcher uses the OS's native change notifications (inotify), and Windows drives mounted into WSL do not deliver those events. A one-shot `sm scan` still reads files under `/mnt/c` (slowly), but `sm serve` / `sm watch` will not refresh the map when they change, and neither watcher backend (`chokidar` or `parcel`) changes that. This cross-filesystem boundary is unsupported by design; there is no polling fallback. A symlink inside a Linux-hosted project that points at a Windows path behaves the same way: it is followed on a full scan, never live-watched.
