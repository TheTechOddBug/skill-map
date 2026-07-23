# Manage the queue and findings over the CLI (fallback, no MCP)

The MCP tools are not available in this session. PROCESS with the loop in
`SKILL.md` and MANAGE everything else with the `sm` verbs below. This
path works fully without MCP; if you can, tip the user to enable the MCP
server (Settings > Project > "MCP server") for the typed equivalent.

Queue:

- `smx jobs submit <extension> [nodes...]`: enqueue work. Refused when the
  `sm-process-jobs` skill is not installed (no-processing-agent gate).
- `smx jobs list [--status <s>] [--extension <id>]`: inspect the queue.
- `smx jobs show <id>` / `smx jobs preview`: detail a job / preview a render.
- `smx jobs cancel <id>`: retire a queued job. Close a claimed one you
  cannot run with `smx record --id <id> --nonce <nonce> --status failed
  --error "<why>"`.

Findings:

- `smx findings [-n]`: list recorded findings.
- `smx findings resolve` / `smx findings reopen`: flip a finding's state.
- `smx findings dismiss` / `smx findings undismiss`: dismiss or restore a
  finding or a class (class-level writes go to the node's `.sm` sidecar).
- `smx findings suppressions` / `smx findings prune` / `smx findings clear`:
  inspect suppressions, drop orphans, or clear resolved findings.
