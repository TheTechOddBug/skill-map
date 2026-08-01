---
'@skill-map/cli': minor
---

`-v` goes back to being the `--version` alias it is in every other CLI. A `-v` / `-vv` / `-vvv` verbosity counter had claimed it, which both broke that universal expectation and left `sm -v` with no verb to run, so it fell into the bare `sm serve` fan-out and hung. Verbosity is now only the named parameter, and `--log debug` is accepted as a short form of `--log-level debug`. An argv of nothing but global flags no longer launches a server either.

## User-facing

`sm -v` prints the version again, instantly, instead of quietly starting a server and hanging. To raise the log level use `--log debug` (or `--log-level debug`); the `-v` / `-vv` / `-vvv` counter is gone.
