---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Plugin settings debt pass: the `secret` `envVar` override is now real (a non-empty env value wins over the stored one, the config table reports `[env]`, the UI shows the secret as set), the `github/enrichment` base-URL overrides became writable (project-local-only keys now route to `settings.local.json` from both the CLI and the UI), `sm plugins doctor` gained an `unknown-input-type` warning, and the spec stopped describing secrets as encrypted. Details in `spec/input-types.md`.

## User-facing

Plugin secrets (like the GitHub token) can now come from an environment variable, handy for CI, and the GitHub Enterprise URL overrides can finally be saved from Settings or the CLI (they land in your local, uncommitted config).
