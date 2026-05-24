---
'@skill-map/cli': patch
---

Three quality-of-life fixes to the `sm serve` SPA + a small CLI / BFF listing tweak that keeps the user-visible plugin order coherent across surfaces.

**WebSocket resilience** (`ui/src/services/ws-event-stream.ts`)

- `NORMAL_CLOSE_CODES` shrinks from `{ 1000, 1001 }` to `{ 1000 }`. Code 1001 ('going away') is what `sm serve` emits on every shutdown — restart, hot-reload, container replacement, dev-loop save-and-rerun — and the SPA can't distinguish those from a deliberate stop. The previous behaviour required a manual page refresh after every server tick; the new behaviour rides the existing exponential backoff (1s → 30s, capped at 10 attempts) so a restart reattaches the SPA automatically. A server that stays down still surfaces the same lost-connection error after the cap, just at the boundary the user actually needs it.
- Spec updated: `does NOT reconnect on a server-shutdown close (code 1001)` is now `reconnects on a server-shutdown close (code 1001) so a sm serve restart reattaches`.

**Topbar project path** (`ui/src/app/app.{css,html}`)

- The project path under the brand mark used to disappear below 1280px (`@media (max-width: 1280px) { .shell__tag { display: none; } }`). It now stays visible at every supported viewport width, truncating with an ellipsis when it doesn't fit.
- The ellipsis lands on the LEFT (via `direction: rtl` on the host + `<bdi dir="ltr">` on the content): a filesystem path's identity lives in its tail (`…/projects/skill-map`), the head (`/home/<user>/…`) is mostly redundant.
- `max-width` widened to 40rem (desktop) / 26rem (≤1280px). The `title` attribute exposes the canonical string on hover for the truncated case.

**Plugins list ordering** (`src/cli/commands/plugins/shared.ts`, `src/server/routes/plugins.ts`, `ui/src/app/components/settings-modal/settings-plugins.utils.ts`, `src/plugins/presentation-order.ts` new)

- `sm plugins list / show / doctor`, `GET /api/plugins`, and Settings → Plugins all pin `core` first, then the vendor bundles (`claude`, `antigravity`, `openai`, `agent-skills`). The runtime `builtInBundles` array keeps `core` LAST so `core/markdown` stays the terminal universal-fallback provider per `spec/architecture.md` §"core/markdown is the universal fallback"; the presentation order inverts that for the surface humans read. The two orderings live side-by-side in `src/plugins/presentation-order.ts` (the runtime array can't host the helper because `src/plugins/built-ins.ts` is auto-generated) and the SPA mirrors the list verbatim in `PINNED_BUNDLE_ORDER`.
- Drive-by: `PINNED_BUNDLE_ORDER` cleaned of the stale `gemini` entry (replaced upstream by `antigravity`) and gained `openai`.

## User-facing

Plugins always list `core` first across CLI, BFF, and Settings; the project path stays visible in the topbar (truncated with `…` on the LEFT so the project name reaches the eye); and the SPA reconnects on its own when `sm serve` restarts.
