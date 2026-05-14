# Fixture templates

Read this file during pre-flight steps 3 and 4 of `SKILL.md`. It
holds the verbatim content of every file the skill writes to the
cwd at boot, plus the initial `master-state.yml` template.

## Fixture layout

```
<cwd>/
├── .claude/
│   ├── agents/
│   │   └── master-agent.md
│   └── skills/
│       └── master-skill/
│           └── SKILL.md
├── notes/
│   └── ideas.md
├── master-state.yml
└── findings.md
```

Translate the natural-language prose (descriptions, body text,
list items) to the tester's language. Keep paths, frontmatter
keys, identifiers, and link targets in English.

## File: `.claude/agents/master-agent.md` (kind: agent)

```markdown
---
name: master-agent
description: |
  Example agent used by the advanced tutorial. Has a couple of
  tools so the `core/tools-count` extractor emits a count.
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
# Findings, sm-master

If you spot anything weird during the tutorial, log it here.

Per finding:
- **Module**: <id>
- **Command**: `sm ...`
- **Expected**: ...
- **Got**: ...
- **Notes**: ...
```

## State YAML

Write to `<cwd>/master-state.yml`. Substitute the timestamps and
the captured `sm version` output.

```yaml
master:
  version: 1
  started_at: "<ISO-8601 now>"
  cwd: "<output of pwd>"
  sm_version: "<output of sm version>"
modules:
  plugins-tour:
    status: "not_started"   # not_started | in_progress | done | declined
    estimated_min: 12
    steps:
      - id: "tour-1-init"
        title: "sm init and scan the fixture"
        status: "pending"
      - id: "tour-2-list"
        title: "Survey the built-in catalogue with `sm plugins list`"
        status: "pending"
      - id: "tour-3-kinds"
        title: "Walk the six extension kinds"
        status: "pending"
      - id: "tour-4-show"
        title: "Inspect one extension with `sm plugins show`"
        status: "pending"
      - id: "tour-5-doctor"
        title: "Run `sm plugins doctor` and read the warnings"
        status: "pending"
      - id: "tour-6-toggle"
        title: "Disable and re-enable an extension; watch the effect"
        status: "pending"
  plugins-authoring:
    status: "not_started"
    estimated_min: 15
    steps:
      - id: "auth-1-scaffold"
        title: "`sm plugins create demo-highlight`"
        status: "pending"
      - id: "auth-2-anatomy"
        title: "Tour the scaffold (plugin.json + stubs + README)"
        status: "pending"
      - id: "auth-3-edit-setting"
        title: "Edit a setting (string-list) and observe it in the UI"
        status: "pending"
      - id: "auth-4-edit-slot"
        title: "Change the view-slot the contribution targets"
        status: "pending"
      - id: "auth-5-doctor-author"
        title: "Catch a manifest mistake with `sm plugins doctor`"
        status: "pending"
      - id: "auth-6-upgrade"
        title: "Try `sm plugins upgrade` (no-op today, structure tour)"
        status: "pending"
  settings-slots:
    status: "not_started"
    estimated_min: 12
    steps:
      - id: "set-1-project"
        title: "Project settings: `.skill-map/settings.json`"
        status: "pending"
      - id: "set-2-local"
        title: "Per-user overrides: `settings.local.json`"
        status: "pending"
      - id: "set-3-user"
        title: "User scope: `~/.skill-map/`"
        status: "pending"
      - id: "set-4-slots-list"
        title: "Catalogue tour: `sm plugins slots list`"
        status: "pending"
      - id: "set-5-input-types"
        title: "Input-type catalogue (10 input types)"
        status: "pending"
      - id: "set-6-contributions"
        title: "Watch contributions land in the inspector"
        status: "pending"
findings_file: "./findings.md"
```
