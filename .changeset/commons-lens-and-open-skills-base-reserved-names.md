---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

The vendor-neutral open-skills Provider (`agent-skills`) now owns a base reserved-name catalog of the universal cross-agent slash commands under `skill` and is renamed from "Open Skills" to "Commons", so a user skill shadowing a built-in like `help` or `config` is flagged by `core/name-reserved` under the neutral lens, while vendor Providers (Antigravity) inherit that base by manifest composition and append their own runtime-specific verbs on top.

## User-facing

**The skills lens is now called Commons.** Renamed from "Open Skills" in the lens dropdown, the topbar, and node chips. With it active, a skill you authored that shares a name with a built-in command (like `help` or `config`) now gets a warning, since the command shadows it.
