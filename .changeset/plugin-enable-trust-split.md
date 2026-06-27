---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Split plugin enable (operational) from import trust (security). Enable/disable now persist to the config layers, not the DB; `config_plugins` becomes a per-plugin local trust store. New `sm plugins trust / untrust` verbs, a trust PATCH route, a Settings UI Trust control, and a `pluginTrust.projectEnabled` opt-in grant or revoke consent to run a project-local plugin. It runs only when enabled AND trusted, so disabling one no longer re-reads as untrusted.

## User-facing

Plugins now have two separate switches: enable (is it part of the project, shared) and trust (may its code run on your machine). New `sm plugins trust` / `untrust` plus a Trust button in Settings. A plugin you disabled stays disabled instead of nagging that it is untrusted.
