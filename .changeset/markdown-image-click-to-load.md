---
"@skill-map/cli": patch
---

Images in rendered markdown come back as click-to-load placeholders, replacing the outright drop from the previous entry. The markdown-it `image` rule now emits an inert chip naming the image and the host the request would go to (interactive in block renders, static inline), and the new `[smMarkdownImages]` directive swaps in an `<img referrerpolicy="no-referrer">` only on a real click; `img` stays in the sanitizer's forbidden tags as the backstop.

## User-facing

**Images in rendered markdown now load on click.** Instead of disappearing, an image in a document body shows a placeholder naming it and the site it comes from; click it to load. Nothing is fetched until you do, so opening a file still tells its author nothing about you.
