---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

Live node activity v1 (contract in `spec/provider-activity.md`): Providers gain an optional `activity` capability, `sm serve` publishes `.skill-map/serve.json` (bind address plus per-session token) and serves a token-gated `POST /api/activity` that resolves provider hook events to scanned nodes and broadcasts `node.activity` over `/ws`, `sm activity install|uninstall` wires a zero-dependency bridge into the provider's hook config, and the map lights executing nodes. Ships the `claude` adapter.

## User-facing

**Watch your map light up as your assistant works.** With `sm serve` running, run `sm activity install claude`: every skill, agent, or command Claude Code invokes now glows on the map in real time, and the path between an agent and the skill it runs lights up as one chain.
