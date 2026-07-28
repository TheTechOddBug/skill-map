---
'@skill-map/cli': patch
---

Closes an AA accessibility audit of the SPA. The Settings switches gain accessible names paired to their visible labels, both tab strips get the arrow-key handlers their roving tabindex assumed (now a shared `roving-tablist` helper), queue rows become keyboard-operable, graph node hosts drop the `role="button"` that hid their own controls, the closed inspector panel goes `inert`, three colour tokens clear contrast minimums, and the desktop-only breakpoint is gated on `(pointer: coarse)`.

## User-facing

**The interface works from the keyboard.** Tab and the arrow keys now reach every settings switch, both tab strips and the queue rows, screen readers announce what each control is, switch labels are clickable, and text and map colours meet contrast minimums.
