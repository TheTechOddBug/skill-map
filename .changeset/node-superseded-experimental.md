---
"@skill-map/cli": minor
---

The `core/node-superseded` analyzer (surfaces a node's `supersededBy` declaration as an `info` finding) is now `experimental`, joining the rest of the supersession family (`core/supersede`, `core/node-supersede`) which already shipped experimental. As an experimental extension it ships disabled by default, so the "node is superseded by X" finding no longer appears until the operator enables the family with `sm plugins enable core/node-superseded` (or the Settings toggle).

## User-facing

The supersession info finding ("this node is superseded by X") no longer shows by default: `core/node-superseded` is now experimental, so the whole supersession family (declare button + this finding) is off until you enable it in Settings or with `sm plugins enable`.
