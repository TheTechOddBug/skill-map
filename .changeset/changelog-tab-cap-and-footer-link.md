---
'@skill-map/cli': patch
---

Settings → Changelog tab: cap the rendered list and add a permanent escape hatch to the full history.

**What changed**

- **Prune of `ui/src/data/user-changelog.json`**: stripped legacy entries (everything `≤ 0.35.0`) plus a phantom `0.26.2` that was real-`0.27.0` content mislabeled and the matching gaps around `0.27.0` / `0.26.1` / `0.20.1`. The file went from 30 entries down to 4 (`0.39.0`, `0.38.0`, `0.37.0`, `0.36.0`). The trimmed history is already covered authoritatively by `src/CHANGELOG.md`, so the in-app changelog stays focused on the recent releases. One-time cleanup; new releases land via the normal `release:version` flow that runs `scripts/build-user-changelog.js`.
- **Forward-looking cap in `ui/src/app/components/settings-modal/settings-changelog.ts`**: new `MAX_VISIBLE_RELEASES = 10` constant; `renderAll()` slices `USER_CHANGELOG.entries` before iterating. Today the tab shows 4 entries (everything in the pruned file); tomorrow the cap kicks in at 10 so the tab does not grow unbounded as releases accumulate.
- **Footer block in `settings-changelog.html` + `.css`**: always-rendered `<p class="settings-changelog__footer">` after the entries list, with a `target="_blank" rel="noopener noreferrer"` link to `https://github.com/crystian/skill-map/blob/main/src/CHANGELOG.md`. Styled with a top divider, muted text, and the PrimeNG primary color on the link. Tells the user where the complete history lives without surfacing every old entry inline.
- **Three new i18n keys in `ui/src/i18n/settings.texts.ts`**: `changelogFooterText`, `changelogFooterLinkLabel`, `changelogFooterUrl`.

## User-facing

**Changelog tab is now bounded.** The Settings → Changelog tab shows the most recent 10 releases and links out to the full changelog on GitHub for older entries.
