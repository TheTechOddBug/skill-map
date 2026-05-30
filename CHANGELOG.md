# Changelog

> Consolidated release history for skill-map, newest first. Each entry lists what shipped in the CLI (`@skill-map/cli`, the `sm` binary you install) and in the spec (`@skill-map/spec`). This file is generated at release time, do not hand-edit it.
>
> Per-package npm changelogs: [`src/CHANGELOG.md`](./src/CHANGELOG.md), [`spec/CHANGELOG.md`](./spec/CHANGELOG.md).
> Forward-looking plan: [`ROADMAP.md`](./ROADMAP.md).

<details open>
<summary><b>0.42.0</b> · 2026-05-28</summary>

### CLI Minor
- Registered Provider set is now the single source of truth for the UI provider surfaces (lens dropdown, topbar chip, per-node chip) and auto-detection; four divergent hardcoded provider lists removed.

### Spec Minor (0.39.0)
- Registered Provider set is now the single source of truth for the UI provider surfaces and active-lens auto-detection; the stale hardcoded provider lists are gone.

</details>

<details>
<summary><b>0.41.0</b> · 2026-05-27</summary>

### CLI Minor
- Hard cap on the number of files `sm scan` / `sm watch` accept after `.skillmapignore` filtering (default 256, override with `--max-nodes <N>`), plus a persistent UI banner past the limit.

### CLI Patch
- Fix `sm -version` / `sm -help` (and single-dash long-form typos) printing the no-project hint outside a project; the parser now surfaces the proper unknown-option diagnostic.
- Internal test coverage for the `--max-nodes` flag and the kind-palette inline search.

### Spec Minor (0.38.0)
- Hard cap on the number of files `sm scan` / `sm watch` accept after ignore filtering (default 256, `--max-nodes <N>` override), with a persistent over-limit UI banner.

</details>

<details>
<summary><b>0.40.1</b> · 2026-05-26</summary>

### CLI Patch
- UI polish across Settings, topbar, list / graph empty states, the Matrix theme, and the list-view column order (pure UI change, carried by the CLI bundle).

</details>

<details>
<summary><b>0.40.0</b> · 2026-05-26</summary>

### CLI Minor
- Decouple built-in extensions from per-extension semver; built-ins inherit the CLI version, stamped by the codegen instead of declared per manifest.
- Eliminate the bundle-level toggle; every plugin extension is now independently toggle-able by its qualified `<bundle>/<ext>` id.
- Aggregate severity counter for cards plus footer-right slot cleanups.
- List view as a first-class surface, with severity icons harmonised across graph and list.

### CLI Patch
- Settings → Changelog tab: cap the rendered list and add a permanent escape hatch to the full history.
- Suppress the per-extension version chip for built-in plugins in Settings → Plugins and `sm plugins show`; external plugins keep showing semver.
- Reserve the `graph.node.alert` slot for special-case signals and define the chip-vs-issue policy; routine findings ship as `card.footer.right` chips only.
- Three findings from a second `sm-tutorial` external-tester session.

### Spec Minor (0.37.0)
- Eliminate the bundle-level toggle; every plugin extension toggles independently by its qualified `<bundle>/<ext>` id.
- Built-in extensions decoupled from per-extension semver (inherit the CLI version, stamped by the codegen).
- Reserve the `graph.node.alert` slot for special-case signals and document the chip-vs-issue policy; routine findings ship as footer chips.
- Three findings from a second `sm-tutorial` external-tester session.

</details>

<details>
<summary><b>0.39.0</b> · 2026-05-25</summary>

### CLI Minor
- Rename `core/field-unknown` to `core/annotation-field-unknown` so it groups with the other sidecar annotation rules; behaviour unchanged.
- Rename 14 built-in extension ids to a consistent `<domain>-<detail>` pattern.
- Honour per-extension toggles inside bundle-granularity plugins end-to-end (flipping an individual extension off now persists and takes effect).

### CLI Patch
- Dev builds suppress the version chip in two decorative surfaces and show a lone `[dev]` marker instead.
- Restore the animated viewport fit on WS-scan topology changes and fix two reconcile correctness gaps it exposed.
- The CLI logger paints each line with the standard glyph + color per level, so warnings stand out from debug lines.
- Three quality-of-life fixes to the `sm serve` SPA plus a plugin-listing order tweak.
- Two bugs surfaced by the `sm-tutorial` external-tester walkthrough.

### Spec Minor (0.36.0)
- Rename `core/field-unknown` to `core/annotation-field-unknown` so it groups with the other sidecar annotation rules; behaviour unchanged.
- Rename 14 built-in extension ids to a consistent `<domain>-<detail>` pattern.
- Honour per-extension toggles inside bundle-granularity plugins end-to-end.

</details>

<details>
<summary><b>0.38.0</b> · 2026-05-24</summary>

### CLI Minor
- Internal: rename the registry's base extension shape from `Extension` to `IExtension` for uniform kernel type naming.

### CLI Patch
- cli-architect review pass on `src/`: mechanical hygiene fixes, no behavioural change.
- End-to-end `nodes[]` filter on the issues query, threaded from SQLite through the BFF route into the UI data-source contract.
- Security hardening pass on `src/` (audit findings H1, H2, M1, M2, L1).

</details>
