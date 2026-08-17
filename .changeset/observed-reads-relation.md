---
'@skill-map/spec': minor
'@skill-map/cli': minor
---

The session-journal fold gains the `reads` relation class (an `access: 'read'` frame correlated to its reading unit by owner), turn-bounded (a `turnEnd` clears the owner's unit claim) and gated against noise: `observed-link-missing` flags a read pair only past 3 observations and accepts a `points` link as coverage, while `observed-link-dead` now judges `references` links toward ANY scanned target (an observed read confirms them; `invokes` links still require an mcp or agent target).

## User-facing

Recorded sessions now track which files your skills and agents actually read: repeated reads of something you never reference get flagged, and a declared reference that keeps being read counts as confirmed instead of dead.
