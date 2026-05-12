---
"@skill-map/web": patch
---

Redeploy the public site to ship two `ui/`-side fixes that already landed in the bundled demo but have not yet been republished:

- Graph view edges in `web/demo/` now render again. The five sidecars under `fixtures/demo-scope/` were on the pre-0.18 `for:` root shape, AJV rejected each one, and the `annotations` extractor never emitted any path-style `supersedes` / `references` links. Only trigger-style links (`@frontend-specialist`, `/deploy`) survived, and `ui/graph-layout.ts` filters those out because `target` is not a `node.path`. The demo was therefore rendering with zero edges. Sidecars migrated to the `identity:` root + hashes refreshed via `sm bump --pending` regenerated the bundled `web/demo/data.json` with the seven expected edges.
- PrimeNG `::ng-deep` M1 sweep against `primeng@21.1.6` (Phase 2 `pt.content` migration + Phase 4 host-merge selector repair). Internal to `ui/`, ships bundled in the same demo bundle that `web/` deploys.

No `## User-facing` section: `@skill-map/web` does not feed the in-app changelog (that surface is reserved for `@skill-map/cli`, `@skill-map/spec`, `@skill-map/testkit`), and the visible-site impact is "the graph looks right again", which the redeploy itself communicates.
