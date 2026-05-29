---
"@skill-map/cli": minor
"@skill-map/spec": minor
"@skill-map/web": patch
---

Migrate the canonical domain from `skill-map.dev` to `skill-map.ai` everywhere: schema `$id` / `$ref` and the `spec/index.json` canonical URL prefix, the bundled plugin schemas and validators, the public site (canonical URLs, Open Graph, Twitter, JSON-LD, the `/demo/` deploy), and the UI's Settings about-link and demo banner. No shape or behavior change; the spec scheme stays `v0`.

## User-facing

The skill-map website and in-app links (Settings, About and the demo banner) now point to **skill-map.ai** (previously skill-map.dev). Spec schema URLs are now `https://skill-map.ai/spec/v0/...`.
