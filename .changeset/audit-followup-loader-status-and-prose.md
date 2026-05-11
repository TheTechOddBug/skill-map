---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

Follow-up sweep on the cli-architect spec-drift audit. Three pieces:

- **5a — plugin loader status alignment.** The loader now returns `invalid-manifest` (not `load-error`) when the exported extension shape fails its kind-specific AJV schema. Aligns with `spec/architecture.md` §Plugin discovery: "AJV rejects unknown `slot` names with `invalid-manifest`". The module imported fine; only the declared shape is wrong, so `invalid-manifest` is the semantically correct status (`load-error` is for genuine module-load failures: import threw, timeout, unknown kind). Renames `PLUGIN_LOADER_TEXTS.loadErrorManifestInvalid` → `invalidManifestExtensionShape` to match. 4 tests updated.

- **7 — `emitScopeContribution` docs alignment.** Added a "pending, not yet implemented" status note to `spec/view-slots.md` and `spec/plugin-author-guide.md`. The two author-facing docs previously showed the callback as if it existed; `spec/architecture.md` already says it's "reserved, lands when the first scope-level adopter arrives". A plugin author who copies the example now sees the caveat upfront instead of hitting `TypeError: ctx.emitScopeContribution is not a function` at runtime.

- **P2 cosmetic prose sweep.** Slot-count references corrected ("15 slots" → "14" — the closed enum has 14 entries since the topbar scope-slot rename); `IViewContribution` field count corrected ("six fields" → "seven" — `priority?` was declared in the schema since the beginning but never documented in prose). Three spec docs swept; `spec/index.json` regenerated.

`catalogCompat` (5b in the audit) — schema field declared but loader check not implemented — is deferred until catalog v2 evolution demands it. No catalog evolution is pending pre-1.0, so the gap is acceptable; flagged in audit follow-ups, not in this changeset.
