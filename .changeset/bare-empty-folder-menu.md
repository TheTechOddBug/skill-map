---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Bare `sm` in an empty folder now offers a getting-started menu: on an interactive terminal it asks whether to run the guided tutorial (`sm tutorial`) or drop a ready-to-explore example project (`sm example`), then dispatches the chosen verb. In a non-empty folder, or on a non-interactive stdin, it still prints a one-line hint and exits 2, now pointing at `sm tutorial` / `sm example` when the folder is empty and at `sm init` otherwise.

## User-facing

Run `sm` in an empty folder and it now asks how you want to start: a guided tutorial, or a ready-made example project to explore. Pick one and it sets it up for you.
