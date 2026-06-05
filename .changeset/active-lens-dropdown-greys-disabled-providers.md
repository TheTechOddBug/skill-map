---
"@skill-map/spec": minor
"@skill-map/cli": patch
---

The active-provider lens dropdown in Settings → Project now greys out (and refuses to select) any Provider the operator has disabled. `GET /api/active-provider` gained a `selectable` field listing the Provider ids that are enabled right now; the SPA renders Providers absent from it as disabled instead of offering a lens whose extractors would never run.

## User-facing

Disabling a provider plugin now removes it as a choice in **Settings → Project → Active provider**. The provider stays listed but greyed out and labelled `(disabled)`, so you can no longer switch the lens to a provider whose extractors would not run.
