---
"@skill-map/cli": patch
---

Graph node cards drop a single-child wrapper (`.sm-gnode__content`) whose flex settings were inert with one child; its sizing moved onto the name row it used to contain. One element less per card, 256 fewer on a full 256-node map. The name still truncates with an ellipsis and the icon / name / actions columns keep their order and offsets.
