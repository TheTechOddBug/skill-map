---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

Reserve the `graph.node.alert` slot for special-case signals; disconnect every built-in core analyzer from it. Define the **chip-vs-issue policy** for plugin authors and align `reference-broken` to it. The corner badge on the NE tip of each graph card is no longer a generic "this node has a problem" surface. Routine findings (`reference-broken`, `annotation-field-unknown`, `schema-violation`) now ship only as `card.footer.right` chips, the slot's natural home for paired-icon-and-count signals.

**What changed**

- **Analyzer manifests + emit**: `reference-broken`, `annotation-field-unknown`, and `schema-violation` (under `src/plugins/core/analyzers/`) dropped their `alert` ui declaration and the matching `ctx.emitContribution(nodePath, 'alert', ...)` call. Each analyzer keeps its `card.footer.right` chip with the same tooltip + severity + count semantics. `schema-violation`'s severity-from-worst-finding logic stays (introduced in this same change set), now applied to the chip exclusively (`warn` for missing base fields, `danger` as soon as one schema check returns error).
- **Icon swaps**: `schema-violation` chip moved from `fa-solid fa-triangle-exclamation` to `fa-solid fa-circle-exclamation`. `reference-broken` chip moved from `fa-regular fa-circle-xmark` to `fa-solid fa-circle-xmark` (the outlined regular variant existed in FA Free for `circle-xmark` but the chip lost its alert sibling that motivated the visual contrast). Both choices documented inline next to the manifest entry: in FA Free `circle-exclamation` ships only in `solid` (`icons.yml`, `styles: [solid]`), so a `fa-regular` declaration would render as a missing-glyph tofu.
- **Slot kept in the catalog**: `graph.node.alert` stays in `view-slots.schema.json`, `kernel/types/view-catalog.ts`, `ui/src/app/slots/slot-config.ts`, and the renderer map. The mount in `graph-view.html` and the `NodeAlert` renderer are untouched. The slot is now reserved for genuinely independent signals (a future plugin that wants a corner decoration tied to a one-off condition); the slot-config comment documents the bar.
- **`sm plugins slots list` summary**: the `graph.node.alert` row in `src/cli/commands/plugins/slots-catalog.ts` now reads "Reserved corner badge ... special-case signals only" so plugin authors browsing the catalog see the policy without digging.
- **Drive-by, `sm init` warning formatting**: `activeProviderNoMarkerWarning` (under `src/core/runtime/i18n/scan-runner.texts.ts`) used to glue itself onto the next stderr line because the catalog string had no trailing newline and the message ran as a single sentence wall. Refactored to the §3.1b "glyph + dim hint" two-line block (mirrors the drift warn next door): yellow `⚠` headline + dim hint indented at column 3. `active-provider-bootstrap.ts` threads `opts.style.warnGlyph` + `opts.style.dim` through `tx(...)` like the drift path already did.

**Tests**

- Each affected analyzer's spec asserts `chip only, no alert` and lists the surviving slot via `deepStrictEqual(analyzer.ui, { chip: { slot: 'card.footer.right', ... } })`. Locks the new shape and fails fast if a future refactor re-wires the corner.
- `schema-violation.spec.ts` adds an "escalates severity to danger as soon as one finding is error-level" case that asserts the chip's severity follows the worst underlying finding.
- The existing `active-provider-bootstrap.spec.ts` test that regex-matched `/no provider markers detected/i` still passes against the new two-line block (the substring is preserved).
- `e2e/live-bff/` gains a `graph-node-alert.spec.ts` regression: with a fixture node carrying a broken `@mention` (would have triggered the `reference-broken` corner badge under the prior contract), the SPA must render zero `[data-testid="renderer-node-alert"]` elements while still surfacing the footer chip. The fixture (`e2e/live-bff/fixture.ts`) was extended with the broken-ref body line; the bump happy-path spec is unaffected (stale-badge state + version increment do not depend on link findings).

**`reference-broken` Issue severity raised from `warn` to `error`**

Per the chip-vs-issue policy below, a `danger` chip MUST be backed by an `error` Issue for the same node. `reference-broken` was emitting chip `danger` (red) + Issue `warn`, the only mismatch in the built-in catalog. Bumping the Issue aligns the visual signal with the exit code: any unresolved `@` / `/` link or markdown reference now escalates `sm scan` to exit 1 by default (was exit 0 with a yellow finding). CI pipelines that ran `sm scan` and treated exit 0 as "clean" will now see broken-ref runs fail, the operator was already seeing the red chip on the card; the change makes the exit code match.

`scan-readers.spec.ts` gains a `plantWarnOnlyFixture` helper (stale-sidecar based) for the "no error-severity → exit 0" contract tests that previously relied on `reference-broken` being a warn-level finding.

**Chip-vs-issue policy (new doc)**

Two new sections, one in `context/view-slots.md` ("Chip vs Issue, what counts and what only shows") and a shorter mirror in `spec/plugin-author-guide.md`, articulate the two-channel model:

- An `Issue` returned by `evaluate(ctx)` feeds the card's aggregated stats AND the scan / check exit code.
- A view contribution to `card.footer.right` is purely presentational, its `severity` controls only the chip's own colour.

The two channels are independent. The doc lists the 4 combinations (issue × chip) and codifies the colour rule: a chip MAY paint `warn` (yellow) or `danger` (red) only when the same analyzer emits a matching Issue at the same level. Decorative chips use `info`, `success`, or omit the severity field (neutral). Compliance audited across the built-in catalog: every analyzer now follows the rule.

**Drive-by, view-slots annex**

`context/view-slots.md` table row for `graph.node.alert` now flags the slot as Reserved with a pointer to the policy comment in `slot-config.ts`. The new chip-vs-issue section sits next to it as the cross-channel policy for the rest of the card surface.

`spec/index.json` regenerated for the prose addition (no schema changes, just the guide).

## User-facing

Graph cards drop the corner badge for routine warnings; count + tooltip stay on the footer chip. Broken refs now escalate `sm scan` to exit 1 (were exit 0). `sm init` prints the "no provider markers" advisory as a two-line yellow `⚠` block.
