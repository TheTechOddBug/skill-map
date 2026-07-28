---
'@skill-map/cli': patch
'@skill-map/spec': patch
---

Both packages now publish with npm provenance: every tarball carries a signed attestation binding it to this repo, the `release` workflow and the commit that built it, recorded in the public Rekor transparency log. Enabled twice on purpose, `publishConfig.provenance` per package plus `NPM_CONFIG_PROVENANCE` in the publish step, because a `changeset publish` that dropped the field would fail silently. No code or API changed.

## User-facing

**Verify where your copy came from.** Every published release now carries a signed record of the repository, commit and CI run that built it. Run `npm audit signatures` after installing, or read the Provenance panel on the npm package page.
