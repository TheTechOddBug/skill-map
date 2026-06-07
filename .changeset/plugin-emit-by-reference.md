---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

View contributions are now emitted by object reference, not a string id: declare each as a const in the `ui` map and pass it to `ctx.emitContribution(ref, payload)`. The kernel recovers the id by object identity and rejects an undeclared ref with a loud `extension.error`. The payload is type-checked at author time via generated `SlotPayload<slot>` types (AJV still enforces it at runtime). The three list-payload fields were renamed: breakdown `bars`, key-values `pairs`, link-list `links`.
