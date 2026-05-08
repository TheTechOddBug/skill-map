---
"@skill-map/cli": patch
---

Terminal-UX polish across `sm plugins doctor` and `sm tutorial`. Doctor warning bodies no longer repeat the qualified id (`Provider '<id>' declares ...`) — the id already lands in the entry header glyph row, so the body now reads `Declares explorationDir '<path>', but ...`. `sm tutorial` opens with the same violet "Skill Map" figlet block that `sm serve` does (printed to stderr so it stays out of any pipe consuming stdout), and a trailing blank line in the success template puts breathing room between the body and the `done in <…>` footer.
