---
'@skill-map/spec': major
---

`plugins-doctor.schema.json` gains the `recommended-action-missing` warning kind, which `action.schema.json` has always promised but the doctor schema's closed enum forbade. The `applicable-kind-unknown` member is renamed `precondition-kind-unknown`, matching the two prose contracts that already used that name and the `precondition.kind` field it reads; `applicableKinds` was retired with the structure-as-truth refactor.
