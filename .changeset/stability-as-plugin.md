---
"@skill-map/cli": minor
---

Migrate the experimental / deprecated stability indicators on graph cards from hardcoded template markup into a new built-in extractor `core/stability` that emits chips to the `card.footer.right` slot. Remove the dead-code injection icon that shared the same wrapper.

**New built-in: `core/stability` (extractor, frontmatter-scope)**

- `src/built-in-plugins/extractors/stability/index.ts` — reads `sidecar.annotations.stability` first, falls back to legacy frontmatter `metadata.stability` (mirror of the UI's `effectiveStability` source order in `ui/src/models/node-derived.ts`).
- Declares two `viewContributions` against `card.footer.right`: `experimental` (icon `bolt`, label `experimental`, info-tone tooltip "Experimental — API may change") and `deprecated` (icon `ban`, label `deprecated`, warn severity, tooltip "Deprecated — avoid in new code"). Both `emitWhenEmpty: false`.
- Payload uses `value: 0` so the existing `NodeCounter` renderer paints them icon-only — same pattern `core/annotation-stale` introduced for the clock chip in commit `c43e499`.
- Registered in `src/built-in-plugins/built-ins.ts` between `slash` and `tools-count` (alphabetical within the `core` bundle). Built-in count assertions in `src/test/built-ins-modes.test.ts` (`25 → 26`) and `src/test/plugin-runtime-branches.test.ts` (`6 → 7`) updated.
- Spec catalog: `spec/architecture.md` enumerates the cross-vendor extractors — `stability` appended.

**Node card cleanup**

- `ui/src/app/components/node-card/node-card.html`: drop the `@if (stability() === 'experimental' || ... || hasInjection())` block, the `.sm-gnode__footer-end` wrapper, the inline experimental flask SVG, the `pi-ban` deprecated chip, and the inline shield-injection SVG. The `.sm-gnode__footer-right-cluster` now wraps the `card.footer.right` slot host alone. Stability chips render through the new extractor; `[class.sm-gnode--deprecated]` host binding still reads `effectiveStability(node)` directly so the deprecated card-fade survives.
- `ui/src/app/components/node-card/node-card.ts`: remove `hasInjection` / `injectionType` computeds and the `[class.sm-gnode--danger]` host binding (only consumer was the removed branch). The `stability` computed and the `effectiveStability` import stay — both still feed the deprecated host binding.
- `ui/src/app/components/node-card/node-card.css`: drop `.sm-gnode--danger`, `.sm-gnode__footer-end`, `.sm-gnode__stat--danger`, and the `<svg>`-specific rules (`.sm-gnode__stat svg { width: 1em; height: 1em }` and the `i, svg` font-size combo) — nothing in the card emits inline SVG anymore. Comment on `.sm-gnode__footer-right-cluster` rewritten for the slot-only layout.
- `ui/src/i18n/node-card.texts.ts`: drop `safety.injection(...)` (no consumer); `texts.stability.experimental` / `texts.stability.deprecated` stay because the inspector header (`inspector-view.html:74, 87`) still references them.

**Injection branch removed (was dead code)**

The injection icon was driven by `summary.safety.injectionDetected`, hardcoded to `false` in the stub summarizer at `ui/src/app/views/graph-view/graph-layout.ts:410` with an explicit "until the real Step 9+ summarizer lands" comment. The branch never rendered in this version; migrating it would have moved dead code from template to plugin. A real safety plugin can be built against `card.footer.right` (or `graph.node.alert`) once the Step 9+ summarizer is wired up with actual injection data.

**Test cleanup**

`ui/src/app/components/node-card/node-card.spec.ts`: drop the `describe('NodeCard — sidecar stale badge (Step 9.6.5)')` block. The stale badge moved to the slot system in commit `08c33b8` (`core/annotation-stale` emits an icon-only chip to `card.footer.right`); the spec was left behind asserting on hardcoded markup that no longer exists. Three positive tests were failing, three negative tests passed trivially against the missing element. Chip rendering is covered at the kernel layer (`src/built-in-plugins/analyzers/annotation-stale/annotation-stale.test.ts`).

**Renderer behaviour unchanged**

`NodeCounter` already supports icon-only chips through its `value > 0` guard — no template or style change to the renderer was needed. The `IconGlyph` resolver continues to accept emoji + PrimeIcons names only; no custom-SVG branch was introduced.

## User-facing

The experimental / deprecated indicators on graph cards now come from a built-in plugin (`core/stability`) you can disable. The injection indicator was removed — it never fired and will return when the safety summarizer ships.
