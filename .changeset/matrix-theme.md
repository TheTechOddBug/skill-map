---
'@skill-map/cli': minor
---

Add a Matrix theme as an opt-in extra theme alongside the existing
dark / light / auto tri-state. `ThemeService` grows an orthogonal
`extraTheme: 'matrix' | null` signal that overrides the dark/light
mode when set, persists at `localStorage:skill-map.ui.extra-theme`,
and is selectable from Settings → General → Theme. Clicking the
topbar dark/light toggle clears the extra theme AND advances the
mode one step in the same gesture, so users always have a one-click
exit path.

Theme palette lives in a single isolated stylesheet at
`ui/src/themes/matrix.css`, loaded by `angular.json`'s `styles`
array immediately after `styles.css`. Self-contained: removing the
file from the array fully disables the theme without touching any
other CSS. Selectors use `:root.app-matrix` (var palette, beats
PrimeNG's runtime `:root,:host` injection) and `html.app-matrix .X`
(per-element retints, beats Angular's emulated-encapsulation
rewrite) so the override wins regardless of source order.

Visual surfaces retinted under matrix: page / canvas backgrounds
(pure black with subtly lifted card surfaces), edge ramp
(grey-to-mild-green gradient across the four kinds, preserving
semantic distinguishability), node card glow (terminal-green halo
that intensifies on hover), topbar (full retint including alpha /
version / update chips), graph wrap + Foblex grid line color, the
floating zoom toolbar, and a logo variant
(`skill-map-mark-matrix.svg`) that swaps in via `markSrc()` while
matrix is active. The red severity ramp is also retinted to matrix
green; this trades the universal "red = danger" signal for full
matrix immersion (intentional, called out in the theme file).

## User-facing

A new **Matrix** theme is now available in Settings → General →
Theme. Once enabled it overrides the topbar dark/light toggle;
click that toggle to exit Matrix and return to your previous
dark/light mode in one step.
