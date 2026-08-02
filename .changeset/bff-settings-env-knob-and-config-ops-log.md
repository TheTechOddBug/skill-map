---
"@skill-map/cli": patch
---

The BFF no longer reads `process.env` directly: `sm serve` snapshots it once into the required `IServerOptions.settingsEnv` knob (lint-enforced under `server/**`). Plugin-settings writes now append operations-log lines (`config.set` / `config.reset`, key only, CLI and UI channels), and `sm plugins config <id> <setting> --reset` correctly removes a project-local-only override (e.g. the github `apiBaseUrl`) instead of failing with exit 2.
