---
'@skill-map/cli': patch
---

Two surfaces that ignored project-local reality. `sm agent` and the processing-agent gate built their scaffold catalog from the built-in Providers alone, so `sm agent install` refused with "the active lens declares no skill directory" under a lens whose plugin declared `scaffold.skillDir`; both read the composed Provider set now. And `sm scan --dry-run` persisted the auto-detected lens, leaving a settings file behind; it writes nothing.

## User-facing

`sm agent install` now works under a lens that comes from one of your own plugins, instead of claiming it has nowhere to install. And `sm scan --dry-run` no longer leaves a settings file behind.
