---
"@skill-map/cli": patch
"@skill-map/spec": minor
---

New `GET /api/github-stars`: the star count, read by the SERVER (unauthenticated, cached 6h) and not the browser, since the token-free limit is 60/hour per IP and every tab spends the same budget. Shows as a Star link in the topbar and a badge on the About CTA; anything unknown collapses to `count: null` and renders NOTHING, since skill-map must work offline. Opt-out in Settings → General. Also fixes `writeUserSettings`, whose merge listed its sub-objects by hand and dropped new preferences.

## User-facing

The top bar now shows how many stars skill-map has on GitHub, and clicking it opens the repository. It disappears by itself when you are offline, and you can turn it off in Settings → General.
