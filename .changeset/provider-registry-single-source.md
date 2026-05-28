---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Makes the registered Provider set the single source of truth for the UI's provider surfaces (active-lens dropdown, topbar lens chip, per-node provider chip) and for active-lens auto-detection. Removes four divergent hardcoded provider lists that no longer matched the real built-in Providers (the lens dropdown offered phantom `gemini` / `cursor` entries and hid the real `antigravity` / `agent-skills`; the card chip did not know `openai` / `antigravity`; the detection table still listed `cursor`).

**Spec (`spec/schemas/extensions/provider.schema.json`)**: Providers gain a required `presentation` block (`label`, `color`, optional `colorDark` / `icon` / `emoji` / `hideChip`) describing the Provider's own identity, and an optional `detect.markers` array. Named `presentation` (not `ui`) because the shared extension `ui` key is the view-contributions map. Pre-1.0 breaking change for external Provider plugins: a manifest without `presentation` is rejected at load with a clear `must have required property 'presentation'` diagnostic (locked by the `plugin-missing-ui-rejected` conformance case).

**Spec (`spec/schemas/api/rest-envelope.schema.json`)**: new required `providerRegistry` field on every payload-bearing envelope (list / single / config), sibling of `kindRegistry`. Keyed by Provider id. Sentinel / action-result / catalog envelopes stay exempt.

**Kernel (`src/kernel/extensions/provider.ts`)**: `IProvider` gains `presentation: IProviderUi` and `detect?: { markers }`. The five built-in Providers declare both (`claude` → `.claude`, `openai` → `.codex` / `AGENTS.md`, `agent-skills` → `.agents`; `antigravity` / `markdown` carry no marker; `markdown` sets `hideChip`).

**Detection (`src/core/config/active-provider.ts`)**: the hardcoded `DETECTION_RULES` table is gone; `resolveActiveProvider` now reads markers off the provider list threaded by each caller (orchestrator, scan-runner bootstrap, BFF route, `sm config`). The detectable set derives from the registered Providers, so a Provider with a marker is auto-detectable without touching the resolver.

**BFF (`src/server/provider-registry.ts`, `envelope.ts`, `index.ts`, routes)**: new `buildProviderRegistry(providers)` assembles the catalog at boot (same discipline as `buildKindRegistry`); every payload-bearing route embeds it. The raw provider list is threaded to `/api/active-provider` for marker-based detection (the wire registry omits markers).

**SPA (`ui/src/services/provider-registry.ts`)**: new `ProviderRegistryService` (signal-backed) ingested by the REST + static data sources, replacing the static `provider-ui.ts` dictionary. The lens dropdown options, the topbar lens chip, and the per-node card chip all read from it. The demo dataset generator bakes a parallel `DEMO_PROVIDER_REGISTRY`.

**Tests**: `provider-registry.spec.ts` (kernel-side build + SPA service), updated active-provider bootstrap/drift specs to pass provider markers, updated data-source specs for the new constructor arg.

## User-facing

The lens picker in **Settings → Project** now lists exactly the providers installed in your project. The phantom **Gemini** and **Cursor** options are gone, and **OpenAI Codex** / **Antigravity** now show their correct name and colour on node cards.
