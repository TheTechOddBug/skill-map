---
"@skill-map/spec": patch
"@skill-map/cli": patch
"@skill-map/testkit": patch
"@skill-map/web": patch
---

Verify the release pipeline end-to-end after the pnpm 11 migration: `release.yml` boots through `pnpm install --frozen-lockfile`, `release:version` bumps versions and refreshes the lockfile in one shot, `release:publish` propagates the four versioned packages to npm, and `deploy-web.yml` rolls out the new public site on the post-migration `pnpm/action-setup` chain. No functional or contract change in any of the four packages, this exists purely so the next "chore: version packages" PR exercises every moving part of the new pipeline at least once.
