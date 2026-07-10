#!/usr/bin/env bash
# Open Windows Terminal with two split panes (BFF left, UI right) for a
# fixture dev scope.
#
# Usage: start.sh [fixture-dir]   (default: claude)
#   The root `fix:*` shortcuts wire each fixture:
#     pnpm fix:claude  -> pnpm start          (this script, claude)
#     pnpm fix:demo    -> start.sh demo
#   The fixture is threaded to the BFF pane via SM_FIXTURE; `bff:scan`
#   and `bff:dev` resolve `fixtures/${SM_FIXTURE:-claude}`. The UI
#   pane runs `ui:dev` (Angular HMR), which proxies the API to the BFF
#   and is fixture-agnostic.
#
# WSL2 + Windows Terminal only — intended for the Architect's local dev
# environment. If wt.exe isn't on PATH, the script aborts with a hint.
#
# Each pane drops to a shell on exit so the last output stays inspectable.

set -e

if ! command -v wt.exe >/dev/null 2>&1; then
  echo "Error: this script requires WSL2 + Windows Terminal (wt.exe)." >&2
  echo "It is meant for the local dev environment; no cross-platform fallback." >&2
  exit 1
fi

# Fixture scope to bring up (default claude). Validated up front so
# a typo'd `fix:*` fails before any pane opens.
FIXTURE="${1:-claude}"
if [ ! -d "fixtures/$FIXTURE" ]; then
  echo "Error: fixture 'fixtures/$FIXTURE' does not exist." >&2
  echo "Available: $(ls -d fixtures/*/ 2>/dev/null | xargs -n1 basename | tr '\n' ' ')" >&2
  exit 1
fi

# Regenerate the built-ins manifest before the panes open. Both panes
# run from source (BFF via `tsx`, UI via `ng serve`), so no `dist` build
# is needed; the only generated source the tsx serve imports is
# `src/plugins/built-ins.ts`, so keep just that fresh in case a built-in
# changed. (The serve's watcher does the initial scan itself, so there is
# no pre-scan step that would need the compiled `sm` binary.)
pnpm --filter @skill-map/cli build-built-ins

# wt.exe -d expects a Windows-style path. `wslpath -w .` is the Windows
# representation of the current working directory.
PROJECT_DIR=$(wslpath -w .)

# Free dev ports if held by orphans from a previous session. fuser
# exits non-zero when nothing is listening; suppress that noise.
fuser -k 4242/tcp 2>/dev/null || true
fuser -k 4200/tcp 2>/dev/null || true

# Per-pane command lives in scripts/start-pane.sh — it cannot be
# inlined here because wt.exe parses `;` as a sub-command separator,
# and the wrapper's `trap; pnpm; exec` chain contains them. The BFF pane
# receives the fixture as a second arg (exported as SM_FIXTURE there).
wt.exe --title skill-map -d "$PROJECT_DIR" wsl zsh ./scripts/start-pane.sh bff:dev "$FIXTURE" \; \
  split-pane -V -d "$PROJECT_DIR" wsl zsh ./scripts/start-pane.sh ui:dev
