---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

Honour per-extension toggles inside bundle-granularity plugins end-to-end. Closes the Phase 4b follow-up (commit `e45d2fd`) gap: BFF + Settings UI started accepting per-extension toggles for any granularity, but three call sites still treated bundle granularity as "one knob, every extension follows", so flipping an individual extension off (e.g. `claude/at-directive`) persisted to `config_plugins` and then did nothing on the next scan.

**Runtime (`src/`)**

- `core/runtime/plugin-runtime/resolver.ts`: `isBundleEntryEnabled` (built-ins) and `isPluginExtensionEnabled` (drop-ins) now compose the bundle id as a coarse kill-switch with the per-extension override layered on top. When the bundle row resolves to `false` every extension stays disabled regardless of per-extension overrides; when the bundle row resolves to `true` each extension respects its qualified-id override (default `true`). Doc rewritten, the stale "silently ignored, the granularity says this bundle is one knob" wording was the symptom that pointed at the bug.
- `cli/commands/plugins/shared.ts`: `extensionRowFromBuiltIn` (the row builder behind `sm plugins list / show / doctor`) now reports the same composed effective state instead of mirroring the bundle's `enabled` field verbatim.
- `core/runtime/__tests__/plugin-runtime-branches.spec.ts`: two new composer cases lock the contract, `(e)` `claude` enabled + `claude/at-directive=false` drops only the extractor, and `(f)` `claude=false` overrides any per-extension `true` override.

**UI (`ui/`)**

- `app/components/settings-modal/settings-plugins.utils.ts`: `buildStateFromPlugins` now seeds extension keys for both granularities (was: bundle-only seeded the bundle id and skipped the extensions, so the per-extension toggles in the Phase 4b modal defaulted to OFF in the buffer regardless of what the wire shape said about `ext.enabled`, then reverted to OFF on every apply round-trip).
- `models/api.ts`: `IPluginItemApi.extensions` doc updated, the comment still said "only when granularity === 'extension'" which the BFF stopped honouring in commit `e45d2fd`.
- `__tests__/settings-plugins.utils.spec.ts`: five new cases cover bundle+extensions, extension-only, bundle-disabled-with-ext-enabled, and failure-row exclusion.

**Spec (`spec/`)**

- `cli-contract.md`: `GET /api/plugins` row shape doc rewritten, `extensions[]` is emitted for any granularity; the per-extension `enabled` reflects the **preference** axis (DB > settings > default true) and the runtime composition with the bundle row is documented explicitly. `PATCH /api/plugins/:bundleId/extensions/:extensionId` now accepts any granularity and returns 404 (not 400) on an unknown extension id. The 400 `bad-query` enumeration in the error-codes section narrowed to the conditions that still apply.
- `plugin-author-guide.md` § Resolution order: rewritten to describe bundle-as-kill-switch + per-extension refinement explicitly, including the deliberate asymmetry between the CLI surface (`sm plugins enable/disable <bare-id>` stays coarse) and the UI / direct config-edit surface (qualified ids accepted, refine inside a bundle).
- `index.json` regenerated.

## User-facing

In Settings, expanding a bundle plugin (claude, antigravity, openai, agent-skills) now shows the correct per-extension state and the toggles persist, the next scan honours them. `sm plugins list` reflects effective state too.
