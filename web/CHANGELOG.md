# @skill-map/web

## 0.1.4

### Patch Changes

- e9a4933: Rebrand the topbar / nav stamp from "Beta" to "Alpha" across `web/` (landing nav chip, light-theme CSS rule) and add a new bilingual entry to the deferred-roadmap copy in `web/app.js` describing the future "Live agent conversation view" — streaming the LLM job transcript turn-by-turn into the UI Job inspector with a CLI mirror via `sm job tail --conversation`.

  Companion UI changes (`ui/src/`, bundled inside `@skill-map/cli`, no separate bump): same Beta→Alpha rename in the SPA topbar + update-check chip copy + matching e2e spec; mass-migrate every remaining PrimeIcons reference (`pi pi-*`) to Font Awesome (`fa-solid`/`fa-regular`) so the icon family is consistent with the recently-added FA webfont; restructure Foblex Flow nodes so `fNodeInput` / `fNodeOutput` sit as directives on the `[fNode]` host itself (UML-example pattern) instead of separate child DIVs — this removes the connector "ball" Foblex paints by default with no `::ng-deep` or token overrides needed, and drops the three socket-color tokens + position math the old layout required; Settings → Plugins now hides host-locked rows entirely (the toggle cannot move and a "Locked" tag adds noise on always-on extensions; lock enforcement in kernel/BFF/CLI is unchanged) and fixes the kind filter to match bundle-granularity rows against the aggregated `kinds` field so the three vendor provider bundles (`claude`, `gemini`, `agent-skills`) stay visible under the "Provider" filter; rebind PrimeNG `button-text-secondary-*` tokens at `.shell__actions` so the theme + settings buttons pick up the muted topbar palette.

## 0.1.3

### Patch Changes

- 4a2d36a: Public site copy refresh to match the new tagline shipped in the CLI/README this cycle. `meta.title`, `og:image:alt`, `twitter:title`, `twitter:image:alt`, the `<title>` element, and the `foot.tagline` slot all switch from "graph explorer for AI agent skill ecosystems" / "explorador de grafos…" to "The missing map for generative-AI ecosystems" / "El mapa que le faltaba a tu ecosistema de IA generativa". Also renames the graph legend `note` row to `markdown` (key `graph.legend.note` → `graph.legend.markdown`, both in `web/index.html` and `web/i18n.json`) so the legend reflects the 0.18.0 `core/markdown` Provider rename, and updates the Provider section example list and the "For authors" case copy to talk about "markdown" instead of "note" when describing file kinds. ES copy continues to use neutral Spanish (no rioplatense voseo) per the public-site convention.

## 0.1.2

### Patch Changes

- c29a780: Add `title` tooltips to the three version tags in the landing footer (`cli`, `spec`, `web`) so hovering reveals what each version refers to: the latest `@skill-map/cli` published on npm, the `@skill-map/spec` version served at `/spec/v0/`, and the `@skill-map/web` version of the site itself.

## 0.1.1

### Patch Changes

- 508c96a: Two coordinated landings on the landing footer plus a whitespace cleanup:

  1. **`web/app.js`** — fix the runtime CLI version fetch. The `/latest` endpoint at `https://registry.npmjs.org/@skill-map/cli/latest` is unreliable for scoped packages — the request fired but the footer tag stayed at the `cli v—` placeholder. Switched to the package metadata endpoint (`https://registry.npmjs.org/@skill-map/cli`) and read `dist-tags.latest`. Added three diagnostic `console.warn` lines so a future failure surfaces the cause (registry status, missing dist-tags, fetch exception) instead of failing silently.
  2. **`web/index.html`** — reorder the three footer version tags from `spec → web → cli` to `cli → spec → web`. The CLI is the primary product surface, spec is the contract behind it, web is metadata about the site itself.

  The `@skill-map/cli` `patch` bump covers a whitespace-only cleanup in `src/kernel/index.ts` (one redundant blank line removed between the `Kernel` interface and the `createKernel()` factory). No runtime behavior change; bumped per the workspace-touch changeset policy.

## 0.1.0

### Minor Changes

- Initial versioned release. The public site (`skill-map.dev`) gets its own
  version separate from `@skill-map/spec` and `@skill-map/cli`, surfaced in
  the landing footer and used as the deploy tag in Railway. Private
  workspace — never publishes to npm.
