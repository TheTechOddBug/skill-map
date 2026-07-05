---
"@skill-map/spec": minor
---

cli-contract.md now specifies that `sm scan`/`sm watch` contain the scan to the project by default: a symlink whose real target escapes the scan roots is skipped rather than followed, defeating a committed hostile symlink that reads arbitrary local files. A new project-local-only `scan.followExternalSymlinks` boolean (default false) in project-config.schema.json opts back in.
