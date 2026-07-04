---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Live node activity now ends natively instead of by TTL decay: activity signals and the `node.activity` wire gain optional `ownerScope` (a terminal subagent stop releases every claim that owner holds) and `sticky` (lifecycle claims get a long safety-net window), the Claude adapter keeps a spawning parent lit via spawn custody handed to the child only while it still runs (`async_launched`), and `spec/provider-activity.md` is now published and hashed in the spec index.

## User-facing

**Map lights now follow your agents natively.** A node switches off the moment its agent actually finishes instead of fading on a timer, and an agent that delegates work stays lit until its whole delegation chain completes.
