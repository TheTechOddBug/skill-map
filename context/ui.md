# UI (`ui/`) conventions

Annex of [`AGENTS.md`](../AGENTS.md). Read this file before editing anything under `ui/src/`.

## UI library reference (Foblex Flow)

The `ui/` workspace uses **Foblex Flow** (`@foblex/flow`) for the graph visualization layer. The library is poorly documented upstream, so the full operating guide (seven non-negotiable analyzers, antipattern checklist, canonical patterns, full API reference) lives in the project-local **`foblex-flow` skill** at `.claude/skills/foblex-flow/`.

Invoke it via `/foblex-flow`, or it auto-triggers when touching any graph-related Angular template, component, CSS, or `@foblex/flow` import. **Read the skill before touching any graph code.** The analyzers it encodes were all learned the hard way and skipping any produces silent failures.

## UI test IDs

Every interactive or test-targetable element in `ui/src/` carries a `data-testid` attribute. The codebase has no E2E tests today, but the IDs are placed proactively so future Playwright/Cypress/Vitest-Testing-Library flows land on stable selectors instead of CSS chains or i18n-fragile text.

**Naming convention**: `kebab-case`, shaped as `<area>-<element>` or `<area>-<element>-<modifier>`.

- Page sections: `workspace-view`, `files-view`, `graph-view`, `inspector-view`, `shell`, `shell-topbar`, `shell-nav`.
- Rail controls: `workspace-rail-toggle`, `workspace-search`, `files-depth-0`, `files-vis-leaf-<path>`.
- Action buttons: `action-<verb>` (`action-simulate-scan`, `action-theme-toggle`, `action-det`, `action-prob`).
- Toolbar buttons: `<view>-<verb>` (`graph-zoom-in`, `graph-fit-to-screen`, `graph-reset-layout`, `graph-theme-toggle`).
- Form controls: `filter-search`, `filter-kinds`, `filter-stabilities`, `filter-has-issues`, `filter-reset`.
- Empty / loading / error states: `<view>-empty-<reason>` / `<view>-loading` / `<view>-error` (`list-empty-filtered`, `list-empty-all`, `inspector-empty-no-selection`, `inspector-empty-not-found`, `graph-loading`, `graph-error`, `graph-empty`).
- Cards / panels: `<view>-card-<topic>` (`inspector-card-summary`, `inspector-card-agent`, …, `inspector-card-body`).

**Dynamic IDs** (per-row, per-node, per-kind): `[attr.data-testid]="'<prefix>-' + value"`. Examples in the codebase: `list-row-<path>`, `graph-node-<id>`, `kind-palette-<kind>`.

**PrimeNG components**: place `data-testid` directly on the `<p-button>` / `<p-togglebutton>` / `<p-multiselect>` / `<p-table>` host tag. Tests reach the inner `<button>` / `<input>` via descendant selectors. Keeping the testid on the host tag survives PrimeNG internal DOM changes.

**When to add**:

- Every new view's section root.
- Every new interactive element a test could plausibly target (button, link, input, toggle, row).
- Every distinguishable empty / loading / error state.
- Every card or panel that a test might assert "is shown" or read content from.

**When to skip**: purely decorative elements (icons, separators, swatches), text inside an already-targetable parent, and elements with no test value.

**Why testids and not CSS / text**: CSS-selector tests rot with every styling refactor (`.foo .bar > .baz:nth-child(2)`); text-based tests rot when copy changes (which happens routinely in i18n-bound UIs). `data-testid` is deliberately test-only, neither styling nor logic touches it, so it stays stable across both.

## Inline glyph buttons

Every interactive button in `ui/src/` MUST be a `<p-button>` so PrimeNG owns the focus ring, hover ramp, and severity palette in one place. **The exception**: plain `<button>` is accepted for tight inline glyph affordances where `p-button`'s wrapper padding distorts the surrounding layout (chevrons, favorite stars, close icons in cramped headers, sidebar nav items styled with `aria-current`). The cost of wedging a `p-button` into those slots (re-tuning the entire row's spacing, or `::ng-deep`-ing the wrapper's box-model) outweighs the consistency win.

Current acceptable locations (not exhaustive, but the pattern):

- Close button in `<sm-inspector-header>`.
- Favorite stars on `<sm-node-card>` and `<sm-inspector-header>`.
- Chevrons in `settings-plugins`, `node-card`, `vendor-frontmatter`, and the inspector's collapsible cards.
- Sidebar nav items in `<sm-settings-modal>` (styled with `aria-current="page"`).
- Debug toggle in `<sm-inspector-view>`.

Anywhere else, default to `<p-button>`. When in doubt, default to `<p-button>` and only fall back to plain `<button>` after measuring the layout cost.

## PrimeNG `::ng-deep` exceptions

PrimeNG internal class names (`.p-togglebutton-content`, `.p-datatable-tbody`, `.p-chip`, ...) are not part of any stability guarantee. The M1 audit (May 2026, primeng@21.1.6) swept `ui/` to migrate every `::ng-deep` block that targeted those internals; the taxonomy is kept in sync with the tree as components change. The classes:

1. **Class A**: migrated to `[pt]` pass-through (see "`[pt]` slot classes" below).
2. **Class B (host-merge contracts)**: project-owned class merged onto a PrimeNG host, kept as `::ng-deep` with the selector pointing at the merged host directly (see "Class B" table below).
3. **Class D (deep internals)**: `.p-*` internals or content-slot locks (no `pt`, no `dt`, no host-merge alternative), kept as `::ng-deep` and pinned to the verified PrimeNG version (see "Class D" table below).
4. **Class C**: investigated as `[dt]` candidates, none migrated. The four candidate blocks (chip background/color variants) used the broken descendant selector pattern `.chip--X .p-chip`, which PrimeNG 21 silently misses (host merge, see "Why descendant selectors are wrong" below). The fix is a Class B rewrite (`.chip--X`), not a `[dt]` migration: chip design tokens cover `background` / `color` / `borderRadius` / `paddingX/Y` but not `:hover`, `text-decoration`, `cursor`, or `transition`, all of which the migrated variants need.
5. **Dead code removed**: `.chip--dead .p-chip` and `.chip--dead-confirmed .p-chip` (inspector-view.css) had no template references and were deleted.

The Class B / Class D tables below identify each block by **file + selector**, not `file:line`: line numbers rot on unrelated edits (the original pinned numbers had all drifted by the time the inspector moved off `<p-card>`), so grep the selector to locate the rule. The inspector's `<p-card>`-based hero card and chips were retired when it moved to the `.sm-block` collapsible-section vocabulary (see "Non-PrimeNG `::ng-deep`" below), which is why no `p-card` rows remain.

All classes verified against `primeng@21.1.6`. Re-verify on the next major.

### Why descendant selectors are wrong on PrimeNG 21+ hosts

PrimeNG 21 components like `<p-chip>`, `<p-card>`, `<p-togglebutton>` merge `[styleClass]` onto the host element via `host.class = cn(cx('root'), styleClass)`. The chip rendered from `<p-chip styleClass="chip--link" />` is therefore `<p-chip class="p-chip chip--link">`, one element, not two. A descendant selector `.chip--link .p-chip` (with a space) looks for a `.p-chip` child of `.chip--link` and finds nothing, because the chip IS the merged host, not a child of it. The correct selector is `.chip--link` directly (or `.chip--link.p-chip` for compound specificity, but the variant class only ever lands on `<p-chip>` in this codebase, so the simpler form is enough). The descendant pattern is the silent-failure mode to watch for during PrimeNG upgrades, the styles do not render but no error is raised.

### `[pt]` slot classes (post-M1, not exceptions)

Three components migrated their `.p-togglebutton-content` overrides to a `[pt]="{ content: { class: 'X__content' } }"` binding. The CSS rule still goes through `::ng-deep` because PrimeNG generates the slot DOM outside Angular's view encapsulation (no `[_ngcontent-X]` attribute on the slot element), but the rule no longer depends on the internal `.p-togglebutton-content` class name, only on our own class:

- `ui/src/app/components/kind-palette/kind-palette.css` — `.kind-palette__content` (plus a deep `> span` rule, see Class D below).
- `ui/src/app/components/perf-hud/perf-hud.css` — `.perf-hud__content`.
- `ui/src/app/components/event-log/event-log.css` — `.eventlog__handle-content`.

When `<p-togglebutton>` carries `[pTooltip]` on the same host (as in `kind-palette.html`), Angular strict template check picks `TooltipPassThroughOptions` (which only exposes `root` / `arrow` / `text`) over `ToggleButtonPassThroughOptions`, so the `[pt]` expression is cast with `$any({...})` to keep the togglebutton-shaped object. Reason: two directives on the same host both declare a `pt` input with different types, Angular merges the input declarations and picks the first match. Removing `[pTooltip]` would require restructuring the template (wrap in a div, lose the host-level tooltip behaviour), so the `$any` cast is the smaller cost.

### Class B, stable host-merge contract

Each selector targets the merged host directly (no descendant step). `::ng-deep` stays because the host element is rendered by PrimeNG outside Angular's view encapsulation; the targeted class lives in the host-merge contract documented in `host.class = cn(cx('root'), styleClass)` for the relevant component.

| File | Selector | PrimeNG component | Purpose |
|---|---|---|---|
| `ui/src/app/components/annotations-panel/annotations-panel.css` | `.ann-panel__chip--user` | `<p-chip>` | Filled user tag chip. |
| `ui/src/app/components/annotations-panel/annotations-panel.css` | `.ann-panel__chip--user:hover` | `<p-chip>` | Hover state (filter brightness). |
| `ui/src/app/components/annotations-panel/annotations-panel.css` | `.ann-panel__chip--user:focus-visible` | `<p-chip>` | Focus ring. |
| `ui/src/app/components/annotations-panel/annotations-panel.css` | `.ann-panel__chip--active` | `<p-chip>` | Active tag overlay (solid primary). |
| `ui/src/app/views/inspector-view/inspector-view.css` | `.ann-panel__chip--user` | `<p-chip>` | Inspector-scoped padding override of the annotations chip (tighter rows next to the dense `dt`/`dd` grid). |

### Class D, deep internals (accepted lock-in)

No `pt` section, no `dt` token, no host-merge alternative covers the case. Pin the PrimeNG version, monitor the changelog on every bump.

| File | Selector | PrimeNG component | Why no `pt`/`dt` |
|---|---|---|---|
| `ui/src/app/components/kind-palette/kind-palette.css` | `.kind-palette__content > span` | `<p-togglebutton>` content slot child | Layout for the count-bearing span inside the content slot. No `pt` key for "first child of content". Slot-shape lock, not internal-class lock. |
| `ui/src/app/components/settings-modal/settings-modal.css` | `.settings-modal__content` | `<p-dialog>` | Resets dialog content padding via `[contentStyleClass]` injection. `<p-dialog>` exposes no `pt.content` key for padding override in 21.1.6. |
| `ui/src/app/components/link-kind-palette/link-kind-palette.css` | `.link-kind-palette__tooltip .p-tooltip-text` | `<p-tooltip>` text node | Two-line tooltip (`pre-line` + centered). No `pt` key for the tooltip text node. |
| `ui/src/app/views/graph-view/graph-layout-toolbar/graph-layout-toolbar.css` | `.graph__layout-popover .p-popover-content` | `<p-popover>` content | Tightens the popover content padding to a 4px gutter. No `pt.content` key for popover. |
| `ui/src/app/views/files-view/files-view.css` | `.files__table .p-datatable-tbody td` | `<p-table>` body cell | Body-cell font-size + vertical-align. No `pt` key reaches the generated `<td>`. |
| `ui/src/app/views/files-view/files-view.css` | `.files__table .p-datatable-tbody .files__row--folder > td` | `<p-table>` body cell | Folder-row tint MUST sit on the `<td>` to beat PrimeNG's per-cell striping background (a `<tr>` rule loses). |

## Debug overlays (kept dev tools, do NOT remove)

The SPA ships two opt-in debug overlays. Both are **deliberate, maintained dev tools**, not throwaway scaffolding, even where older inline comments said "temporary" / "Remove". Do not flag them for deletion in audits, and do not strip their mounts. Retire them only on an explicit decision, never as "cleanup".

- **Slot overlay** (`?debug-slots=1`, or `localStorage` `sm-debug-slots`): `DebugSlotsService` toggles `html.is-debug-slots`; `ui/src/app/debug-slots.css` then paints a coloured ring + label around every `<sm-view-contributions-host>` so you can see where each view-contribution slot lands. Gated, so production users never see it. The host's own production `:host { display: contents }` baseline lives in `view-contributions-host.ts` (load-bearing), not in `debug-slots.css`, so the overlay file carries only debug-mode rules.
- **Perf HUD** (`?debug-perf=1`, or `localStorage` `sm-debug-perf`): `DebugPerfService` gates `<sm-perf-hud>` in the graph view (visible / total / edge counts, layout timing).

The `graph.node.alert` (graph view) and `topbar.nav.start` (shell topbar) `<sm-view-contributions-host>` mounts are **real slot anchors**, not debug-only; they stay regardless of the overlay.

## External-link safety (`target="_blank"`)

Every `<a target="_blank">` rendered by the SPA MUST also carry `rel="noopener noreferrer"`:

- **`noopener`** severs the new window's reference back to `window.opener`. Without it the destination page can `opener.location = 'evil'` (reverse tabnabbing) inside the SPA's origin.
- **`noreferrer`** strips the `Referer` header so the destination cannot see which internal route the user came from.

The repo has no eslint config in `ui/` today, so the rule is enforced by a static test that runs in `pnpm --filter ui test`:

- `ui/src/__tests__/noopener-guard.spec.ts` walks every `*.html` template under `ui/src/` via `import.meta.glob('../**/*.html', { eager, query: '?raw' })` and fails on the first `target="_blank"` without a `rel` containing both tokens.
- The glob is restricted to `.html` because extending it to `*.ts` makes Angular's CLI plugin double-process component sources and surface stale template-typecheck errors. **Inline-template `.ts` components are NOT covered by the guard** (today only `app/components/settings-modal/settings-about.ts` declares a `target="_blank"` inside its `template:` string). When adding a new external link inside an inline template, either migrate the template to a sibling `.html` file or add a dedicated assertion alongside the component's own spec.

Use `httpUrlOrNull` from `ui/src/services/url-guard.ts` whenever the URL bound into `[href]` comes from author-controlled content (markdown bodies, sidecar annotations, plugin payloads). Angular's `DomSanitizer` only blocks `javascript:`; the helper narrows the policy to `http:` / `https:` and rejects `data:` / `blob:` / `file:` / `vbscript:` / custom schemes that a stale extractor could otherwise smuggle into the DOM.

## Services layering (`ui/src/services/` vs `ui/src/app/services/`)

The workspace ships TWO `services/` folders. The split is intentional, do not collapse them:

- **`ui/src/services/`** , **domain / data-layer services**. Stateless wrappers over the BFF (`DATA_SOURCE` consumers, `WsEventStreamService`), in-memory stores keyed off the loaded model (`CollectionLoaderService`, `FilterStoreService`, `KindRegistryService`), and pure presentation helpers tied to data (`ProviderUiService`, `KindTintsService`, `ExtensionKindTintsService`, `MarkdownRenderer`, `ThemeService`). The `data-source/` sub-folder lives here for the same reason: the port + adapters belong in the domain layer. Tests under `ui/src/services/__tests__/`.
- **`ui/src/app/services/`** , **app-shell / UI orchestration services**. Coordinators that depend on domain services AND react to Angular router / DOM lifecycle (`ScanTriggerService`, `UpdateCheckService`, `ProjectInfoService`, `TitleStrategyService`, `ContributionsRegistryService`, `DebugPerfService`, `DebugSlotsService`). These live next to `ui/src/app/components/` / `ui/src/app/views/` because their natural call-site is the chrome of the SPA, not a feature module's data flow.

**Decision rule when adding a service**:

1. Does it talk to the BFF / WS / model only, with no router or DOM dependency? → `ui/src/services/`.
2. Does it react to the router, manage page chrome (title, banners, toggles), or coordinate domain services for an app-level concern? → `ui/src/app/services/`.
3. Is it ambiguous? Prefer `ui/src/services/` (default) and document the placement in the file's top JSDoc. The next reviewer can move it if the contract drifts toward app-shell.

The same split applies to `ui/src/i18n/` (single folder, but every catalog file is sibling to its consumer's "natural" layer, no `ui/src/app/i18n/` exists yet, do not introduce one without first hitting a real cross-cutting i18n pattern).

### Non-PrimeNG `::ng-deep` (out of M1 scope)

Several unrelated escape-hatches also live under `::ng-deep`, none targets a PrimeNG internal so none is part of the M1 sweep. Recorded here so future audits do not lump them in:

- **Foblex Flow internals** in `graph-view.css` (2 blocks, `.f-connection-drag-handle` and `.f-conn--supersedes .f-connection-path`), intentional per the `foblex-flow` skill Rule 6, library elements styled in read-only graph contexts.
- **Rendered markdown DOM** injected via `[innerHTML]`, so component encapsulation does not reach it and child styles go through `::ng-deep`: `settings-changelog.css` (5 blocks under `.settings-changelog__highlight-body`), the inline-markdown description fields in `inspector-view.css` (`.inspector__desc` `code` / `a`) and `node-card.css` (`.sm-gnode__desc` `code` / `a`), and the rendered author quote in `vendor-frontmatter.css` (`.vfm__quote` `> :first-child` / `> :last-child` / `code` / `a`). The description `a` rules also restore link affordance over the global `a` reset.
- **Shared `.sm-block` section vocabulary**: `inspector-view.css` styles the `.sm-block*` family (rail, toggle row, chevron, dense `dt`/`dd` grid) via `::ng-deep` so the child components that emit that markup, `<sm-vendor-frontmatter>`, `<sm-annotations-panel>`, and `<sm-collapsible-section>` (the generic toggle row the inspector sections are built from), inherit the chrome without redeclaring it. Project-owned classes on project-owned child DOM, never a PrimeNG internal.
- **Custom-element children** in `kind-palette.css` (the `<sm-kind-icon>` tints and PrimeIcon `.pi` rules), styling a project-owned custom element from its parent, again outside Angular encapsulation.

## Themes

The UI ships three themes today: **light** (default), **dark** (system pref or explicit), and **matrix** (extra theme). They live as **sibling files** under `ui/src/themes/` with the same shape, so a fourth theme is one file plus one registry entry plus one `angular.json` line.

### File layout

```
ui/src/
├── styles.css                   <-- cross-theme foundations (fonts, radii, violet ramp, resets, scrollbars, empty-state)
├── themes/
│   ├── light.css                <-- :root { --sm-bg-*, --sm-edge-*, --sm-link-*, --sm-severity-*, --sm-stat-*, --sm-accent-fg, --sm-shadow-* }
│   ├── dark.css                 <-- .app-dark { same tokens, dark values }
│   ├── matrix.css               <-- :root.app-matrix + html.app-matrix .X (palette + per-element retints)
│   └── registry.ts              <-- EXTRA_THEMES catalog consumed by ThemeService + Settings UI
```

**Authority**: opening `light.css`, `dark.css`, or `matrix.css` reveals the **same sections in the same order** (`Surface palette` → `Edge palette` → `Link badge palette` → `Severity, foreground` → `Severity, row tint` → `Physical-stat chip tints` → `Accent foreground` → `Elevation shadows`). Keep that symmetry when extending: a token added to one theme must land in the same section across all three.

### Selector strategy

- **`light.css`**: bare `:root { ... }` (no class). Light is the implicit default so the first paint before Angular hydrates carries the right palette and there is no FOUC.
- **`dark.css`**: `.app-dark { ... }`. The `ThemeService` toggles `.app-dark` on `<html>` when the user picks `dark` or `auto` resolves to dark via `prefers-color-scheme`. PrimeNG's Aura preset reads the same class (`darkModeSelector: '.app-dark'` in `app.config.ts`).
- **`matrix.css`** and any future extra theme: `:root.<htmlClass> { ... }` for the palette (beats PrimeNG's runtime `:root,:host` injection) plus `html.<htmlClass> .<element> { ... }` for per-element retints (beats Angular's emulated-encapsulation rewrite of component CSS, which lands later in the source order).

### Bundle order (critical)

The cascade depends on the `styles` array order in `ui/angular.json`. The canonical order is:

```
node_modules/@foblex/flow/styles/default.scss
node_modules/primeicons/primeicons.css
node_modules/@fortawesome/fontawesome-free/css/all.min.css
src/styles.css            <-- cross-theme foundations
src/themes/light.css      <-- :root palette
src/themes/dark.css       <-- .app-dark overrides
src/themes/matrix.css     <-- specialty theme, last so it beats everything
```

Every new specialty theme appends **after** `dark.css` so the bare `:root` and `.app-dark` palettes resolve first, then the specialty class wins on activation.

### Adding a new specialty theme

Five touchpoints, all of them small:

1. **CSS file**: create `ui/src/themes/<id>.css`. Mirror `matrix.css` shape: a `:root.<htmlClass>` block defines the palette (override every token from `light.css` / `dark.css` you want different), then `html.<htmlClass> .<element>` blocks for per-element retints that tokens cannot reach. Open `matrix.css` and follow its section order; comment each block with the **why** (what visual story drives this override), not just the what.
2. **Bundle entry**: add `"src/themes/<id>.css"` to `ui/angular.json` `styles[]` after the existing themes.
3. **Registry entry**: add a `IExtraThemeDescriptor` to `EXTRA_THEMES` in `ui/src/themes/registry.ts`. Required fields: `id`, `htmlClass`, `forcesDark`, `label`, `description`. Optional: `favicon`, `fontHref` + `fontLinkId` (pair: declare both or neither, the service lazy-injects the stylesheet on first activation).
4. **Favicon (optional)**: drop `ui/public/favicon-<id>.svg` next to `favicon.svg`. The service swaps the SVG `<link rel="icon">` href while the theme is active.
5. **Smoke**: `pnpm --filter ui build && cd ui && npx ng test --watch=false`. No edits needed in `ThemeService`, `SettingsGeneral`, or `settings.texts.ts`, those consume the registry directly.

### When to add `:host-context(.app-dark)` per-component

The default is **token-driven**: components read `var(--sm-*)`, `var(--p-*)`, `var(--ff-*)` and the active theme's palette block resolves them. Per-component dark branching is reserved for cases the token system cannot express:

- The component reads a **runtime-injected variable** (e.g. `--kind-color`, `--provider-color-dark`, `--star-accent`, `--chip-accent`) whose `color-mix()` opacities legitimately differ between light and dark (lower alpha on light backgrounds, higher on dark for the same perceived contrast).
- The component owns a **one-off brand-adjacent hex literal** (alpha chip red, dev chip amber) that doesn't belong in the global palette and only varies for the dark surface.
- The component sets **local CSS variables** (e.g. `--shell-topbar-*`) that route through theme-specific stops of the global violet ramp.

If the override is a plain colour swap on a generic element and you can express it as "swap token X in dark", **promote the token to `themes/dark.css` and delete the local block**. Audit candidate: a `:host-context(.app-dark) .foo { background: var(--sm-y); }` block is almost always a token leak; the right fix is to add `--sm-y` to both `light.css` and `dark.css`.

### When `::ng-deep` is acceptable

Three contexts where the project accepts `::ng-deep`:

1. **PrimeNG host-merge contracts** (Class B) and **deep internals** (Class D), documented in the PrimeNG section above.
2. **`[pt]` slot classes**: when a child slot lands a custom class via `[pt]="{ content: { class: 'foo' } }"`, the slot DOM is outside Angular's view encapsulation and `::ng-deep` is the only path to the class. Targets the project-owned class, not the PrimeNG internal.
3. **Custom child components**: `<sm-kind-icon>` and similar wrap SVGs whose internal currentColor needs retinting from the parent. Per-kind colour assignments via `::ng-deep .sm-kind-icon` are the canonical pattern.

**Never acceptable**: `::ng-deep` to override a token that already exists in the theme palette (use the token), or to apply a one-off hex when the same effect resolves through `--sm-*` tokens.

### Smell signals to fix at the source

The `[no patch mindset]` rule in `AGENTS.md` applies hard here. Specifically for themes:

- **Hardcoded hex in a component** instead of `var(--sm-*)`: tokenize at the palette level. A new token in `light.css` + `dark.css` + (matching value in) `matrix.css` is cheaper than three components diverging.
- **Per-component font stack literal** (`font-family: ui-monospace, ...`): use `var(--sm-font-mono)`. The matrix theme overrides this token globally, so the component leak forced a matrix.css per-component override block. Wire through the token and the per-component matrix block disappears.
- **Duplicated hex literal across themes** (`#6b7280` repeated in light + dark + matrix): introduce a neutral token (e.g. `--sm-edge-neutral`) defined once per theme and consumed by `color-mix()` expressions everywhere else.
- **`:host-context(.app-dark)` that only swaps a colour**: promote to a token in `dark.css`. The audit pass that found 12 such blocks in this codebase determined all of them legitimately depend on runtime vars or one-off brand hex, so they stayed. New blocks should clear that bar before landing.

### Theme service contract (`ui/src/services/theme.ts`)

The service is **registry-driven**: it does not hardcode any theme id. Iterates `EXTRA_THEMES` on every effect tick:

- Toggles every registered `htmlClass` on `<html>` based on `extraTheme() === theme.id`.
- Computes `forcesDark`: if the active theme declares `forcesDark: true`, the `.app-dark` + `.dark` classes are forced regardless of the tri-state mode (so the specialty retint sits on a dark base).
- Calls `ensureExtraThemeFont(activeTheme)` to lazy-inject `fontHref` into `<head>` (no-op when the theme declares no font).
- Calls `applyFavicon(activeTheme?.favicon ?? FAVICON_DEFAULT)`.
- Persists `mode` to `localStorage['skill-map.ui.theme']` and the active extra-theme id to `localStorage['skill-map.ui.extra-theme']`. Unknown values in storage (e.g. a stale id from an older build) fall back to `null` via `findExtraTheme()`.

**Do not add theme-specific branches to the service.** Anything theme-specific (font, favicon, force-dark behaviour) goes in the descriptor.
