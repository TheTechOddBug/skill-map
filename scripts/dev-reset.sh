#!/usr/bin/env bash
# Reset a skill-map scope and re-bootstrap from scratch.
#
# Two modes — default is `--target=fixture` because that's what
# `npm run start` (BFF + UI panes) actually mounts via
# `bff:dev --cwd fixtures/local-scope`. Use `--target=repo` when you
# want to re-scan the skill-map repo itself.
#
# What it does:
#   1. Wipes the target's .skill-map/ (DB + jobs + plugins).
#   2. Rebuilds the CLI dist (`npm run cli:build`) — needed when migration
#      files or kernel code changed since the last build.
#   3. Rebuilds the UI bundle so `sm serve` (in `auto` UI mode) picks up
#      any in-flight UI changes from disk. `npm run start` uses
#      `--no-ui` on the BFF + a separate `ui:dev` pane on :4200, so
#      this rebuild is only material for foreground `sm serve` flows.
#   4. Runs `sm init` against the target — provisions a fresh DB and
#      runs the first scan.
#
# What it does NOT do:
#   - Touch the global skill-map state (~/.config/skill-map/...).
#   - Boot `sm serve` / `npm run start` — leave that to the human in
#     their TTY (Ctrl+C handling is cleaner there; AGENTS.md forbids
#     `--watch` from agent shells).
#   - Use the globally-installed `sm` (it lags behind in-flight work).
#     Always invokes the local `node src/bin/sm.js`.
#
# Usage:
#   bash scripts/dev-reset.sh                       # default: fixture, full rebuild
#   bash scripts/dev-reset.sh --target=repo         # reset .skill-map/ at repo root
#   bash scripts/dev-reset.sh --no-ui               # skip UI rebuild
#   bash scripts/dev-reset.sh --no-cli              # skip CLI rebuild
#   bash scripts/dev-reset.sh --no-cli --no-ui      # DB-only reset (fastest)
#   bash scripts/dev-reset.sh --help
#
# Run from the repo root.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TARGET=fixture
SKIP_UI=false
SKIP_CLI=false
for arg in "$@"; do
  case "$arg" in
    --target=fixture) TARGET=fixture ;;
    --target=repo) TARGET=repo ;;
    --no-ui) SKIP_UI=true ;;
    --no-cli) SKIP_CLI=true ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Error: unknown flag '$arg'" >&2
      echo "Run with --help for usage." >&2
      exit 2
      ;;
  esac
done

case "$TARGET" in
  fixture)
    SCOPE_DIR="fixtures/local-scope"
    BFF_HINT="npm run start                         # WT split panes (BFF cwd=$SCOPE_DIR + UI dev)"
    ;;
  repo)
    SCOPE_DIR="."
    BFF_HINT="node src/bin/sm.js serve              # foreground BFF + UI bundle on :4242"
    ;;
esac

echo "→ Target: $TARGET ($SCOPE_DIR)"
echo "→ Removing $SCOPE_DIR/.skill-map/"
rm -rf "$SCOPE_DIR/.skill-map"

if [ "$SKIP_CLI" = false ]; then
  echo "→ Rebuilding CLI dist (npm run cli:build)"
  npm run cli:build
else
  echo "→ Skipping CLI rebuild (--no-cli)"
fi

if [ "$SKIP_UI" = false ]; then
  echo "→ Rebuilding UI bundle (npm run ui:build)"
  npm run ui:build
else
  echo "→ Skipping UI rebuild (--no-ui)"
fi

echo "→ Running sm init in $SCOPE_DIR (provisions DB + first scan)"
( cd "$SCOPE_DIR" && node "$REPO_ROOT/src/bin/sm.js" init )

echo
echo "✓ Reset complete. Boot the BFF + UI when you're ready:"
echo "    $BFF_HINT"
