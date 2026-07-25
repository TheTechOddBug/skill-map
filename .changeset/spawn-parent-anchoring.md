---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

A spawn that names no parent is now anchored on the agent node its owner is known to be running, through a boot-scoped `owner -> agent node` index fed by agent claims and completed relations. OpenCode's `task` event reports only the spawning session, so every delegation hung off a synthetic session capsule while the real parent glowed elsewhere. The capsule stays the fallback for an owner running no scanned node.

## User-facing

Delegation arrows now start at the agent that actually delegated, instead of a generic "Session" bubble, on runtimes that do not name the parent.
