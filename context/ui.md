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
- CTA buttons in `<sm-skipped-files-banner>` and `<sm-oversized-banner>` (token-aware paint, see below).

**Second exception, theme-token-aware CTAs**: the two scan banners (`skipped-files-banner`, `oversized-banner`) paint their CTA off `currentColor`, which inherits the banner's `--sm-severity-warn` foreground. That lets the matrix theme retint the button to its green accent automatically when it swaps the SM severity tokens. `<p-button>`'s secondary chrome tracks the PrimeNG palette, not the SM severity tokens, so wrapping these CTAs would break the matrix retint. The rationale is documented inline in each banner's `.css`. These stay plain `<button>` (real `type="button"` + `aria-label`, full focus ring), not for layout reasons but for token-coupling reasons.

Anywhere else, default to `<p-button>`. When in doubt, default to `<p-button>` and only fall back to plain `<button>` after measuring the layout cost.

## PrimeNG `::ng-deep` exceptions

PrimeNG internal class names (`.p-togglebutton-content`, `.p-datatable-tbody`, `.p-chip`, ...) are not part of any stability guarantee. The M1 audit (May 2026, primeng@21.1.6) swept `ui/` to migrate every `::ng-deep` block that targeted those internals; the taxonomy is kept in sync with the tree as components change. The classes:

1. **Class A**: migrated to `[pt]` pass-through (see "`[pt]` slot classes" below).
2. **Class B (host-merge contracts)**: project-owned class merged onto a PrimeNG host, kept as `::ng-deep` with the selector pointing at the merged host directly (see "Class B" table below).
3. **Class D (deep internals)**: `.p-*` internals or content-slot locks (no `pt`, no `dt`, no host-merge alternative), kept as `::ng-deep` and pinned to the verified PrimeNG version (see "Class D" table below).
4. **Class C**: investigated as `[dt]` candidates, none migrated. The four candidate blocks (chip background/color variants) used the broken descendant selector pattern `.chip--X .p-chip`, which PrimeNG 21 silently misses (host merge, see "Why descendant selectors are wrong" below). The fix is a Class B rewrite (`.chip--X`), not a `[dt]` migration: chip design tokens cover `background` / `color` / `borderRadius` / `paddingX/Y` but not `:hover`, `text-decoration`, `cursor`, or `transition`, all of which the migrated variants need.
5. **Dead code removed**: `.chip--dead .p-chip` and `.chip--dead-confirmed .p-chip` (inspector-view.css) had no template references and were deleted.

The Class B / Class D tables below identify each block by **file + selector**, not `file:line`: line numbers rot on unrelated edits (the original pinned numbers had all drifted by the time the inspector moved off `<p-card>`), so grep the selector to locate the rule. The inspector's `<p-card>`-based hero card and chips were retired when it moved to the `.sm-block` collapsible-section vocabulary (see "Non-PrimeNG `::ng-deep`" below), which is why no `p-card` rows remain.

All classes last verified against `primeng@21.1.9` (July 2026 re-sync; the original M1 sweep ran on 21.1.6). Re-verify on the next bump.

### Why descendant selectors are wrong on PrimeNG 21+ hosts

PrimeNG 21 components like `<p-chip>`, `<p-card>`, `<p-togglebutton>` merge `[styleClass]` onto the host element via `host.class = cn(cx('root'), styleClass)`. The chip rendered from `<p-chip styleClass="chip--link" />` is therefore `<p-chip class="p-chip chip--link">`, one element, not two. A descendant selector `.chip--link .p-chip` (with a space) looks for a `.p-chip` child of `.chip--link` and finds nothing, because the chip IS the merged host, not a child of it. The correct selector is `.chip--link` directly (or `.chip--link.p-chip` for compound specificity, but the variant class only ever lands on `<p-chip>` in this codebase, so the simpler form is enough). The descendant pattern is the silent-failure mode to watch for during PrimeNG upgrades, the styles do not render but no error is raised.

### `[pt]` slot classes (post-M1, not exceptions)

Five components route their `<p-togglebutton>` content styling through a `[pt]="{ content: { class: 'X__content' } }"` binding (the first three migrated off `.p-togglebutton-content` in M1; the two filter palettes were born on the pattern). The CSS rules still go through `::ng-deep` because PrimeNG generates the slot DOM outside Angular's view encapsulation (no `[_ngcontent-X]` attribute on the slot element), but they no longer depend on the internal `.p-togglebutton-content` class name, only on our own classes:

- `ui/src/app/components/kind-palette/kind-palette.css` — `.kind-palette__content` (plus a deep `> span` rule, see Class D below).
- `ui/src/app/components/perf-hud/perf-hud.css` — `.perf-hud__content`.
- `ui/src/app/components/event-log/event-log.css` — `.eventlog__handle-content`.
- `ui/src/app/components/severity-palette/severity-palette.css` — `.severity-palette__content`, plus the project-owned `.severity-palette__count` / `.severity-palette__glyph` children rendered inside the same slot (severity + pressed/hover tint rules ride the same `::ng-deep`-with-own-class shape).
- `ui/src/app/components/link-kind-palette/link-kind-palette.css` — `.link-kind-palette__content`, plus the `.link-kind-palette__glyph` per-link-kind tint rules riding the same slot.

A fourth consumer passes **attributes** rather than a class: `ui/src/app/views/files-view/files-view.ts` binds `[pt]` on its `<p-table>` to reach two PrimeNG-owned elements it cannot otherwise address. `virtualScroller.root` receives `data-testid="files-scroller"` (tests need the element that actually owns `scrollTop` / `clientHeight`, and targeting the internal `.p-virtualscroller` class would rot on a PrimeNG bump), `aria-label`, and `tabindex="-1"` for the focus rescue; `table` receives `aria-rowcount`, because under virtual scroll only the render window is in the DOM and assistive tech would otherwise announce ~45 rows instead of the corpus size. The binding is a `computed()` so the row count stays live, which also keeps it a stable reference between changes (the scroller's `options` / `pt` setters re-run on every identity change).

When `<p-togglebutton>` carries `[pTooltip]` on the same host (as in `kind-palette.html`), Angular strict template check picks `TooltipPassThroughOptions` (which only exposes `root` / `arrow` / `text`) over `ToggleButtonPassThroughOptions`, so the `[pt]` expression is cast with `$any({...})` to keep the togglebutton-shaped object. Reason: two directives on the same host both declare a `pt` input with different types, Angular merges the input declarations and picks the first match. Removing `[pTooltip]` would require restructuring the template (wrap in a div, lose the host-level tooltip behaviour), so the `$any` cast is the smaller cost.

### Class B, stable host-merge contract

Each selector ends at the merged host (a scope prefix before it is fine; one row targets the component's host tag itself). `::ng-deep` stays because the host element is rendered by PrimeNG outside Angular's view encapsulation; the targeted class lives in the host-merge contract documented in `host.class = cn(cx('root'), styleClass)` for the relevant component. The former `.ann-panel__chip--*` rows (annotations-panel + the inspector's padding override) were removed as dead code in the July 2026 re-sync: the annotations panel renders a `dt`/`dd` grid now, no chips, and the class had zero template references.

| File | Selector | PrimeNG component | Purpose |
|---|---|---|---|
| `ui/src/app/components/settings-modal/settings-modal.css` | `.settings-modal__dialog` | `<p-dialog>` | Dialog dimensions (1024 x 720 + viewport caps) via `[styleClass]` on the portal-rendered dialog root. |
| `ui/src/app/components/quick-start-modal/quick-start-modal.css` | `.quick-start-modal__dialog` | `<p-dialog>` | Same pattern, the Quick Start dialog's 760 x 720 sizing. |
| `ui/src/app/components/quick-start-modal/quick-start-modal.css` | `.quick-start-modal__panel p-message` | `<p-message>` | Block display + bottom margin on the message host tag itself (element selector, no internal class). |
| `ui/src/app/components/sidecar-consent-dialog/sidecar-consent-dialog.ts` (inline styles) | `.sidecar-consent__dialog` | `<p-dialog>` | Consent dialog sizing (32rem + 92vw cap) via `[styleClass]`, same pattern as the Settings / Quick Start dialogs. |
| `ui/src/app/components/link-kind-palette/link-kind-palette.css` | `.link-kind-palette__tooltip` | `<p-tooltip>` | Tooltip root width cap (26rem) via `[tooltipStyleClass]` on the portal-rendered tooltip; the text-node rule for the same tooltip is the Class D row below. |
| `ui/src/app/views/queue-view/queue-view.css` | `.queue__table` (two blocks) | `<p-table>` | Token-first cell-padding override (`--p-datatable-body-cell-padding`, both size variants, lands the uniform 2rem row) and the flex-column shell for the fixed-footer paginator. |
| `ui/src/app/views/queue-view/queue-view.css` | `.queue--rail .queue__table` | `<p-table>` | Rail mode: datatable surface tokens pinned to `--sm-bg-content`, row hover flattened. |
| `ui/src/app/views/files-view/files-view.css` | `.files--rail .files__table` | `<p-table>` | Rail mode: surface tokens pinned to `--sm-bg-content` (hover kept so selection still reads). |

### Class D, deep internals (accepted lock-in)

No `pt` section, no `dt` token, no host-merge alternative covers the case. Pin the PrimeNG version, monitor the changelog on every bump.

| File | Selector | PrimeNG component | Why no `pt`/`dt` |
|---|---|---|---|
| `ui/src/app/components/kind-palette/kind-palette.css` | `.kind-palette__content > span` | `<p-togglebutton>` content slot child | Layout for the count-bearing span inside the content slot. No `pt` key for "first child of content". Slot-shape lock, not internal-class lock. |
| `ui/src/app/components/settings-modal/settings-modal.css` | `.settings-modal__content` | `<p-dialog>` | Resets dialog content padding via `[contentStyleClass]` injection. `<p-dialog>` exposes no `pt.content` key for padding override in 21.1.6. |
| `ui/src/app/components/link-kind-palette/link-kind-palette.css` | `.link-kind-palette__tooltip .p-tooltip-text` | `<p-tooltip>` text node | Two-line tooltip (`pre-line` + centered). No `pt` key for the tooltip text node. |
| `ui/src/app/views/graph-view/graph-layout-toolbar/graph-layout-toolbar.css` | `.graph__layout-popover .p-popover-content` | `<p-popover>` content | Tightens the popover content padding to a 4px gutter. No `pt.content` key for popover. |
| `ui/src/app/views/files-view/files-view.css` | `.files__table .p-datatable-tbody td` | `<p-table>` body cell | Body-cell font-size + vertical-align, **plus the virtual-scroll row box** (`box-sizing`, `height: var(--files-row-h)`, `white-space: nowrap`). No `pt` key reaches the generated `<td>`. The height is load-bearing: PrimeNG's scroller is a fixed-item-size virtualizer, so a row of any other height desynchronises the spacer math. |
| `ui/src/app/views/files-view/files-view.css` | `.files__table.p-datatable-sm .p-datatable-tbody > tr > td` | `<p-table>` body cell | Vertical padding that lands the row on `--files-row-h`. The **compound** `.files__table.p-datatable-sm` is required, not redundant: Aura ships `.p-datatable.p-datatable-sm .p-datatable-tbody > tr > td` at specificity (0,3,2) and the plain single-class form above resolves to (0,3,1), so it would lose the tie and leave rows at the wrong height *silently*. |
| `ui/src/app/views/files-view/files-view.css` | `.files__table .p-datatable-tbody .files__row--folder > td` | `<p-table>` body cell | Folder-row tint MUST sit on the `<td>` to beat PrimeNG's per-cell striping background (a `<tr>` rule loses). |
| `ui/src/app/views/queue-view/queue-view.css` | `.queue__table .p-datatable-tbody td` | `<p-table>` body cell | Compact font, `vertical-align`, and the uniform 2rem row height. No `pt` key reaches the generated `<td>` (same lock as the files-view rows). |
| `ui/src/app/views/queue-view/queue-view.css` | `.queue__table .p-datatable-table-container` | `<p-table>` scroll container | Takes the flex slack so rows scroll inside it while the paginator pins at the bottom. |
| `ui/src/app/views/queue-view/queue-view.css` | `.queue__table .p-datatable-paginator-bottom` | `<p-table>` paginator wrapper | `flex: 0 0 auto`, the paginator never scrolls with the rows. |
| `ui/src/app/views/queue-view/queue-view.css` | `.queue__table .p-paginator` | `<p-paginator>` | Compact rail layout: space-between, hairline top border, content background. |
| `ui/src/app/views/queue-view/queue-view.css` | `.queue__table .p-paginator-current` | `<p-paginator>` page report | Muted `--sm-fs-xs` page report on the left. |
| `ui/src/app/views/queue-view/queue-view.css` | `.queue__row-action .p-button` | `<p-button>` | Caps the inline cancel / retry button at 1.6rem so it fits the 2rem row (same cap as the inspector's finding actions). |
| `ui/src/app/components/settings-modal/settings-modal.css` | `.settings-modal__dialog .p-autocomplete` / `.p-autocomplete-input-chip input` / `.p-autocomplete .p-chip` (one grouped block, 3 selectors) | `<p-autocomplete>` | Dense-modal font floor for the one family the token-first path cannot reach: the autocomplete consumes no sm font token (only its dropdown icon does) and its chip-mode input hardcodes `1rem` in the library CSS. Every other control in the dialog renders `size="small"` and rides the component-level sm token pins on `:host` (see §Type scale). |
| `ui/src/app/components/settings-modal/settings-modal.css` | `.settings-modal__dialog .p-dialog-footer` | `<p-dialog>` footer | Evens out Aura's asymmetric footer padding (`!important` beats the runtime-injected theme rule). |
| `ui/src/app/components/node-tags/node-tags.css` | `.node-tags__control .p-autocomplete` / `.p-autocomplete-input` (one block) | `<p-autocomplete>` | Inline tag editor pulled down to the `--sm-fs-xs` chip scale; the autocomplete exposes no sm font token and its chip-mode input hardcodes `1rem`. The editor's Save / Cancel buttons need no deep rule: a scoped `--p-button-sm-font-size` pin on `.node-tags__actions` covers them (see §Type scale). |
| `ui/src/app/components/quick-start-modal/quick-start-modal.css` | `.quick-start-modal__content` | `<p-dialog>` | `[contentStyleClass]` padding strip, mirror of the `.settings-modal__content` row above. |
| `ui/src/app/components/quick-start-modal/quick-start-row.css` | `.quick-start__row-actions--stacked .p-button` | `<p-button>` | Projected action buttons stretch to the stacked column width (projected content carries the host's encapsulation, so the reach still needs `::ng-deep`). |

## Debug overlays (kept dev tools, do NOT remove)

The SPA ships two opt-in debug overlays. Both are **deliberate, maintained dev tools**, not throwaway scaffolding, even where older inline comments said "temporary" / "Remove". Do not flag them for deletion in audits, and do not strip their mounts. Retire them only on an explicit decision, never as "cleanup".

- **Slot overlay** (`?debug=1`, or `localStorage` `sm-debug-slots`): `DebugSlotsService` toggles `html.is-debug-slots`; `ui/src/app/debug-slots.css` then paints a coloured ring + label (slot id only) around every `<sm-view-contributions-host>` so you can see where each view-contribution slot lands, plus a colour-rotated outline per contribution chip. Hovering a slot shows a native `title` tooltip listing every contribution dispatched there (qualified `plugin/extension/contribution` ids, full list incl. items past `maxItems`); it is built by the `debugTitle` computed in `view-contributions-host.ts` and bound via the host `[attr.title]`, so the chip-level labels no longer clutter busy slots. Gated, so production users never see it (the `title` attribute drops when debug is off). The five dedicated `inspector.surface.*` slots never mount a host; their consuming elements (header version/stability chips, tag row, summarize button, auto-tag sparkles) carry the same ring + label via the `DebugSurface` directive (`app/slots/debug-surface.directive.ts`), whose `title` names the claiming contribution's qualified id. The host's own production `:host { display: contents }` baseline lives in `view-contributions-host.ts` (load-bearing), not in `debug-slots.css`, so the overlay file carries only debug-mode rules.
- **Perf HUD** (`?debug-fps=1`, or `localStorage` `sm-debug-perf`): `DebugPerfService` gates `<sm-perf-hud>` in the graph view (visible / total / edge counts, layout timing).

The `graph.node.alert` (graph view) and `topbar.nav.start` (shell topbar) `<sm-view-contributions-host>` mounts are **real slot anchors**, not debug-only; they stay regardless of the overlay.

## External-link safety (`target="_blank"`)

Every `<a target="_blank">` rendered by the SPA MUST also carry `rel="noopener noreferrer"`:

- **`noopener`** severs the new window's reference back to `window.opener`. Without it the destination page can `opener.location = 'evil'` (reverse tabnabbing) inside the SPA's origin.
- **`noreferrer`** strips the `Referer` header so the destination cannot see which internal route the user came from.

The repo has no eslint config in `ui/` today, so the rule is enforced by a static check in the compile phase:

- `ui/scripts/check-external-links.mjs` (wired as `links:check`, first step of `ui`'s `validate:compile`) walks `ui/src/` and fails on the first `target="_blank"` whose enclosing tag lacks a `rel` with both tokens.
- It covers **both** `*.html` templates and `*.ts` sources, so inline templates, markup built in code, and string constants are all in scope. Specs (`*.spec.ts`, `*.spec.html`, `__tests__/`) are skipped: they assert against templates and legitimately carry literal matchers they never render.
- It reads bytes off disk rather than importing anything. That detour is the point: the previous incarnation was a vitest spec reaching templates through `import.meta.glob`, which could only ever see `.html`, because extending the glob to `*.ts` made Angular's CLI plugin double-process component sources and surface stale template-typecheck errors against the synthesised second copy. Inline templates were uncovered and the rule survived on review vigilance. If you find yourself fighting the build graph to run a static scan, that is the signal to move it out of the test runner, as the repo already does for `built-ins:check` / `view-catalog:check` / `pin:check`.
- The script guards itself: scanning fewer than 100 sources fails as a broken walk rather than passing as compliance.

Use `httpUrlOrNull` from `ui/src/services/url-guard.ts` whenever the URL bound into `[href]` comes from author-controlled content (markdown bodies, sidecar annotations, plugin payloads). Angular's `DomSanitizer` only blocks `javascript:`; the helper narrows the policy to `http:` / `https:` and rejects `data:` / `blob:` / `file:` / `vbscript:` / custom schemes that a stale extractor could otherwise smuggle into the DOM.

## No outbound requests from author-controlled content

Standing policy across every sink that renders scanned content (markdown bodies, frontmatter values, sidecar annotations, agent-written prompts, plugin payloads): **rendering someone else's repo must never make the browser phone home.** The realistic attacker in this product is the author of a cloned tree, and a request fired on render leaks the operator's IP and view timing back to them. Three enforcement points, all narrow allowlists rather than blocklists:

- **CSS contexts**: `cssColorOrNull` in `ui/src/services/css-guard.ts` accepts only a hex literal or a bare named colour, so `url(https://attacker/beacon)` and declaration breakouts never reach the CSSOM through `[style.*]` or a custom property.
- **URL contexts**: `httpUrlOrNull` (above) for anything bound into `[href]`.
- **Markdown**: `ui/src/services/markdown-renderer.ts` runs markdown-it with `html: true`, so **DOMPurify is the sanitization boundary, not a second opinion**, and its config is narrowed well past the library defaults. An `uponSanitizeElement` hook rewrites every image, whether it arrived as markdown syntax or as raw HTML, into a **click-to-load placeholder** naming the image and the HOST the request would go to, so the operator consents with the destination in view; the fetch happens only on click. Two shapes, selected by `currentImageMode`: `interactive` for block renders (`render` / `renderToHtml`), a `<button class="sm-md-img" data-sm-img-src="…">`; `static` for inline renders (`renderInline`), a bare `<span class="sm-md-img--static">` with no URL attribute, because the inline hosts (node cards, descriptions) already own click and drag. A `src` that fails `httpUrlOrNull` degrades to the static span in either mode. The click handler is the standalone `[smMarkdownImages]` directive (`ui/src/app/core/markdown-images.directive.ts`), applied to the BLOCK hosts only (inspector body, vendor initial prompt, conversation bubbles) because `[innerHTML]` output is inert; it re-validates the URL, then swaps in an `<img referrerpolicy="no-referrer">`. Stateless by design, a re-render restores the placeholder. Chip styling is global (`.sm-md-img*` in `ui/src/styles.css`, the markup carries no `_ngcontent` attribute).

  Three parts of that config are load-bearing and were each verified empirically against `dompurify@3.4.12`, not assumed:

  1. **`USE_PROFILES: { html: true }`** drops the SVG and MathML profiles DOMPurify allows by default. Without it `<svg><image href="…">` fetches on render exactly like an `<img>`.
  2. **`FORBID_TAGS: ['style', 'img', 'video', 'audio', 'source', 'input']`** covers every remaining element that fetches purely by being rendered (`video` / `audio` preload their `src`, `source` feeds them one, `input type="image"` has a fetching `src`). `img` is in the list as the BACKSTOP: the hook rewrites images before removal, so the ban catches only what the hook did not.
  3. **The anti-impersonation strip.** Raw HTML can copy the chip's class and its `data-sm-img-src`, displaying one host while loading another, which would turn the consent the chip asks for into a lie. The hook removes that attribute from every element it did not build itself, discriminating by object identity through a `WeakSet` (the one property markup cannot forge). A forged chip renders inert.

  `target` is also stripped from anchors, so an author-written `target="_blank"` cannot reverse-tabnab this origin (§External-link safety). Covered by the `audit L-1` block in `ui/src/services/__tests__/markdown-renderer.spec.ts` and `ui/src/app/core/__tests__/markdown-images.directive.spec.ts`.

When adding a new sink that renders scanned content, ask what it would fetch if the value were hostile; if the answer is anything, route it through a guard or drop the feature. **Before relaxing any parser or sanitizer flag, enumerate the fetch-on-render elements the change exposes and test them**; the `html: false` to `html: true` move looked like a one-line flag and actually opened four of them.

## Services layering (`ui/src/services/` vs `ui/src/app/services/`)

The workspace ships TWO `services/` folders. The split is intentional, do not collapse them:

- **`ui/src/services/`** , **domain / data-layer services**. Stateless wrappers over the BFF (`DATA_SOURCE` consumers, `WsEventStreamService`), in-memory stores keyed off the loaded model (`CollectionLoaderService`, `FilterStoreService`, `KindRegistryService`), and pure presentation helpers tied to data (`ProviderUiService`, `KindTintsService`, `ExtensionKindTintsService`, `MarkdownRenderer`, `ThemeService`). The `data-source/` sub-folder lives here for the same reason: the port + adapters belong in the domain layer. Tests under `ui/src/services/__tests__/`.
- **`ui/src/app/services/`** , **app-shell / UI orchestration services**. Coordinators that depend on domain services AND react to Angular router / DOM lifecycle (`ScanTriggerService`, `UpdateCheckService`, `ProjectInfoService`, `TitleStrategyService`, `ContributionsRegistryService`, `DebugPerfService`, `DebugSlotsService`, `FilterUrlSyncService`). These live next to `ui/src/app/components/` / `ui/src/app/views/` because their natural call-site is the chrome of the SPA, not a feature module's data flow.

**Decision rule when adding a service**:

1. Does it talk to the BFF / WS / model only, with no router or DOM dependency? → `ui/src/services/`.
2. Does it react to the router, manage page chrome (title, banners, toggles), or coordinate domain services for an app-level concern? → `ui/src/app/services/`.
3. Is it ambiguous? Prefer `ui/src/services/` (default) and document the placement in the file's top JSDoc. The next reviewer can move it if the contract drifts toward app-shell.

Text catalogs live in a single folder, `ui/src/i18n/`, one `*.texts.ts` file per consumer, named after it (e.g. `node-tags.texts.ts` for `<sm-node-tags>`). Do NOT co-locate a catalog next to its component, and do not introduce a second i18n root (`ui/src/app/i18n/`) without first hitting a real cross-cutting i18n pattern.

### Non-PrimeNG `::ng-deep` (out of M1 scope)

Several unrelated escape-hatches also live under `::ng-deep`, none targets a PrimeNG internal so none is part of the M1 sweep. Recorded here so future audits do not lump them in:

- **Foblex Flow internals** in `graph-view.css` (7 blocks: `.f-connection-drag-handle`, plus the spawn / spawn-active / invocation `.f-connection-path` treatments and their reduced-motion variants), intentional per the `foblex-flow` skill Rule 6, library elements styled in read-only graph contexts.
- **Rendered markdown DOM** injected via `[innerHTML]`, so component encapsulation does not reach it and child styles go through `::ng-deep`: `settings-changelog.css` (5 blocks under `.settings-changelog__highlight-body`), the full rendered node body in `inspector-view.css` (the `.inspector__body-rendered` family: heading ladder, lists, tables, blockquotes, code), the inline-markdown description fields in `inspector-view.css` (`.inspector__desc` `code` / `a`) and `node-card.css` (`.sm-gnode__desc` `code` / `a`), and the rendered author quote in `vendor-frontmatter.css` (`.vfm__quote` `> :first-child` / `> :last-child` / `code` / `a`). The description `a` rules also restore link affordance over the global `a` reset.
- **Shared `.sm-block` section vocabulary**: no longer a `::ng-deep` case. The `.sm-block*` family (rail, toggle row, chevron, dense `dt`/`dd` grid) was promoted from `inspector-view.css` to `ui/src/styles.css` as plain global rules when the inspector split made the vocabulary cross-component; the emitters (`<sm-collapsible-section>`, `<sm-vendor-frontmatter>`, `<sm-annotations-panel>`) now inherit the chrome wherever they mount. Recorded here so future audits do not re-file the global block as a `::ng-deep` candidate; the block comment in `styles.css` documents the `--accent` inheritance contract.
- **Custom-element children** in `kind-palette.css` (the `<sm-kind-icon>` tints and PrimeIcon `.pi` rules), styling a project-owned custom element from its parent, again outside Angular encapsulation.
- **Custom-child label suppression** in `node-tags.css` (1 block, `.node-tags__control ::ng-deep .itc__label`), hides the `<sm-input-type-control>` child's own "Tags" label inside the inline tag editor where it is redundant (the label survives as the autocomplete's `aria-label`). Project-owned class on a project-owned child component, never a PrimeNG internal.

## localStorage keys

Four naming families accumulated historically: dot-hierarchical `sm.*` (the majority), the older `skill-map.ui.*` (theme + inspector preferences), kebab `sm-debug-*` (debug overlays), plus casing outliers (`sm.demoBannerDismissed`). Do NOT migrate existing keys, orphaning a user's stored preferences is worse than the drift. The rule applies to **new keys only**:

- **Namespace**: `sm.<area>.<leaf>`, dot-hierarchical with kebab-case leaves. Real examples: `sm.graph.viewport`, `sm.workspace.rail-width`, `sm.settings.plugins.kind-filter`, `sm.live.follow-activity`.
- **Ownership**: reads and writes go through a `*.storage.ts` module next to the owning view / component (guarded reads, quota-safe writes, keys owned by the storage module) or through the owning service; do not inline raw `localStorage` calls in components.
- **Exceptions that stay**: the debug overlays keep `sm-debug-*` (kept dev tools) and the theme service keeps `skill-map.ui.theme` / `skill-map.ui.extra-theme` (persisted user preferences, see the no-migration rule above).

## Type scale (`--sm-fs-*`)

Every `font-size` in `ui/src` consumes a stop of the global type-scale ramp defined in `ui/src/styles.css` `:root` (July 2026 migration; it collapsed ~20 ad-hoc values that had accumulated in the 0.6-1.2rem band, plus the former per-view `--queue-fs-*` / `--files-fs-*` local ramps):

| Token | Value | Role |
|---|---|---|
| `--sm-fs-2xs` | 0.65rem | counts, micro-chips, minimap labels |
| `--sm-fs-xs` | 0.72rem | chip scale, dense metadata, rail tables |
| `--sm-fs-sm` | 0.8rem | dense modal controls, mono blocks, secondary body |
| `--sm-fs-md` | 0.875rem | base body text |
| `--sm-fs-lg` | 0.95rem | emphasized body, palette glyphs, sub-headings |
| `--sm-fs-xl` | 1.05rem | section headings, banner icons (compact) |
| `--sm-fs-2xl` | 1.15rem | page-level headings, banner icons (large) |

New CSS picks the nearest stop; do not introduce a new literal in the ramp's band. **Documented exemptions** (literals stay):

- **`em`-relative sizes** (the `0.85em` command / inline-code chips): proportional to the parent by design, never tokenized to rem.
- **Display band >= 1.25rem** (heroes, empty-state icons, the rendered-markdown `h1`/`h2` ladder): deliberate one-offs above the ramp.
- **The topbar chip cluster in `app.css`** (Beta / version / dev / lens / update chips): rem-exact conversions of the former px tuning (0.625 / 0.6875 / 0.75rem = 10 / 11 / 12px at the default root), deliberately OFF the ramp; collapsing them onto stops would flatten the tuned three-step chip hierarchy. Optical nudges (`translateY(1px)`) stay px. The cluster-relative companion glyph (`.shell__refresh i` at `1rem`, one clear step above the chips) rides the same exemption.
- **Debug overlays** (`debug-slots.css`, `perf-hud`): kept dev chrome, out of scope.

Inline `styles:` blocks in TS components (view-contribution renderers, capsule / dialog components) are migrated too; `grep -rn "font-size" ui/src --include="*.ts"` returning a literal in a `styles:` block is drift.

**PrimeNG density is token-first, at the COMPONENT token level.** To shrink small-size PrimeNG widgets inside a dense surface, pin the component sm tokens on the consuming host (`--p-button-sm-font-size`, `--p-inputtext-sm-font-size`, `--p-multiselect-sm-font-size`, `--p-message-text-font-size`, valued from `--sm-fs-*`), as the Settings / Quick Start dialogs and `node-tags` do. Do NOT scope the semantic `--p-form-field-sm-font-size`: the theme emits the component chains (`--p-button-sm-font-size: var(--p-form-field-sm-font-size)`) at `:root`, where custom properties substitute their `var()` refs, so a host-scoped semantic override never reaches the widgets (verified empirically on primeng 21.1.9). The token only applies to widgets actually rendering `size="small"` / `pSize="small"` (every form widget in the Settings / Quick Start dialogs does, including the theme select-button, the plugins filter chips, and the provider select, which gained the attr in the July 2026 pass). Internals with no font token at all (the autocomplete chip-mode input hardcodes `1rem`; paginator and datatable cells have no font tokens) keep their Class D deep rules. Two traps when flipping a widget to a size variant: the base `.p-togglebutton` hardcodes `font-size: 1rem` (tokens exist only on its sm/lg variants), and the variant reads DIFFERENT padding tokens (`--p-togglebutton-padding` is ignored by `.p-togglebutton-sm`, which reads `--p-togglebutton-sm-padding`; the plugins filter chips re-pin the sm name for exactly this reason).

## Themes

The UI ships **light** (default), **dark** (system pref or explicit), and four specialty themes registered in `EXTRA_THEMES`: **matrix**, **neon** (Neon B), **neon-green** (Neon G), and **neon-red** (Neon R). They live as **sibling files** under `ui/src/themes/` with the same shape, so another theme is one file plus one registry entry plus one `angular.json` line, plus its two brand assets (next paragraph).

**Brand assets per theme**: every extra theme ships a retinted **mark** (`ui/public/skill-map-mark-<id>.svg`, strokes in the theme's secondary tone, bottom node in the electric accent) and a matching **favicon** (`ui/public/favicon-<id>.svg`, declared via the registry's `favicon` field and swapped by a `ThemeService` effect; the default `favicon.svg` is self-adaptive via `prefers-color-scheme`). Mark selection is centralized in the `ThemeService.markSrc` computed (active extra -> its mark; otherwise light/dark by resolved mode), consumed by both the topbar and the Settings About tab, never duplicated per component. A new extra theme MUST bring both assets and keep the stroke-ramp recipe so the glyph reads as the same brand mark across themes.

### File layout

```
ui/src/
├── styles.css                   <-- cross-theme foundations (fonts, radii, violet ramp, resets, scrollbars, empty-state)
├── themes/
│   ├── light.css                <-- :root { --sm-bg-*, --sm-edge-*, --sm-link-*, --sm-severity-*, --sm-stat-*, --sm-hl-*, --sm-accent-fg, --sm-shadow-* }
│   ├── dark.css                 <-- .app-dark { same tokens, dark values }
│   ├── matrix.css               <-- :root.app-matrix + html.app-matrix .X (palette + per-element retints)
│   ├── neon.css                 <-- :root.app-neon + html.app-neon .X (Neon B; same shape as matrix)
│   ├── neon-green.css           <-- :root.app-neon-green + html.app-neon-green .X (Neon G)
│   ├── neon-red.css             <-- :root.app-neon-red + html.app-neon-red .X (Neon R)
│   ├── highlight.css            <-- theme-agnostic syntax-highlight, maps hljs-* to the active theme's --sm-hl-* tokens
│   └── registry.ts              <-- EXTRA_THEMES catalog consumed by ThemeService + Settings UI
```

**Authority**: opening `light.css`, `dark.css`, or any specialty theme reveals the **same sections in the same order** (`Surface palette` → `Text palette` → `Edge palette` → `Link badge palette` → `Severity, foreground` → `Severity, row tint` → `Physical-stat chip tints` → `Accent foreground` → `Elevation shadows`). Keep that symmetry when extending: a token added to one theme must land in the same section across every theme.

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
src/themes/matrix.css     <-- specialty themes, after dark so they beat the base palettes
src/themes/neon.css
src/themes/neon-green.css
src/themes/neon-red.css
src/themes/highlight.css  <-- theme-agnostic syntax-highlight, last
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
