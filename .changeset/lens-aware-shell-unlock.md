---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

The Settings shell-unlock line is lens-conditioned instead of hardcoding claude: the `GET /api/activity/install` envelope gains `shellOptIn` (whether the provider's descriptor carries the shell opt-in event), and the capture-level row renders the opt-in command for the ACTIVE lens, an "unavailable on this lens" note for providers without the rung, or nothing while the lens probe is unresolved.

## User-facing

The shell capture instructions in Settings now follow your active lens: they show the command for the provider you are actually using, and tell you when that provider has no shell capture instead of suggesting a Claude command.
