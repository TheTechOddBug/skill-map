---
"@skill-map/cli": patch
"@skill-map/web": patch
---

The web demo now ships the view-contribution registry, so the node card footer slot icons (tools, links, external refs, issue counts) render in demo mode instead of a bare value with no glyph. The static data source primes it from the bundled meta like the live BFF path does, and the demo build derives it from the kernel. Also reverts the earlier folder/dark-theme icon swap back to Font Awesome (a misdiagnosis: the demo fonts load fine).
