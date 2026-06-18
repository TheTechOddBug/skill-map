/**
 * Zero-dep IO + JSON-envelope helpers shared by the tutorial scripts.
 * Every verb prints ONE JSON line to stdout: `{ ok: true, ... }` with
 * exit 0, or `{ ok: false, code, error }` with a non-zero exit. The
 * orchestrating agent parses stdout; it never hand-edits state.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export function exists(p) {
  return existsSync(p);
}

export function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** Write pretty JSON with a trailing LF newline (project line-ending rule). */
export function writeJson(p, obj) {
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

export function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

export function succeed(obj) {
  emit({ ok: true, ...obj });
  process.exit(0);
}

export function die(code, error) {
  emit({ ok: false, code, error });
  process.exit(1);
}
