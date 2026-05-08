---
"@skill-map/web": patch
---

Public site copy refresh to match the new tagline shipped in the CLI/README this cycle. `meta.title`, `og:image:alt`, `twitter:title`, `twitter:image:alt`, the `<title>` element, and the `foot.tagline` slot all switch from "graph explorer for AI agent skill ecosystems" / "explorador de grafos…" to "The missing map for generative-AI ecosystems" / "El mapa que le faltaba a tu ecosistema de IA generativa". Also renames the graph legend `note` row to `markdown` (key `graph.legend.note` → `graph.legend.markdown`, both in `web/index.html` and `web/i18n.json`) so the legend reflects the 0.18.0 `core/markdown` Provider rename, and updates the Provider section example list and the "For authors" case copy to talk about "markdown" instead of "note" when describing file kinds. ES copy continues to use neutral Spanish (no rioplatense voseo) per the public-site convention.
