---
"@skill-map/cli": minor
---

Settings → General gains two live-channel switches persisted in a new localStorage seam (`LivePreferencesService`): one gates the whole `/ws` socket via a new `'disabled'` connection state (distinct from `'lost'`, so the banner never nags about a chosen disconnect), the other gates real-time node activity (off drops buffered frames and clears every lit claim immediately). Both persist and apply atomically through the feature owners' `setEnabled`.

## User-facing

**Live updates on your terms.** Settings → General gains two switches: turn live updates on or off entirely, and toggle real-time node activity (the glow that follows your assistant) separately. Both take effect instantly, no reload.
