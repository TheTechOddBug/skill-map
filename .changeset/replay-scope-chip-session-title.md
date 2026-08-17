---
'@skill-map/cli': patch
---

The replay transport's scope chip now shows the session title (the touched-node names) instead of the short session id across the three Sessions-tab entry points (Play session, Play agent, step deep-link). The chip gained a full-label tooltip and a working ellipsis (as a non-shrinking flex item it used to overflow the fixed-width row), and the transport bar widened from 26rem to 30rem.

## User-facing

**Replay names the session.** The floating replay bar now labels a replay with the session's title, the same skill and agent names you see in the Sessions tab, instead of a short id. Long titles clip with an ellipsis and the full name shows in a tooltip.
