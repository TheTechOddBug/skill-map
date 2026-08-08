---
"@skill-map/cli": patch
---

Repair the two test suites the executing-tool badge broke (the activity endpoint's custody frame now expects `detail: 'Agent'`; the graph-view harness stubs the new `executionDetails` signal), and gate `main` npm releases on the `ci` workflow finishing green (workflow_run trigger with an npm no-op guard) so a red build can no longer publish.
