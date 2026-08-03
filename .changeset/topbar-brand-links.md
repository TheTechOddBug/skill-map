---
"@skill-map/cli": patch
---

The topbar brand is clickable: the mark opens skill-map.ai, the wordmark opens the GitHub repository, both in a new tab with `rel="noopener noreferrer"` and each with its own accessible name (the mark's image is decorative, so its link would otherwise be unnamed). The two URLs moved to `i18n/project-links.ts`, shared with About. Also widens the node-activity TTL decay waits to 500ms behind `afterTtlDecay()`; they were a coin flip on a loaded machine.

## User-facing

The logo and the skill-map title in the top bar are now links: the logo opens the website, the title opens the GitHub repository, both in a new tab.
