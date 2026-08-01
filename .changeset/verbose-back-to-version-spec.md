---
'@skill-map/spec': minor
---

§Global flags drops the `-v` / `-vv` / `-vvv` verbosity counter and restores `-v` as the `--version` alias, recording why: a single-letter flag that nearly every CLI reads as "version" is not available to repurpose, and a counter leaves a bare `-v` with no verb to run. Verbosity is the named parameter only, and `--log <level>` joins `--log-level <level>` as an equivalent spelling.
