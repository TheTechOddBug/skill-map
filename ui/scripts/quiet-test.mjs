#!/usr/bin/env node
/**
 * `ui/scripts/quiet-test.mjs`: run `ng test --watch=false` and collapse a green
 * run to just its Vitest count summary.
 *
 * Why a wrapper: `ng test` prints the esbuild bundle table (which no Angular
 * flag suppresses, same limitation as `ng build`) followed by Vitest's
 * per-file list, a wall of noise inside `pnpm validate`. This captures the
 * whole run and, on success, echoes ONLY Vitest's `Test Files` / `Tests` /
 * `Duration` lines.
 *
 * On failure it replays Vitest's report FIRST and drops only the bundle table,
 * which names chunks and says nothing about the failure. Both halves of that
 * sentence are load-bearing and were learned from a CI run nobody could
 * diagnose: the replay used to lead with the ~70 kB table and end with the
 * report, and `process.exit()` cut the whole payload at the 64 kB pipe buffer,
 * so every failing CI run showed a wall of chunk names and NOT ONE line of the
 * actual error. See `emit()` for why this file must never call `process.exit()`.
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

// Failure replay puts stderr FIRST: `ng test` writes the esbuild bundle table
// (~70 kB) to stdout and Vitest writes the failure details to stderr, so
// appending stderr last buries the only part anyone needs to read.
const stdout = run.stdout ?? '';
const stderr = run.stderr ?? '';

if (run.status === 0) {
  const summary = `${stdout}${stderr}`
    .replace(ANSI, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(Test Files|Tests|Duration)\b/.test(line));
  emit(summary.length > 0 ? `${summary.map(green).join('\n')}\n` : `${stdout}${stderr}`);
  process.exitCode = 0;
} else {
  // Failure replay: Vitest's report (stderr) first, then whatever stdout said
  // MINUS the esbuild bundle table. The table is ~70 kB of chunk names that say
  // nothing about why the run failed, and it used to be the entire visible
  // output because it was replayed first and then cut off at the pipe buffer.
  emit(`${stderr}${stripBundleTable(stdout)}`);
  process.exitCode = run.status ?? 1;
}

/**
 * Drop the esbuild bundle table from a captured `ng test` stdout.
 *
 * The table is the block of `<file> | <name> | <size>` rows (plus its
 * `Initial chunk files` / `Lazy chunk files` headers) that no Angular flag
 * suppresses. Everything else on stdout is kept, including the
 * "Application bundle generation complete" line, so a real build error is
 * never filtered away: build diagnostics do not wear the row shape.
 */
function stripBundleTable(text) {
  return text
    .split('\n')
    .filter((line) => {
      const plain = line.replace(ANSI, '').trimEnd();
      if (/^(Initial|Lazy) chunk files\s*\|/.test(plain)) return false;
      return !/\|\s*[\d.]+\s*(kB|bytes)\s*\|?\s*$/.test(plain);
    })
    .join('\n');
}

/**
 * Write without losing the tail.
 *
 * `process.stdout.write()` is ASYNCHRONOUS when stdout is a pipe (which it
 * always is under `pnpm run`), and `process.exit()` does NOT flush what is
 * still queued, so the payload was silently cut at the 64 kB pipe buffer. That
 * truncation ate every CI failure report this wrapper exists to surface: the
 * bundle table alone is ~70 kB, so Vitest's actual failure output never made it
 * out of the runner.
 *
 * The fix is simply to never call `process.exit()` here: set `process.exitCode`
 * and let Node exit on its own once the stream has drained. `writeSync` is NOT
 * a valid shortcut, a non-blocking pipe fd accepts a PARTIAL write and returns
 * the byte count, so it truncates at the same boundary unless every caller
 * loops.
 */
function emit(text) {
  process.stdout.write(text);
}
