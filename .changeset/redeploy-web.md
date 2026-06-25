---
"@skill-map/web": patch
---

The static demo serves the real scanned lens (Claude) instead of a hardcoded markdown default: the demo dataset now bakes an `activeProvider` envelope derived from the scan, and `StaticDataSource` reads it. Also triggers a redeploy of the marketing site.
