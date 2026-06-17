---
name: full-agent-claude
description: Reference Claude agent populating every documented frontmatter field. The 14 vendor-specific fields plus the universal `name`/`description` are all set so reviewers can eyeball "what does a fully-annotated Claude agent look like?" without spelunking through specs.
tools:
  - Read
  - Grep
  - Bash(git add *)
  - Edit
disallowedTools:
  - WebFetch
  - WebSearch
model: claude-opus-4-7
permissionMode: acceptEdits
maxTurns: 12
skills:
  - full-skill-claude
  - experimental-skill
mcpServers:
  - name: filesystem
    command: mcp-server-filesystem
    args:
      - /tmp
  - name: git
    command: mcp-server-git
    args: []
hooks:
  PreToolUse:
    - matcher: Bash
      command: echo "full-agent-claude about to run a Bash command"
      blocking: false
  PostToolUse:
    - matcher: Edit
      command: echo "full-agent-claude finished an Edit"
      blocking: false
memory: project
background: false
effort: high
isolation: worktree
color: cyan
initialPrompt: Greet the **operators**, list the active scope, and propose a starting task.
pruebaDeDesconocido: es un prueba de desconocido
---

# Full Claude agent
                         
Demonstrator agent that **touches** every `documented` frontmatter field for the Claude Provider. Reference fixture for documentation, screenshots, conformance regressions, and tutorial walkthroughs.

Replaces [test](@deprecated-agent). Pairs with #full-skill-agents (cross-vendor reference via the open standard) and #full-skill-claude. Requires #full-skill-claude to be loadable.

Confidence ramp examples for the connections panel, none of which lift to 1.0 (so they exercise the full red→green colour ramp): mentions @draft-orchestrator (a bare handle that resolves to nothing, stays at 0.5, yellow), points at @phantom-helper.md (a file-style handle that also resolves to nothing, stays at 0.85, yellow-green), and calls /review (resolves to a command whose name shadows the built-in `/review`, downgraded to 0.1, red).

Esto es un codigo de javascript: `if(true){}`

got to [google](https://google.com)
                   
> esto es un quote
                
```javascript
function pickExistingVersion(node: Node): number | null {
  const overlay = node.sidecar;
  if (!overlay || overlay.present !== true) return null;
  const annotations = overlay.annotations;
  if (!annotations) return null;
  const v = (annotations as Record<string, unknown>)['version'];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
```
