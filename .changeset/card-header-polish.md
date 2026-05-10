---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Card body + topbar polish, plus catalog rename of the topbar scope slot.

**New extractor (`core/tools-count`)** — `src/built-in-plugins/extractors/tools-count/`. Reads `frontmatter.tools[]` on agent-kind nodes (Claude + Gemini share the field shape) and emits a `card.footer.left` counter chip with a wrench icon. Replaces the hardcoded wrench block previously rendered straight from `<sm-node-card>` (`toolsCount()` computed + `effectiveToolsCount` / `effectiveToolsBreakdown` helpers, all removed). `applicableKinds: ['agent']` gates the run at load time so skill / command / markdown nodes pay zero cost. Tooltip carries the joined tool names (capped at the 256-char slot limit).

**Provider kind visuals normalised** — `src/built-in-plugins/providers/gemini/index.ts` and `agent-skills/index.ts`. Every Provider that contributes `agent` / `skill` / `command` now declares the same label + color + icon as Claude. The declaration STAYS per-Provider (the shape allows divergence the day a Provider wants its own identity for a kind), but today the values mirror Claude so the visual vocabulary is uniform regardless of where a node was sourced from. `<sm-kind-icon>` gains an optional `provider` input that resolves the icon per-Provider when the call site supplies one (today a no-op, ready to diverge tomorrow).

**Slot catalog rename + relocate** — `topbar.actions.indicator` → `topbar.nav.start`. The slot moved from the topbar actions cluster (right side, between refresh / theme / settings) to the start of the topbar nav (left of the view-switcher links). The rename is a catalog-major-bump for any external plugin that emitted to the old name (pre-1.0 → ships as a `@skill-map/spec` minor per the versioning policy). Sweep covers `spec/schemas/view-slots.schema.json` (closed enum), `spec/view-slots.md`, `spec/architecture.md`, `spec/plugin-author-guide.md`, `src/kernel/types/view-catalog.ts`, `src/kernel/adapters/schema-validators.ts`, `src/built-in-plugins/analyzers/unknown-slot/index.ts`, `src/cli/commands/plugins.ts`, `ui/src/app/slots/slot-config.ts`, `ui/src/app/slots/slot-renderer-map.ts`, `ui/src/app/app.html`, `ui/src/app/renderers/scope-stat/scope-stat.ts`, `ui/src/app/debug-slots.css`, `context/view-slots.md`, `ROADMAP.md`. Spec integrity regenerated.

**View-contribution wrapper transparent to layout** — `ui/src/app/debug-slots.css`. `.sm-debug-slot` and `<sm-view-contributions-host>` are `display: contents` in production mode, so a slot that has no contributions takes zero space (no flex gap, no empty box). Debug mode flips both back to `inline-flex` for the visual ring + label.

**Provider chip in card subtitle** — `ui/src/services/provider-ui.ts` (new) + render in `<sm-node-card>`. Hardcoded chip carrying the provider's display label, color-coded per Provider so the platform a node came from reads at a glance. Unlike kind visuals (normalised), provider visuals are deliberately distinct. The `markdown` Provider is hidden (universal fallback — every generic `.md` lands there, painting the chip would be visual noise). Today the registry is a static UI-side map; promotes to a kernel-side `IProvider.ui` field the day a user-plugin Provider needs to declare its own chip.

**Path row in expanded card** — `ui/src/app/components/node-card/node-card.html`. Mono row at the top of `.sm-gnode__panel`, above the description and the LLM cluster. Subtle background, ellipsis on the leading segments (RTL trick) so the file name stays visible on long paths.

**Stat chip colors decoupled from `--sm-kind-*`** — `ui/src/styles.css` declares `--sm-stat-tokens-bg` / `--sm-stat-bytes-bg` / `--sm-stat-date-bg` (light + dark). Previously the chip backgrounds borrowed `--sm-kind-agent` / `--sm-kind-command` / `--sm-kind-skill`, which evaporate when their primary Provider plugin is disabled. Physical stats are plugin-independent — the new tokens keep the chips colored regardless of which plugins contribute kinds.

**Favorite star (was heart)** — every favorite affordance flips from `pi-heart` / `pi-heart-fill` to `pi-star` / `pi-star-fill`: `<sm-node-card>`, `<sm-inspector-view>`, `<app-kind-palette>` (favorites toggle), `<app-filter-bar>` (favorites toggle). Spec describes match updated.

**Author tag chips inherit the card's kind accent** — `node-card.css`. Outline color + text color come from `var(--accent)` (the kind's primary color, overridden per-Provider by `providerAccent`) instead of the theme's violet primary. Each card paints author tags in its own kind color.

## User-facing

Expanded node cards now show the file path above the description and a provider chip (Claude, Gemini, Open Skills). Favorite toggle uses a star instead of a heart.
