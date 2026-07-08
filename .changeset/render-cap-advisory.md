---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

`sm scan` now prints an info advisory when the scanned corpus has more nodes than the map render cap (`scan.maxNodes`, default 256): the full corpus is still scanned and reference-validated, only the graph view paginates. The in-map render-cap banner is now corpus-aware, so it also fires when the whole project exceeds the cap while the selected branch fits, keeping the signal visible when you drill into a small sub-folder.

## User-facing

When your project has more files than the map can show at once (256 by default), sm scan now tells you in the terminal, and the map banner appears even while you are viewing a small folder. Nothing is lost, the map just draws part of the project at a time.
