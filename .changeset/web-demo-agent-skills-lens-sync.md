---
"@skill-map/web": patch
---

The public demo's pre-baked provider registry mirrors the new lens model: every gated provider carries `isLens: true`, the non-gated `markdown` base is `isLens: false`, and the open lens is relabelled from "Open Skills" to "Agent Skills". Triggers a redeploy of the marketing site so the demo cards match the live CLI.
