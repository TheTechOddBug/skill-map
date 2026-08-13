---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

The two scoped single-file reads, the job-submit drift verification and the incremental scan's reread of unchanged nodes, now honour `scan.followExternalSymlinks` like the scan walk. Before, both ran on the gate's default: a node indexed through an authorised external symlink was scannable but not operable (submits refused it as "file missing") and a live re-scan could silently blank its content. The spec's §Submit step 8 now names the discovery config alongside the parser rules.

## User-facing

Files reached through an allowed external symlink can now be operated: submitting jobs against them works, and live re-scans no longer risk wiping their content from the map.
