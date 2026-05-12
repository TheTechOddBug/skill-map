---
"@skill-map/web": patch
---

Strip em dashes from site copy and source comments across `web/`. Replacements are context-driven: colon for "header: detail" patterns, comma for inline lists or parentheticals, parentheses for nested clauses, semicolon between two related clauses. Touches `i18n.json`, `index.html`, `styles.css`, `app.js`, `modules/*.js`, `scripts/*.js`, plus the demo fixture source (`fixtures/demo-scope/ARCHITECTURE.md`, `.skillmapignore`) and the regenerated demo dataset (`web/demo/data.json`, `web/demo/data.meta.json`). The `cli v—` loading placeholder is now `cli v…`. No functional change; no observable diff outside copy and code-comment text.
