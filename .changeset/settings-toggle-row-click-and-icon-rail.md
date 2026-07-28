---
"@skill-map/cli": patch
---

Every boolean row in Settings now flips its switch from anywhere on the row, not just the switch itself: a new `[smToggleRow]` directive forwards the click to the row's `<p-toggleswitch>`, covering the ten toggles across Preferences, Realtime, Live, Capture and General while select, text and button rows stay untouched. The Settings section rail also gains per-section icons and matches the Quick Start rail's label scale, padding and active accent bar.

## User-facing

**Click anywhere on a setting to switch it.** Every on/off option in Settings now flips from anywhere on its row, not just the small switch on the right. The Settings sidebar also gains icons and now matches the Quick Start one.
