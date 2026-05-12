# UI (`ui/`) conventions

Annex of [`AGENTS.md`](../AGENTS.md). Read this file before editing anything under `ui/src/`.

## UI library reference (Foblex Flow)

The `ui/` workspace uses **Foblex Flow** (`@foblex/flow`) for the graph visualization layer. The library is poorly documented upstream, so the full operating guide (seven non-negotiable analyzers, antipattern checklist, canonical patterns, full API reference) lives in the project-local **`foblex-flow` skill** at `.claude/skills/foblex-flow/`.

Invoke it via `/foblex-flow`, or it auto-triggers when touching any graph-related Angular template, component, CSS, or `@foblex/flow` import. **Read the skill before touching any graph code.** The analyzers it encodes were all learned the hard way and skipping any produces silent failures.

## UI test IDs

Every interactive or test-targetable element in `ui/src/` carries a `data-testid` attribute. The codebase has no E2E tests today, but the IDs are placed proactively so future Playwright/Cypress/Vitest-Testing-Library flows land on stable selectors instead of CSS chains or i18n-fragile text.

**Naming convention**: `kebab-case`, shaped as `<area>-<element>` or `<area>-<element>-<modifier>`.

- Page sections: `list-view`, `graph-view`, `inspector-view`, `shell`, `shell-topbar`, `shell-nav`.
- Navigation: `nav-list`, `nav-graph`, `nav-inspector`, `inspector-back`.
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

PrimeNG internal class names (`.p-togglebutton-content`, `.p-card-body`, `.p-chip`, ...) are not part of any stability guarantee. The M1 audit (May 2026, primeng@21.1.6) swept `ui/` to migrate every `::ng-deep` block that targeted those internals. The outcome:

1. **Class A (4 blocks)**: migrated to `[pt]` pass-through (see "`[pt]` slot classes" below).
2. **Class B (12 blocks)**: stable host-merge contract, kept as `::ng-deep` with the selector pointing at the merged host directly (see "Class B" table below).
3. **Class D (4 blocks)**: deep internals (no `pt`, no `dt`, no host-merge alternative), kept as `::ng-deep` and pinned to the verified PrimeNG version (see "Class D" table below).
4. **Class C**: investigated as `[dt]` candidates, none migrated. The four candidate blocks (chip background/color variants) used the broken descendant selector pattern `.chip--X .p-chip`, which PrimeNG 21 silently misses (host merge, see "Why descendant selectors are wrong" below). The fix is a Class B rewrite (`.chip--X`), not a `[dt]` migration: chip design tokens cover `background` / `color` / `borderRadius` / `paddingX/Y` but not `:hover`, `text-decoration`, `cursor`, or `transition`, all of which the migrated variants need.
5. **Dead code removed**: `.chip--dead .p-chip` and `.chip--dead-confirmed .p-chip` (inspector-view.css) had no template references and were deleted.

All classes verified against `primeng@21.1.6`. Re-verify on the next major.

### Why descendant selectors are wrong on PrimeNG 21+ hosts

PrimeNG 21 components like `<p-chip>`, `<p-card>`, `<p-togglebutton>` merge `[styleClass]` onto the host element via `host.class = cn(cx('root'), styleClass)`. The chip rendered from `<p-chip styleClass="chip--link" />` is therefore `<p-chip class="p-chip chip--link">`, one element, not two. A descendant selector `.chip--link .p-chip` (with a space) looks for a `.p-chip` child of `.chip--link` and finds nothing, because the chip IS the merged host, not a child of it. The correct selector is `.chip--link` directly (or `.chip--link.p-chip` for compound specificity, but the variant class only ever lands on `<p-chip>` in this codebase, so the simpler form is enough). The descendant pattern is the silent-failure mode to watch for during PrimeNG upgrades, the styles do not render but no error is raised.

### `[pt]` slot classes (post-M1, not exceptions)

Three components migrated their `.p-togglebutton-content` overrides to a `[pt]="{ content: { class: 'X__content' } }"` binding. The CSS rule still goes through `::ng-deep` because PrimeNG generates the slot DOM outside Angular's view encapsulation (no `[_ngcontent-X]` attribute on the slot element), but the rule no longer depends on the internal `.p-togglebutton-content` class name, only on our own class:

- `ui/src/app/components/kind-palette/kind-palette.css` — `.kind-palette__content` (plus a deep `> span` rule, see Class D below).
- `ui/src/app/components/perf-hud/perf-hud.css` — `.perf-hud__content`.
- `ui/src/app/components/event-log/event-log.css` — `.eventlog__handle-content`.

When `<p-togglebutton>` carries `[pTooltip]` on the same host (as in `kind-palette.html`), Angular strict template check picks `TooltipPassThroughOptions` (which only exposes `root` / `arrow` / `text`) over `ToggleButtonPassThroughOptions`, so the `[pt]` expression is cast with `$any({...})` to keep the togglebutton-shaped object. Reason: two directives on the same host both declare a `pt` input with different types, Angular merges the input declarations and picks the first match. Removing `[pTooltip]` would require restructuring the template (wrap in a div, lose the host-level tooltip behaviour), so the `$any` cast is the smaller cost.

### Class B, stable host-merge contract (12 blocks)

Each selector targets the merged host directly (no descendant step). `::ng-deep` stays because the host element is rendered by PrimeNG outside Angular's view encapsulation; the targeted class lives in the host-merge contract documented in `host.class = cn(cx('root'), styleClass)` for the relevant component.

| File:line | Selector | PrimeNG component | Purpose |
|---|---|---|---|
| `ui/src/app/components/annotations-panel/annotations-panel.css:70` | `.chip--broken` | `<p-chip>` | Broken-ref chip styling (bg, muted color, line-through). |
| `ui/src/app/components/annotations-panel/annotations-panel.css:86` | `.ann-panel__chip--author` | `<p-chip>` | Outlined author tag chip. |
| `ui/src/app/components/annotations-panel/annotations-panel.css:92` | `.ann-panel__chip--user` | `<p-chip>` | Explicit filled user tag chip. |
| `ui/src/app/components/annotations-panel/annotations-panel.css:104` | `.ann-panel__chip--author, .ann-panel__chip--user` | `<p-chip>` | Interactive base styles (cursor, transition) shared across both variants. |
| `ui/src/app/components/annotations-panel/annotations-panel.css:109` | `...:hover` | `<p-chip>` | Hover state (filter brightness) on both variants. |
| `ui/src/app/components/annotations-panel/annotations-panel.css:113` | `...:focus-visible` | `<p-chip>` | Focus ring on both variants. |
| `ui/src/app/components/annotations-panel/annotations-panel.css:124` | `.ann-panel__chip--active` | `<p-chip>` | Active tag overlay (solid primary). |
| `ui/src/app/components/vendor-frontmatter/vendor-frontmatter.css:140` | `.chip--danger` | `<p-chip>` | Disallowed-tool danger chip (severity-error bg/color). |
| `ui/src/app/views/inspector-view/inspector-view.css:58` | `.inspector__card--hero` | `<p-card>` | Hero-card accent (primary border-left). |
| `ui/src/app/views/inspector-view/inspector-view.css:184` | `.chip--link` | `<p-chip>` | Linked-node chip (primary-50 bg, primary color, transition). |
| `ui/src/app/views/inspector-view/inspector-view.css:191` | `.chip--link:hover` | `<p-chip>` | Linked-node chip hover (primary-100 bg). |
| `ui/src/app/views/inspector-view/inspector-view.css:202` | `.chip--warn` | `<p-chip>` | Warn chip (command-bg / command-fg). |

### Class D, deep internals (accepted lock-in, 4 blocks)

No `pt` section, no `dt` token, no host-merge alternative covers the case. Pin the PrimeNG version, monitor the changelog on every bump.

| File:line | Selector | PrimeNG component | Why no `pt`/`dt` |
|---|---|---|---|
| `ui/src/app/components/kind-palette/kind-palette.css:65` | `.kind-palette__content > span` | `<p-togglebutton>` content slot child | Layout for the count-bearing span inside the content slot. No `pt` key for "first child of content". Slot-shape lock, not internal-class lock. |
| `ui/src/app/components/settings-modal/settings-modal.css:8` | `.settings-modal__content` | `<p-dialog>` | Resets dialog content padding via `[contentStyleClass]` injection. `<p-dialog>` exposes no `pt.content` key for padding override in 21.1.6. |
| `ui/src/app/views/inspector-view/inspector-view.css:366` | `.inspector__card .p-card-body` (scoped to embedded mode) | `<p-card>` | `<p-card>` exposes `pt.root` / `pt.header` but no `pt.body` in 21.1.6. Scoped to `:host(.inspector-view--embedded)` so standalone mode is unaffected. |
| `ui/src/app/views/inspector-view/inspector-view.css:369` | `.inspector__card .p-card-title` (scoped to embedded mode) | `<p-card>` | Same, no `pt.title` key. Embedded-mode scope keeps the blast radius small. |

### Non-PrimeNG `::ng-deep` (out of M1 scope)

Two unrelated escape-hatches also live under `::ng-deep`, neither targets a PrimeNG internal so neither is part of the M1 sweep. Recorded here so future audits do not lump them in:

- **Foblex Flow internals** in `graph-view.css` (2 blocks, `.f-connection-drag-handle` and `.f-conn--supersedes .f-connection-path`), intentional per the `foblex-flow` skill Rule 6, library elements styled in read-only graph contexts.
- **Rendered markdown DOM** in `settings-changelog.css` (5 blocks, `<p>` / `<code>` / `<a>` / `<strong>` under `.settings-changelog__highlight-body`), the markdown is injected via `[innerHTML]` so component encapsulation does not reach it.
- **Custom-element children** in `kind-palette.css` (the `<sm-kind-icon>` tints and PrimeIcon `.pi` rules), styling a project-owned custom element from its parent, again outside Angular encapsulation.
