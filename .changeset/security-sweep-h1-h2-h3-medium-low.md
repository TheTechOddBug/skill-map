---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

Security audit sweep (cli-hacker follow-up). Three highs, three mediums, three lows, plus the shared prototype-pollution helper and a plugin-author doc note.

- **H1** — BFF rejects non-loopback `Host` and `Origin` headers on every request (port-agnostic hostname allow-list). Closes the DNS-rebinding lane where a malicious page in the operator's browser could weaponise the local API by resolving an attacker-controlled hostname to 127.0.0.1.
- **H2 / L2** — Sidecar `deepMerge` + `readSidecarFor` parse strip `__proto__` / `constructor` / `prototype` keys at every depth. Shared helper in `kernel/util/strip-prototype-pollution.ts` (also adopted by `kernel/config/loader.ts`).
- **H3** — Bumped `hono` to 4.12.18 and `kysely` to 0.28.17. Added a root `overrides.fast-uri: 3.1.2` to lift the transitive past the path-traversal advisories. Lockfile regenerated.
- **M1** — Settings + sidecar atomic writes now land mode 0o600 (matches `db restore`'s discipline).
- **M2** — `sm job prune` rejects `unlink()` on paths that don't stay inside `<scope>/.skill-map/jobs/`.
- **M3** — Orphan-files walker skips symlinks (parity with the scan + reference walkers).
- **L1** — Sidecar temp filename embeds `pid` + timestamp (cross-process race window).
- **L3** — `fetchLatestVersion` rejects registry responses whose `version` is not a semver-shaped string.
- **L5** — Two BFF error envelopes on `/api/contributions/*` sanitize URL params before interpolation.
- **L4** — Plugin author guide spells out that module top-level side effects survive an `import()` timeout, so plugins must do their work inside lifecycle methods.

## User-facing

`sm serve` now rejects browser requests whose `Host` or `Origin` is not a loopback name. Fixes a DNS-rebinding lane where a malicious page could trigger scans or settings writes while the server is running. `--dev-cors` still works for Vite-style dev UIs on a different loopback port.
