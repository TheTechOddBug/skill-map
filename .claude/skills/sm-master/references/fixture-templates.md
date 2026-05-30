# Fixture templates

Read this file during pre-flight steps 3 and 4 of `SKILL.md`. It
holds the verbatim content of every file the skill writes to the
cwd at boot, plus the initial `master-state.yml` template.

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
├── master-state.yml
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
# Findings, sm-master

If you spot anything weird during the tutorial, log it here.

Per finding:
- **Tour**: <id>
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
  provider: "<claude | agent-skills | antigravity>"   # filled from §Provider detection
tours:
  # Add a new tour by appending another entry here, mirroring the
  # shape below: status, estimated_min, and a steps[] array whose
  # ids match the prefix of the reference file that owns the body
  # (e.g. tour-foo.md → steps prefixed `foo-*`). The orchestrator
  # in SKILL.md walks this list and dispatches each step id to its
  # reference file.
  plugins-tour:
    status: "not_started"   # not_started | in_progress | done | declined
    estimated_min: 13
    # All step bodies live in tour-plugins.md (tour-* ids).
    steps:
      - id: "tour-1-intro"
        title: "How plugins work"
        status: "pending"
      - id: "tour-2-kinds"
        title: "The six extension kinds"
        status: "pending"
      - id: "tour-3-explore"
        title: "Explore one extension up close"
        status: "pending"
  settings-and-consent:
    status: "not_started"
    estimated_min: 5
    # Settings + the `.sm` consent gate. Step bodies live in
    # tour-settings.md (settings-* ids).
    steps:
      - id: "settings-1-project"
        title: "Project settings: `.skill-map/settings.json`"
        status: "pending"
      - id: "settings-2-local"
        title: "Per-user overrides: `settings.local.json`"
        status: "pending"
  build-and-configure:
    status: "not_started"
    estimated_min: 17
    # Author a plugin end-to-end, then watch its contribution land
    # and validate the manifest. Step bodies live in the two
    # existing reference files (settings-* → tour-settings.md,
    # authoring-* → tour-authoring.md); this list is the
    # authoritative order.
    steps:
      - id: "authoring-1-scaffold"
        title: "`sm plugins create demo-highlight`"
        status: "pending"
      - id: "authoring-2-anatomy"
        title: "Tour the scaffold (plugin.json + stubs + README)"
        status: "pending"
      - id: "authoring-3-edit-setting"
        title: "Edit a setting (string-list) and observe it in the UI"
        status: "pending"
      - id: "authoring-4-edit-slot"
        title: "Change the view-slot the contribution targets"
        status: "pending"
      - id: "settings-6-contributions"
        title: "Watch contributions land in the inspector"
        status: "pending"
      - id: "authoring-5-doctor-author"
        title: "Catch a manifest mistake with `sm plugins doctor`"
        status: "pending"
      - id: "authoring-6-upgrade"
        title: "Try `sm plugins upgrade` (no-op today, structure tour)"
        status: "pending"
findings_file: "./findings.md"
```
