---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Soft-warn drift detection for the active provider lens. When `activeProvider` is set (whether by auto-detect on first scan, the interactive prompt for ambiguous markers, or `sm config set activeProvider <id>`), the runtime now persists the set of provider markers that existed on disk at the moment of the choice as `activeProviderMarkers` in `.skill-map/settings.json`. On every subsequent scan the bootstrap re-detects markers and diffs against this snapshot; when the diff is non-empty (new markers appeared, recorded markers disappeared), it emits ONE soft warn before the scan and continues with the cached lens.

**Motivation.** Today `activeProvider` wins silently forever, even when the project grows a new provider directory (e.g. adds `.codex/` after the choice was made under `claude`) or loses one (`.cursor/` deleted in a cleanup). The operator should at least notice. The friction of a soft warn is right: it surfaces the drift, points at the fix (`sm config set activeProvider <id>`), and gets out of the way. The warn is informational and never blocks the scan.

**Spec.** `spec/schemas/project-config.schema.json` declares the new optional `activeProviderMarkers` string array as internal-state, NOT normally hand-edited. `spec/architecture.md` §"Active-lens drift detection" documents the snapshot + diff + soft-warn contract.

**Backfill.** Legacy projects (existing `activeProvider` without a snapshot) lazily backfill on the next scan: the runtime writes the current detected set as the snapshot and stays silent (there is nothing to compare against the first time), so the warn only fires when markers actually drift relative to a known-good snapshot.

**Atomicity.** The two writes (`activeProvider` + `activeProviderMarkers`) go through the same `writeConfigValue` helper as every other config mutation; each is atomic on its own, the pair is not transactional. A failure between the two writes leaves the file in the legacy "lens but no snapshot" shape, which the lazy backfill handles cleanly on the next scan.

**Tests.** `src/core/runtime/__tests__/active-provider-bootstrap-drift.spec.ts` covers snapshot persistence on auto-detect (single + ambiguous picks), drift detection from config (no-drift, added marker, removed marker, both-direction drift), legacy backfill, snapshot stickiness on repeat drift, and the `style.warnGlyph` / `style.dim` plumbing. `src/cli/commands/__tests__/config-cli.spec.ts` adds two cases for `sm config set activeProvider`: snapshot refresh on set, and full-set capture (not just the picked id).

Pre-1.0 minor per `spec/versioning.md`: additive optional field on the project-config schema (`@skill-map/spec`) plus an additive runtime behaviour on `@skill-map/cli`. No removed surface.

## User-facing

`sm scan` now warns once when provider markers on disk drifted since `activeProvider` was set (e.g. you added `.codex/` after picking the `claude` lens). Run `sm config set activeProvider <id>` to switch the lens, or ignore the warn and keep going, it never blocks the scan.
