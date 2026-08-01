---
'@skill-map/cli': minor
---

The log level can now be set once per machine, as `logLevel` in `~/.skill-map/settings.json`, instead of retyping `--log-level` or exporting an env var. It sits at the bottom of the precedence chain (`-v` counter, then `--log-level`, then `SKILL_MAP_LOG_LEVEL`, then this, then the `warn` default), so a standing preference never fights a one-off invocation, and `sm serve` inherits it like every other verb.

## User-facing

Tired of typing `--log-level debug`? Put `"logLevel": "debug"` in `~/.skill-map/settings.json` and every `sm` command on this machine picks it up. Any flag or env var on a single run still wins.
