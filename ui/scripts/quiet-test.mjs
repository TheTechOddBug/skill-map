#!/usr/bin/env node
/**
 * `ui/scripts/quiet-test.mjs`: run `ng test --watch=false` and collapse a green
 * run to just its Vitest count summary.
 *
 * Why a wrapper: `ng test` prints the esbuild bundle table (which no Angular
 * flag suppresses, same limitation as `ng build`) followed by Vitest's
 * per-file list, a wall of noise inside `pnpm validate`. This captures the
 * whole run and, on success, echoes ONLY Vitest's `Test Files` / `Tests` /
 * `Duration` lines. On any failure (build error or failing tests) it replays
 * the full captured output so nothing important is hidden.
 *
 * Extra args are forwarded: `pnpm --filter ui test:ci -- <flag>`.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

// Colour the summary green on a TTY or when FORCE_COLOR is set (the `test:ci`
// script sets it so `pnpm validate` stays green even though pnpm pipes stdout);
// NO_COLOR always wins.
const useColor =
  !process.env['NO_COLOR'] && (Boolean(process.stdout.isTTY) || Boolean(process.env['FORCE_COLOR']));
const green = (line) => (useColor ? `${ESC}[32m${line}${ESC}[0m` : line);

const uiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = spawnSync('ng', ['test', '--watch=false', ...process.argv.slice(2)], {
  cwd: uiRoot,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

if (run.status === 0) {
  const summary = output
    .replace(ANSI, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(Test Files|Tests|Duration)\b/.test(line));
  process.stdout.write(summary.length > 0 ? `${summary.map(green).join('\n')}\n` : output);
  process.exit(0);
}

process.stdout.write(output);
process.exit(run.status ?? 1);
