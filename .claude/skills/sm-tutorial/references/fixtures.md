# Fixture templates

Read this file during pre-flight steps 3 and 4 of `SKILL.md`. It
holds the verbatim content of every file the skill writes to the
cwd at boot.

## Fixture layout (per provider)

Per §Provider detection in `SKILL.md`, the `<provider_dir>`
placeholder resolves to `.claude/` or `.agents/skills/` depending
on the detected runtime (Google's Antigravity CLI, which replaced
Gemini CLI on 2026-05-19, adopted the same open standard as
`agent-skills`, so both share the `.agents/skills/` layout). Drop
any file whose kind is not in the provider's supported set: on
`agent-skills` / Antigravity only the skill + note are valid;
on `claude` (default) all three apply.

Canonical layout (substitute `<provider_dir>` per detection):

```
<cwd>/
├── <provider_dir>/
│   ├── agents/                    (claude only)
│   │   └── master-agent.md
│   └── skills/                    (both providers)
│       └── master-skill/
│           └── SKILL.md
├── notes/
│   └── ideas.md
└── findings.md
```

On `agent-skills` the `agents/` subtree is omitted (the provider
does not claim that kind); the skill lives at
`.agents/skills/master-skill/SKILL.md`.

Translate the natural-language prose (descriptions, body text,
list items) to the tester's language. Keep paths, frontmatter
keys, identifiers, and link targets in English.

## File: `.claude/agents/master-agent.md` (kind: agent)

```markdown
---
name: master-agent
description: |
  Example agent used by the advanced tutorial. Has a couple of
  tools so the `core/tools-counter` extractor emits a count.
tools: [Read, Bash, Edit]
model: sonnet
metadata:
  version: "1.0.0"
---

# master-agent

Walks the master-skill outputs and reports findings. Used as the
target node when we exercise extractors, analyzers, and the
plugin-authoring flow.
```

## File: `.claude/skills/master-skill/SKILL.md` (kind: skill)

```markdown
---
name: master-skill
description: |
  Example skill paired with the master-agent for the advanced
  tutorial. Links to the agent so extractors and analyzers have
  something to chew on.
inputs:
  - name: target
    type: path
    description: File to process.
    required: true
outputs:
  - name: report
    type: string
    description: Markdown summary.
metadata:
  version: "1.0.0"
---

# master-skill

Hands heavy work over to the
[master-agent](../../agents/master-agent.md) and emits a Markdown
report.

## Steps
1. Read the `target`.
2. Validate the frontmatter.
3. Delegate to the agent.
```

## File: `notes/ideas.md` (kind: markdown)

```markdown
---
name: Ideas backlog
description: |
  Free-form notes for the advanced tutorial. Demonstrates the
  catch-all markdown kind alongside the agent and skill.
tags: [notes, master]
metadata:
  version: "1.0.0"
---

# Ideas

- [ ] Compare extractor outputs side by side.
- [ ] Sketch a tiny plugin that surfaces a counter on the agent.
```

## File: `findings.md`

```markdown
# Findings

If you spot anything weird during the tutorial, log it here.

Per finding:
- **Chapter**: <id>
- **Command**: `sm ...`
- **Expected**: ...
- **Got**: ...
- **Notes**: ...
```
