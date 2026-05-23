---
name: architect
description: Fixture for the Signal IR `signal-collision-detection` conformance case. Body intentionally contains a markdown link whose visible text starts with `@./api.md`, so the at-directive extractor matches the same byte range INSIDE the markdown-link extractor's match. Cross-extractor range overlap; the resolver picks ONE winner (markdown-link, higher confidence) and the loser surfaces as a signal-collision warn.
---

Consult [@./api.md](./api.md) before deploying.
