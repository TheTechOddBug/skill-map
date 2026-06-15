---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Rename `core/signal-collision` to `core/extractor-collision` (the rule surfaces two extractors colliding over the same span of text; "Signal" was internal IR jargon) and drop the dead `extractorDisabled` / `belowFloor` rejection stubs from the resolver schema, the `ISignalResolution` type, and the analyzer. The finding now carries the canonical `L<line>:` prefix and a `fix.summary` hint (rephrase one token, or accept the winner).

## User-facing

**`signal-collision` is now `extractor-collision`** and reads clearer: it points at the body line, names the two extractors that overlapped, and suggests how to resolve it (rephrase one token, accept the winner, or flip the tiebreak).
