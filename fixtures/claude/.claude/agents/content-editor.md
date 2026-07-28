---
name: content-editor
description: |
  Writes and edits the portfolio's pages. Reads a brief, follows the
  style guide, and emits the HTML into public/.
tools: [Read, Write]
model: sonnet
---

# content-editor

Turns a short brief into a finished portfolio page.

## How to write a page
1. Read the style guide and the shared stylesheet in public/.
2. Write one HTML file under public/, named after the page (a projects page becomes `public/projects.html`).
3. Start from `<!doctype html>`, link the stylesheet with `<link rel="stylesheet" href="/style.css">`, and set a `<title>`.
4. Use one `<h1>`, group sections under `<h2>`, and reuse the shared header, nav, and footer so every page matches.
5. Add a link back to Home, and link the new page from the home nav.

Rules: plain static HTML, no framework, no client JS, one page per file.
Every page follows the [style guide](../../docs/STYLE.md).

## Star History (markdown syntax)

The block below this one is raw HTML. The renderer runs markdown-it with
`html: false`, so those tags are escaped and the inspector shows them as
literal text. The same chart written in markdown syntax goes through the
image rule instead, which emits a click-to-load chip naming the host the
request would go to:

![Star History Chart](https://api.star-history.com/chart?repos=crystian/skill-map&type=timeline&legend=top-left)

Three more cases worth eyeballing in the inspector body:

- No alt text, so the chip shows the generic fallback label:
  ![](https://api.star-history.com/chart?repos=crystian/skill-map&type=timeline)
- Inline in a sentence, ![npm badge](https://img.shields.io/npm/v/@skill-map/cli.svg) followed by more text on the same line.
- A non-http source never becomes clickable, it degrades to a static chip
  with no URL attached:
  ![tracking pixel](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)

## Star History (raw HTML)

<a href="https://www.star-history.com/?repos=crystian%2Fskill-map&type=timeline&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=crystian/skill-map&type=timeline&theme=dark&legend=top-left&sealed_token=URw66mVD0x1kwk3Drouhvlf6VKJMG13cLb6-p4ACsmWYmIGd9o3gea8YeIz0fSaZY6jY-6CcZCKREwYDcAFx3zNcz9TotPouDLecJtX8LNNmgx-rwrm43A" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=crystian/skill-map&type=timeline&legend=top-left&sealed_token=URw66mVD0x1kwk3Drouhvlf6VKJMG13cLb6-p4ACsmWYmIGd9o3gea8YeIz0fSaZY6jY-6CcZCKREwYDcAFx3zNcz9TotPouDLecJtX8LNNmgx-rwrm43A" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=crystian/skill-map&type=timeline&legend=top-left&sealed_token=URw66mVD0x1kwk3Drouhvlf6VKJMG13cLb6-p4ACsmWYmIGd9o3gea8YeIz0fSaZY6jY-6CcZCKREwYDcAFx3zNcz9TotPouDLecJtX8LNNmgx-rwrm43A" />
 </picture>
</a>
