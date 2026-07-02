---
'@skill-map/spec': patch
---

Document that cross-filesystem WSL to Windows is unsupported. The inotify-based live watcher (`chokidar` / `parcel`) receives no events on a mounted Windows drive (`/mnt/c`), so `sm serve` / `sm watch` never refresh the map there, and a symlink to a Windows path is followed on a one-shot `sm scan` but not live-watched. Added to `spec/cli-contract.md` §Scan (the watcher paragraph). No behavior change and no polling fallback ships; keep the project on the Linux filesystem for a live map.
