# Spec versioning

The skill-map **spec** and the skill-map **reference CLI** evolve on independent semver tracks, related through a `specCompat` range declared by each implementation and each plugin.

## Two tracks

| Track | Example tag | Semver meaning |
|---|---|---|
| Spec | `spec-v1.2.0` | Schemas + contracts in `spec/`. Consumed by any implementation. |
| Reference CLI | `cli-v0.8.3` | The `sm` binary and its built-in extensions in `src/`. |

A CLI release declares the spec range it implements (e.g. `"specCompat": "^1.0.0"`); a plugin declares the spec range it targets. At load time the implementation runs `semver.satisfies(specVersion, plugin.specCompat)`; mismatch → plugin disabled with reason `incompatible-spec`.

## Semver for the spec

Patch, minor, major have precise meaning for a specification, distinct from code.

| Bump | Allowed changes | Examples |
|---|---|---|
| **Patch** (`1.0.0 → 1.0.1`) | Editorial only. No normative change. | Typo fixes, clarified wording, examples added, non-binding notes. |
| **Minor** (`1.0.0 → 1.1.0`) | Backward-compatible additions. Existing conforming implementations remain conforming. | New optional field, new optional schema, new optional CLI flag, new extension kind capability that is opt-in, a new conformance case (see §Conformance suite changes). |
| **Major** (`1.0.0 → 2.0.0`) | Any change that can break a conforming implementation. | Remove a field, rename a field, change a field's type, tighten an enum, make an optional field required, change an exit code's meaning, change an event's payload shape, change a verb's default behavior. |

Rule of thumb: if an implementation that satisfied the v1 CONTRACT would no longer satisfy it, the change is major.

The rule is deliberately about the contract, not about the conformance run. An earlier wording said "could fail a v1.X conformance run", which contradicted §Conformance below (failing a case is a bug report, not a spec violation) and, taken literally, would have made every new case a major bump, freezing the suite at whatever size it happened to have on the day v1 shipped.

### Conformance suite changes

The suite VERIFIES the contract; it does not define it. Bumps follow from that:

| Suite change | Bump | Why |
|---|---|---|
| Add a case for behaviour the contract ALREADY requires | **minor** | No new requirement. An implementation that fails it was already non-conforming; the case only made that measurable. |
| Add a case for a newly added optional feature | **minor** | The feature's own addition is what makes it minor; the case rides along. |
| Add an assertion type, or an optional field on an existing one | **minor** | A case that omits it behaves exactly as before. |
| Change a case to demand MORE than the contract states | governed by the CONTRACT change it implies | If the extra demand is legitimate, the contract text must change too, and that change sets the bump. A case cannot quietly raise the bar on its own. |
| Remove or weaken a case | **patch** | Nothing is required that was not required before. |
| Remove or change the meaning of an assertion type | **major** | Existing cases stop parsing or silently mean something else. |
| Change a fixture referenced by any case | **major** | Fixture bytes are inputs the case's expectations are computed against. |

## What counts as normative

All of the following are normative and governed by this policy:

- Every JSON Schema in `schemas/` (fields, types, required, enums, defaults, `additionalProperties`).
- Every MUST / SHOULD / MAY statement in **every prose document under `spec/`**, without exception. The rule is the document's location, not a list: any `.md` shipped inside `@skill-map/spec` (this file included, plus the ones under `conformance/` and `interfaces/`) is a normative contract, and a MUST written in one binds implementations exactly as a schema `required` does. Deliberately stated as a rule rather than an inventory: an enumeration silently drops whichever contract was written last, which is the failure mode this clause exists to prevent. Where a document defers to a schema in its own opening (as [`input-types.md`](./input-types.md) and [`view-slots.md`](./view-slots.md) do, "author-facing reference, the normative shape lives in the schema"), the schema wins on shape and the prose still binds on everything the schema cannot express. A `(Stability: experimental)` tag narrows what a change costs, per §Stability tags below; it never makes a MUST advisory.
- Exit codes, verb names, required flags, canonical error messages marked "normative".
- Conformance fixtures and cases. Changing a fixture referenced by any case is major (the bytes are the input a case computes its expectations against); what a case change costs is governed by §Conformance suite changes above, where removing or weakening a case is a patch and tightening one is governed by the contract change it implies.

The following are **non-normative** and can change at any time without a version bump:

- Editorial prose, examples, diagrams.
- README layout, cross-link structure.
- Filenames inside `../src/` (reference impl), never referenced from spec normatively.
- Internal commentary inside `../ROADMAP.md` and `../CLAUDE.md`.

## Stability tags

Fields and features carry a stability tag. The tag drives what the version policy allows.

| Tag | Meaning | Policy |
|---|---|---|
| `experimental` | Under design. May change without warning. | Minor and major bumps can change or remove. Plugins using an experimental field must tolerate breakage. |
| `stable` | Default. Governed by the semver rules above. | Changes follow the table at the top of this doc. |
| `deprecated` | Being removed in a future major. | Stays functional until the next major. `deprecated` notice must include the target removal version and a migration hint. |

Tags live inline in schema `description` fields and in prose via a leading `**Stability: experimental**` line.

## Deprecation window

- `stable` → `deprecated` requires a minor bump.
- `deprecated` → removed requires a major bump.
- Between the two, at least three minor releases must ship with the field marked `deprecated`, giving plugin authors a window to migrate.
- Rationale for the deprecation and the replacement field/flag must live in `CHANGELOG.md`.

## Pre-1.0

While a track (spec or reference CLI) is `0.Y.Z`, the semver roles shift one position down: `Y` carries the incompatibility signal that `major` carries post-1.0, and `Z` absorbs everything backward-compatible. This is the strict reading of SemVer's "major version zero" clause, adopted as policy, and it binds in both directions:

- **Minor (`0.Y.Z → 0.Y+1.0`) is reserved for incompatibility.** A minor bump MUST contain at least one change that would be major post-1.0 (something a conforming implementation, a plugin, or an operator has to adapt to). Each breaking change is documented as such in `CHANGELOG.md`.
- **Everything backward-compatible is a patch (`0.Y.Z → 0.Y.Z+1`)**: additive normative changes (new optional field, new optional schema, new verb or flag, new opt-in capability), fixes, and editorial work. A release made only of additions and fixes MUST NOT bump minor.
- **Never `1.0.0` as a side-effect.** The first `1.0.0` is a deliberate stabilization moment, not the mechanical consequence of a normal PR.

The payoff is that the version number alone is the compatibility signal: taking `0.Y.Z+1` is always safe; moving to `0.Y+1.0` means reading the changelog first. An earlier wording said minor bumps "may" contain breaking changes, which made the minor position meaningless as a signal (a consumer could not tell a risky minor from a routine one); the strict rule replaces it.

Also while pre-1.0:

- Conformance is advisory; failing a conformance case is a bug report, not a spec violation.
- `specCompat` in plugins should pin a minor range (`"^0.3.0"` means `>=0.3.0 <0.4.0`), not a major range: the minor position is the breaking boundary, so a minor pin pre-1.0 is exactly as safe as a `^1.x` major pin post-1.0.

The first stable commitment is `spec-v1.0.0`. In the current reference roadmap, that tag ships with `cli-v1.0.0`. Post-1.0 the standard roles resume: breaking is major, backward-compatible addition is minor, fix or editorial work is patch, per the tables above.

## Independence in practice

- **Spec `1.0.0` + CLI `0.1.0`**, spec stabilized before the CLI ships its v1. Normal during early life of the project.
- **Spec `1.2.0` + CLI `0.8.0`**, spec gained an optional feature the CLI hasn't implemented yet. Fine. Plugins needing it must declare `"specCompat": "^1.2.0"`.
- **Spec `2.0.0` + CLI `1.4.0`**, CLI still targets spec v1. Operator must upgrade CLI before installing v2-targeting plugins.

## Change process

1. PR proposes a spec change with rationale and classification (patch/minor/major).
2. If major, PR includes a migration note draft for [`CHANGELOG.md`](./CHANGELOG.md).
3. If the change affects reference-impl behavior, a companion PR in `src/` lands the implementation behind the bumped `specCompat`.
4. Merge order: spec change first, implementation second. An implementation MUST NOT ship a feature not yet in the spec (see [`../AGENTS.md`](../AGENTS.md): "Every feature: update spec/ first, then src/").
5. Tag spec release (`spec-vX.Y.Z`) independent from any CLI tag.

## Canonical URLs

Once the domain is live, schemas resolve at stable URLs:

```
https://skill-map.ai/spec/v1/node.schema.json
https://skill-map.ai/spec/v1.2/node.schema.json
```

The major version is always present in the path. Implementations MUST NOT rely on `latest`.
