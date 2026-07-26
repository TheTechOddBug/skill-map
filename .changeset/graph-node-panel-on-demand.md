---
"@skill-map/cli": patch
---

Graph node cards build their expandable panel on demand instead of on every render. The panel is `display: none` while a card is collapsed, so every node used to construct markup the browser refused to paint: the path row, the LLM cluster, the description with its markdown render, and the agent meta rows. On a 256-node map the card drops from 55 to 46 DOM elements and the graph from 21,572 to 19,492, and the saving grows with how much summary content the nodes carry.
