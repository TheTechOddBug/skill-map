---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Two new built-in Providers — `gemini` and the vendor-neutral `agent-skills` — plus a tighter `IProvider.classify()` contract so multiple Providers can scan the same roots without colliding.

**`gemini`**

- Walks Google's Gemini CLI on-disk conventions: `.gemini/agents/*.md` → `agent`, `.gemini/skills/<name>/SKILL.md` → `skill`, `.gemini/**/*.md` and `GEMINI.md` → `markdown` (the format-named generic fallback).
- Per-kind frontmatter schemas absorb Google's documented contracts verbatim:
  - `agent.schema.json` — 7 vendor-specific fields (`kind: local|remote`, `tools`, `mcpServers`, `model`, `temperature`, `max_turns`, `timeout_mins`) per https://geminicli.com/docs/core/subagents/. `name` + `description` come from spec base.
  - `skill.schema.json` — thin `allOf` extension of base; Google's documented Skill format requires only `name` + `description`.
  - `markdown.schema.json` — fallback, base only.
- UI: Gemini purple + Google blue palette; `pi-sparkles` icon for agents.
- Conformance: `basic-scan` case + `minimal-gemini` fixture (agent + skill + GEMINI.md).
- Bundle granularity: `bundle` (the Provider is the bundle's only extension today; future Gemini-namespaced extractors land here).

**`agent-skills`**

- Vendor-neutral Provider that owns the open-standard path `.agents/skills/<name>/SKILL.md` jointly adopted by Anthropic, OpenAI (Codex), and Google (Gemini). Single kind: `skill`. Reclaims the path so vendor-specific Providers don't have to — the day a Codex Provider lands, the spec's `provider-ambiguous` rule fires zero times because the open-standard path already has a home.
- UI: deliberately neutral slate (`#64748b` / `#94a3b8`) so the kind reads as "vendor-agnostic" at a glance.
- Conformance: `basic-scan` case + `minimal-agent-skills` fixture.

**`IProvider.classify()` returns `string | null`**

- Old contract: `classify(path, fm): string` — must return a kind name. Old Claude returned `'markdown'` for non-`.claude/` paths; with one Provider this was fine, with multiple Providers it doubles up the same path (SQLite UNIQUE on `scan_nodes.path` violation).
- New contract: `classify(...) → string | null`. `null` means "not my file"; the orchestrator skips it. Each Provider claims its own conventions and disclaims the rest.
- Claude: claims `.claude/{agents,commands,skills}/`, `.claude/**/*.md` (catch-all under `.claude/`), `notes/**/*.md`, and `CLAUDE.md`. Disclaims everything else.
- Gemini: claims `.gemini/{agents,skills}/`, `.gemini/**/*.md`, and `GEMINI.md`. Disclaims everything else.
- agent-skills: claims `.agents/skills/<name>/SKILL.md` only.

**Per-Provider node painting (consumer-side fix from Phase A)**

- `node-card` now binds `[style.--accent]="providerAccent()"` so a node sourced from a non-primary Provider paints with its own Provider's color (e.g. a Gemini-sourced `agent` renders in `#9b72cb` even when Claude is the primary contributor to the `agent` kind). Primary Providers fall through to the existing `--sm-kind-<kind>` CSS var without an inline override.
- `KindRegistryService.providersOf(kind)` returns the per-Provider sub-map; `node-card.providerAccent()` reads `entry.providers[node.provider]?.color`.

**Conformance fixture migration**

- All Claude conformance fixtures (`minimal-claude`, `rename-high-{before,after}`, `orphan-{before,after}`) move from project-relative `agents/` / `commands/` / `skills/` paths to `.claude/agents/` / `.claude/commands/` / `.claude/skills/` so the Claude Provider's strict `classify()` claims them.
- `spec/conformance/fixtures/sidecar-end-to-end/agents/` → `.claude/agents/`. The matching `sidecar-end-to-end.json` case asserts the new paths.
- `spec/conformance/cases/plugin-missing-ui-rejected.json` updated to assert all 3 built-in providers in the result (was 1).
- `spec/conformance/fixtures/plugin-missing-ui/.skill-map/plugins/bad-provider/provider.js` now declares the `markdown` kind to mirror Claude's catalog.
- The bad-provider fixture is unchanged in intent — still rejects manifests missing `ui` — but uses the `markdown` kind to align with the Provider's current catalog.

**Tests**

- 8 new Gemini provider tests, 6 new agent-skills tests, 2 new node-card per-Provider painting tests. The bulk of the existing tests update to the new fixture paths; built-in modes / pluginId tests now allow the `gemini` and `agent-skills` pluginIds; the cross-provider count assertions in `plugin-runtime-branches.test.ts` (3 providers when no toggles) pick up the two new bundles.
- Total: 1098 cli tests + 307 ui tests, all green.

**Backward compatibility**

Greenfield (`feedback_greenfield_no_versioning.md`): the `classify()` signature change is breaking for any plugin Provider in the wild — no released consumer holds a Provider implementation today. Stays minor pre-1.0 per `versioning.md` § Pre-1.0. Existing local DBs rescan to pick up the new kind layout (no migration ships).
