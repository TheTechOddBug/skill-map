---
"@skill-map/cli": minor
---

The portfolio-campaign parts of the bundled `sm-tutorial` skill become jumpable. Each now declares `preflight: seed`, so entering one out of order fast-forwards the project to that part's starting state (it lays the cumulative `.claude/` harness from a checklist, then inits and scans) instead of forcing the tester through the earlier parts first. Run in order it stays a no-op; the skipped predecessors are marked and stay in the menu for later.

## User-facing

In the interactive tutorial you can now jump straight into any part of the portfolio campaign from the menu (say the maintenance or MCP part). If you skipped the earlier parts, the tutorial sets the project up for you so you can start right there.
