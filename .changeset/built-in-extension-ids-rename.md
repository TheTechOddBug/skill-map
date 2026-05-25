---
'@skill-map/cli': minor
'@skill-map/spec': minor
---

Rename 14 built-in extension ids to a consistent `<domain>-<detail>` pattern. The naming was inconsistent: 10 ids already followed the "area first, attribute after" shape (e.g. `annotation-orphan`, `link-conflict`) while 14 were inverted, redundant, or vague. All built-ins now agree.

Full rename map (`old qualified id` → `new qualified id`):

| Kind | Old | New |
|---|---|---|
| action | `core/bump` | `core/node-bump` |
| action | `core/mark-superseded` | `core/node-supersede` |
| extractor | `core/tools-count` | `core/tools-counter` |
| extractor | `claude/slash` | `claude/slash-command` |
| analyzer | `core/broken-ref` | `core/reference-broken` |
| analyzer | `core/job-orphan-file` | `core/job-file-orphan` |
| analyzer | `core/link-counts` | `core/link-counter` |
| analyzer | `core/redundant-target-reference` | `core/reference-redundant` |
| analyzer | `core/reserved-name` | `core/name-reserved` |
| analyzer | `core/self-loop` | `core/link-self-loop` |
| analyzer | `core/stability` | `core/node-stability` |
| analyzer | `core/superseded` | `core/node-superseded` |
| analyzer | `core/unknown-field` | `core/field-unknown` |
| analyzer | `core/validate-all` | `core/schema-violation` |

The convention is now documented in `spec/plugin-author-guide.md` §Extension id shape. Counter-style extensions standardise on the `-counter` suffix (`link-counter`, `tools-counter`, `external-url-counter`).

CLI verb `sm bump` is **unchanged** (it remains the user-facing verb; the internal action id is what flipped to `core/node-bump`). The `BumpReport` JSON schema title also stays as `BumpReport`, the wire shape is unchanged.

Pre-1.0 minor per `spec/versioning.md`: breaking rename of public qualified ids referenced from `settings.json`, `--analyzers <id>` flags, `core/<id>` strings in plugin manifests, and the `analyzerId` filter on `GET /api/issues`. No behavioural change, no DB schema change, no event payload shape change. Persisted scans created with the old ids regenerate cleanly on the next `sm scan`.

## User-facing

Renamed 14 built-in extension ids to a `<area>-<detail>` shape (e.g. `core/broken-ref` is now `core/reference-broken`). If you reference these by qualified id in `settings.json` or via `sm check --analyzers <id>`, update to the new names.
