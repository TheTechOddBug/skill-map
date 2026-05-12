---
"@skill-map/cli": patch
---

M1 PrimeNG `::ng-deep` audit (verified against `primeng@21.1.6`). Two phases of work plus documentation, all internal to `ui/` (the workspace ships bundled inside `@skill-map/cli`).

**Phase 2, Class A pt-content migration (4 blocks).** Replaced `:host ::ng-deep .X .p-togglebutton-content { ... }` overrides in `kind-palette`, `perf-hud` and `event-log` with `[pt]="{ content: { class: 'X__content' } }"` bindings on the `<p-togglebutton>` instances and rewrote the rules against the new project-owned class. The rule still uses `::ng-deep` because PrimeNG generates the slot DOM outside Angular's view encapsulation, but it no longer depends on the internal `.p-togglebutton-content` class name. The kind-palette togglebutton carries `[pTooltip]` on the same host, which collides with `<p-togglebutton>`'s `pt` input (Tooltip directive declares a `pt` of a different shape, `TooltipPassThroughOptions` vs `ToggleButtonPassThroughOptions`), so the binding is cast inline with `$any({...})` and the reason is documented in `context/ui.md`.

**Phase 4, host-merge selector repair (5 blocks fixed, 2 deleted).** PrimeNG 21 merges `[styleClass]` onto the host element via `host.class = cn(cx('root'), styleClass)` for `<p-chip>`, `<p-card>`, `<p-togglebutton>` and friends, so the variant class lands on the same DOM node as `.p-chip` / `.p-card`. Five rules used the descendant pattern `.chip--X .p-chip` (or `.inspector__card--hero .p-card`) and matched nothing because the chip / card IS the merged host, not a child of it. Switched to direct selectors:

- `.chip--link`, `.chip--link:hover`, `.chip--warn` in `inspector-view.css`.
- `.chip--broken` in `annotations-panel.css`.
- `.chip--danger` in `vendor-frontmatter.css`.
- `.inspector__card--hero` in `inspector-view.css`.

Removed `.chip--dead .p-chip` and `.chip--dead-confirmed .p-chip` from `inspector-view.css`, the variant classes had no template references.

**Phase 3, documentation.** Added a "PrimeNG `::ng-deep` exceptions" section to `context/ui.md` that enumerates every remaining PrimeNG-targeted `::ng-deep` block: 12 Class B (stable host-merge contract, kept on purpose) and 4 Class D (deep internals like `.p-card-body` and `.p-dialog-content` with no `pt` / `dt` alternative in 21.1.6). The section also documents the descendant-selector failure mode so future PrimeNG upgrades catch the same pattern.

Validation: `npm run validate:compile -w ui` green, `npm run test:ci -w ui` 394/394 green.

## User-facing

Inspector chips and the hero card now render their variant styling (link, warn, broken, danger, hero accent border). They had silently been rendering as bare defaults since PrimeNG 21 changed how `[styleClass]` is applied to chip and card hosts.
