---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

The backtick-path grammar was the last holdout of a bug class already fixed on the `@`-token grammar: its relative prefix was capped at one level, so `../../ui/context/theme.md` matched at no start position and produced neither a link nor a `reference-broken` issue. Both grammars now pin the same prefix construct. The link-target probe also checks scan-root containment before it stats, refusing an escaping target unread; that rule moved to `kernel/util/path-containment.ts`, now shared.

## User-facing

**A path that walks up more than one folder is no longer ignored.** Write `../../ui/context/theme.md` in a skill or agent file and it now shows on the map as a link; if it points nowhere you get a broken-reference error instead of silence.
