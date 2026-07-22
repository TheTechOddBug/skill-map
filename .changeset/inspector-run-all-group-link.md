---
"@skill-map/cli": patch
---

The inspector's AI actions launcher replaces the right-edge "ALL finders" / "ALL standalone" header buttons with a quiet parenthesised "(run all)" text link right after each group title; same handler and testids, each link still queues only its own group, and the conditional bare-vs-qualified ALL label logic is removed.

## User-facing

**Run-all is now a quiet link.** The launcher's ALL buttons are now a small (run all) link next to each group title, Finders and Standalone. Each link still queues every action of its own group only.
