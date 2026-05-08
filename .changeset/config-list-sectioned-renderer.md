---
"@skill-map/cli": patch
---

Redesign the `sm config list` human renderer. Effective dot-paths are now grouped into a closed catalogue of sections — General, Scan, Jobs, Roots & plugins, History, plus an `Other` catch-all for future keys — printed in that order. Each section gets a header followed by indented `  <key>   <value>` rows, with the key column padded to the longest key in the section and entries sorted alphabetically by their displayed form (the section prefix is stripped in display, so `scan.tokenize` shows as `tokenize` under Scan, `jobs.maxConcurrency` as `maxConcurrency` under Jobs, etc.). Empty sentinels (`null`, `[]`, `{}`) collapse to a dim em-dash so the eye skips defaults and lands on populated overrides. The flag surface is unchanged and `--json` output is byte-identical to before; only the human path is touched. Tests that asserted on the old flat `key = value` shape now match the new padded `<key>   <value>` rows.
