---
"@skill-map/web": patch
---

Fix the site roadmap strip leaving an empty column: the segment grid was hardcoded to seven phases, so dropping the post-1.0 "Beyond" phase left a visible gap. The grid now auto-sizes one column per phase.
