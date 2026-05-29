---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Makes the registered Provider set the single source of truth for the UI's provider surfaces (active-lens dropdown, topbar lens chip, per-node provider chip) and for active-lens auto-detection, removing four divergent hardcoded provider lists that no longer matched the real built-in Providers (phantom `gemini` / `cursor` entries, missing `antigravity` / `agent-skills` / `openai`). Providers gain a required `presentation` block; the REST envelope gains a `providerRegistry` field.

## User-facing

The lens picker in **Settings → Project** now lists exactly the providers installed in your project. The phantom **Gemini** and **Cursor** options are gone, and **OpenAI Codex** / **Antigravity** now show their correct name and colour on node cards.
