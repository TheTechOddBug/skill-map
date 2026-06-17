---
"@skill-map/cli": patch
"@skill-map/web": patch
---

The map card's file-path folder icon and the dark-theme toggle icon switched from Font Awesome's regular weight (`fa-regular`) to the matching PrimeIcons glyphs (`pi-folder-open`, `pi-moon`). These were the only two first-party icons relying on the `fa-regular` webfont, which is not reliably served on the public demo deploy, so they rendered blank there; PrimeIcons is already the icon set the surrounding controls use, so the icons now render consistently. Icon meaning is unchanged.
