---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

The provider / active-lens labels now follow one consistent naming pattern: vendor lenses use a possessive `<Vendor>'s <product>` form ("Anthropic's Claude", "OpenAI's Codex", "Google's Antigravity") and the vendor-neutral open standard uses a `Standard: <name>` prefix ("Standard: Agent skills"). The non-selectable `core/markdown` base keeps its internal "Markdown" label. The provider schema and kernel JSDoc document the pattern.

## User-facing

The provider lens names now read consistently: "Anthropic's Claude", "OpenAI's Codex", "Google's Antigravity", and "Standard: Agent skills". The change shows up in the lens dropdown, the topbar lens chip, and the per-node provider chips.
