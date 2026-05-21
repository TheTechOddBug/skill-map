---
'@skill-map/cli': patch
---

Two P3 polish bugs from the providers-test-plan re-pass.

**1. `sm config get <known-key>` honours the runtime default (`bd-25m`).**

Schema-declared keys whose runtime value is computed (today only `activeProvider`, which falls back to filesystem auto-detect when settings is empty) used to report `Unknown config key` because they weren't materialised in `defaults.json`. Now `ConfigGetCommand` (and `ConfigShowCommand`) consult a small `KNOWN_DEFAULTLESS_KEY_RESOLVERS` registry when the layered lookup yields `undefined`, so:

- `sm config get activeProvider` in a project with `.claude/` returns `claude` (auto-detected) without persisting.
- `sm config get activeProvider` in a project with no markers returns `null` (not "Unknown").
- `sm config get fakekey` still errors with `Unknown config key: fakekey` + exit 5.

Asymmetry between `get`/`set` on `activeProvider` (the original bd-25m finding) is closed.

**2. Warning when `activeProvider` points at a disabled bundle (`bd-23c`).**

When the operator disables a provider bundle (`sm plugins disable <id>` / Settings UI) while `activeProvider` still points to it, every subsequent `sm scan` used to degrade silently: classification still ran (provider-driven) but the lens-gated extractors silently no-op'd. Now the scan-runner emits a printer warning naming the bundle + offering the two fixes (`sm plugins enable <id>` or switch the lens). Helper lives in `core/runtime/active-provider-bootstrap.ts` (`warnIfLensBundleDisabled`) so the scan-runner, BFF, and future watcher paths share the same surface.

**Regression coverage (the "que no vuelva a pasar esto" mandate):**

- New `at-directive` tests cover source-dir resolution for non-root source nodes (the bd-3nr contract): `@./foo.md` from `.claude/agents/source.md` produces target `.claude/agents/foo.md`; `@../commands/deploy.md` climbs one level; `@/abs/path.md` is skipped per the markdown-link alignment.
- New `sm config get` integration tests pin the bd-25m contract for `activeProvider` (null when nothing detected, autodetected id when `.claude/` is present, persisted value when settings has it) AND keep the exit-5 path live for truly unknown keys.
- New `warnIfLensBundleDisabled` unit tests pin the bd-23c contract (warn when lens points at a disabled bundle, silent on the happy path, silent when lens is null, selective so only the specific stale bundle triggers).

Full CLI test suite: 1626 pass, 4 skipped, 0 fail.

## User-facing

`sm config get activeProvider` now returns the auto-detected lens (or `null`) instead of "Unknown config key" when settings is empty. Scans warn when the active provider's plugin bundle is disabled, so the graph difference no longer surprises you.
