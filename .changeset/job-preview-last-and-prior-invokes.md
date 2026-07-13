---
"@skill-map/cli": minor
---

`sm job preview --last` previews the most recently submitted job without copying its id (exactly one of `<job.id>` or `--last`; empty queue exits 5). The conformance runner implements the new `setup.priorInvokes` staging phase and the `stdout-contains-verbatim` assertion, and the spec-owned `preamble-bitwise-match` case now runs in the suite.

## User-facing

**Preview your latest job instantly.** After `sm job submit`, run `sm job preview --last` to read the rendered prompt without copying the job id.
