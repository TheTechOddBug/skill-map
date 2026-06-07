#!/usr/bin/env zsh
# Pane wrapper used by start.sh — runs a pnpm script and drops to a
# shell on exit so the last output remains visible.
#
# Why this file exists separately: wt.exe parses ';' as a sub-command
# separator. Inlining a multi-statement string like
# `trap "" INT; pnpm "$1"; exec zsh` into the wt.exe invocation
# breaks the parser — the `;` inside the string get treated as new tab
# / split-pane delimiters. Keeping the multi-statement command in its
# own file (passed as a single argument to wsl zsh) sidesteps that
# entirely.
#
# Usage: start-pane.sh <pnpm-script-name> [fixture-dir]
#   The optional second arg names the fixture scope; when present it is
#   exported as SM_FIXTURE so `bff:scan` / `bff:dev` resolve
#   `fixtures/${SM_FIXTURE:-local-scope}`. The UI pane omits it (Angular
#   HMR is fixture-agnostic, it proxies the API to the BFF).
#
# `trap '' INT` swallows Ctrl+C at this wrapper level so the dev
# script below receives the signal cleanly and exits on its own; the
# wrapper then falls through to the shell instead of disappearing.

trap '' INT
[ -n "$2" ] && export SM_FIXTURE="$2"
pnpm "$1"
exec $SHELL
