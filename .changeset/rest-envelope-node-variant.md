---
'@skill-map/spec': minor
---

`rest-envelope.schema.json` could not validate what `GET /api/nodes/:pathB64` actually returns: the route ships `links` and `issues` as siblings of `item`, and `additionalProperties: false` rejected both. They are now declared and typed, required on the `node` variant and forbidden elsewhere, and that variant's `item` `$ref`s `node.schema.json` instead of passing as a bare object. `node.schema.json` gains the BFF decorations it always carried but never declared: `contributions`, `tags`, `body`.
