---
'@skill-map/cli': minor
---

`github/enrichment` gained `apiBaseUrl` and `rawBaseUrl` settings, honoured ONLY from the gitignored `settings.local.json`: the operator's token rides the Authorization header to whatever the API base says, so a committed override in a cloned repo would exfiltrate it on the first refresh. The conformance runner also serves `setup.staticServe` fixtures and spawns every staged child asynchronously, fixing a latent deadlock.
