---
"@skill-map/cli": minor
---

Hardening pass from a security audit of `src/`. Terminal sanitisation now covers the 8-bit C1 controls, the Unicode line separators and the bidi overrides, closing a clipboard write and a filename spoof that carried no ESC byte. `allowNetworkActions` moves to the project-local config layer, the chokidar watcher refuses symlinks escaping the scan roots, a malformed `.skillmapignore` line warns instead of aborting the scan, and `--plugin-dir` announces that it loads code untrusted.

## User-facing

Hostile filenames can no longer repaint your terminal or disguise what a file is called. A broken line in `.skillmapignore` warns instead of killing the scan. `allowNetworkActions` is now per-machine: re-enable it with `sm config set allowNetworkActions true`.
