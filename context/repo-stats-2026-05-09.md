# skill-map — Repo Stats

_Snapshot: 2026-05-09_

## Size & structure
- **812 tracked files**, **217,557 total lines**
- **142 MB** repo (excluding `.git`/`node_modules`) · **.git: 49 MB** · **node_modules: 489 MB**
- **10 `package.json`** files · **7 workspaces**: `spec`, `src`, `testkit`, `ui`, `e2e`, `examples/hello-world`, `web`

## Lines per top-level dir
| Dir | Lines | Files |
|---|---:|---:|
| `src/` | 80,726 | 392 |
| `web/` | 66,337 | 26 |
| `ui/` | 25,638 | 175 |
| `spec/` | 9,962 | 67 |
| `context/` | 2,744 | 11 |
| `testkit/` | 1,951 | 17 |
| `.changeset/` | 1,088 | 43 |
| `e2e/` | 1,083 | 14 |
| `fixtures/` | 572 | 28 |

## By language
| Lang | Files | Lines |
|---|---:|---:|
| TypeScript | 488 | 93,506 |
| Markdown | 135 | 32,086 |
| JSON | 74 | 16,546 |
| CSS | 23 | 6,914 |
| HTML | 23 | 3,570 |
| JS | 17 | — |

## Git
- **489 commits** across **20 active days**
- First commit: **2026-04-18** (`0032ce2 first commit`)
- Latest commit: **2026-05-09** (`b3f320f merge: feature/ui-tweaks → main`)
- Repo age: **~3 weeks** · pace: **~24 commits/active-day**
- **52 tags** · **5 branches**

### Authors
| Author | Commits |
|---|---:|
| Crystian | 411 |
| Crystian `<crystian@users.noreply.github.com>` | 41 |
| github-actions[bot] | 37 |

## Activity
- Last 24 h: **55 commits**
- Last 7 days: **259 commits**
- Last 90 days: **486 commits** (full repo history fits inside this window)

### Commits per ISO week
| Week | Commits |
|---|---:|
| 2026-W16 | 2 |
| 2026-W17 | 106 |
| 2026-W18 | 201 |
| 2026-W19 | 177 |

### Commits per month
| Month | Commits |
|---|---:|
| 2026-04 | 155 |
| 2026-05 | 331 |

## Tests

Real test cases (not just files):

| Workspace | Test files | Test cases | Runner |
|---|---:|---:|---|
| `src/` (CLI + kernel + server) | 107 | **1,190** | `node --test` |
| `testkit/` | 5 | **32** | `node --test` |
| `ui/` | 29 | **~308** | `ng test` (Karma/Jasmine) |
| `e2e/` | 4 | **~11** | Playwright |
| **Total** | **145** | **~1,541** | |

## Coverage

### `src/` (1,190/1,190 pass)
| Metric | Result | Threshold | Status |
|---|---:|---:|---|
| Lines | **94.63 %** | 96 % | ❌ below |
| Branches | **83.97 %** | 85 % | ❌ below |
| Functions | **88.40 %** | 93 % | ❌ below |

> Coverage script exits non-zero due to missed thresholds — all tests pass, but the targets in `src/node.config.json` aren't met yet.

#### Lowest-coverage files in `src/`
- `ports/logger.ts` — funcs **25 %**
- `sqlite/tags.ts` — funcs **50 %**
- `cli/util/logger.ts` — funcs **55.56 %**
- `silent-logger.ts` — funcs **57.14 %**
- `sqlite/plugin-migrations.ts` — branches **68.75 %**
- `plugin-store.ts` — branches **69.57 %**
- `scan/delta.ts` — funcs **73.33 %**
- `scan/ignore.ts` — funcs **66.67 %**
- `sqlite/storage-adapter.ts` — branches 84 %, funcs 85.5 %
- `orchestrator.ts` — funcs **92.75 %** (uncovered: error paths around lines 163-179, 202-205, 410-421, 661-668)

### `testkit/` (32/32 pass)
| Metric | Result | Threshold | Status |
|---|---:|---:|---|
| Lines | **99.21 %** | — | ✅ |
| Branches | **80.90 %** | 85 % | ❌ below |
| Functions | **88.24 %** | 100 % | ❌ below |

> Weakest file: `context.ts` — funcs **55.56 %**, branches **64 %**.

### `spec/`
- `spec:check`: ✅ **OK** — 60 files hashed in `spec/index.json`, `coverage.md` in sync with 31 schemas.

## Quality / process
- **42 active changesets** in `.changeset/`
- **67 normative spec files** under `spec/`
- All test suites green; only coverage thresholds gating CI on `src/` and `testkit/`.

## Notable observations
- 3-week-old repo already past **80k lines in `src/`** — fast ramp.
- **~1,541 test cases** across 145 files (~3.2 cases per file on average).
- Almost all activity concentrated in **W17–W19** (484/489 commits).
- Coverage gap is concentrated in **logger ports** and **SQLite edge paths** — small files dragging the funcs % down disproportionately.
