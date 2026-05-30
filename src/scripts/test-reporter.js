/**
 * Quiet reporter for the CLI workspace's `node:test` suites.
 *
 * Collapses the per-test `spec`-reporter firehose into:
 *   - all green: a single summary line
 *       `✓ <N> tests passed · <F> files · <T>`
 *   - on failure: one block per failing leaf test (name, assertion, location)
 *     streamed as they happen, then a summary line
 *       `<N> tests · <X> failed · <T>`
 *
 * Wired from `src/package.json` via
 *   --test-reporter=./scripts/test-reporter.js --test-reporter-destination=stdout
 *
 * Event-stream contract (Node v26 `node:test`, verified empirically):
 *   - Leaf failures are `test:fail` with `details.type === 'test'`. Suite-level
 *     aggregates (`details.type === 'suite'`, `error.failureType ===
 *     'subtestsFailed'`) are skipped so one assertion failure prints once.
 *   - Canonical totals come from the ROOT `test:summary` (the single event with
 *     no `file`); each spec file emits its own `test:summary` WITH a `file`, so
 *     counting those gives the file count.
 *   - Run duration comes from the root `duration_ms` diagnostic.
 *   - Passing-test events and per-test stdout/stderr are suppressed (that is the
 *     whole point: keep the console quiet). Run `pnpm test:spec` for the full
 *     verbose tree when debugging.
 */

const useColor = Boolean(process.stdout.isTTY) && !process.env['NO_COLOR'];
const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s) => paint('31', s);
const green = (s) => paint('32', s);
const dim = (s) => paint('2', s);
const bold = (s) => paint('1', s);

/** Trim an absolute spec path down to its workspace-relative form. */
function relFile(file) {
  if (!file) return '';
  const s = String(file);
  const marker = '/src/';
  const i = s.lastIndexOf(marker);
  return i >= 0 ? s.slice(i + marker.length) : s;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '';
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

export default async function* quietReporter(source) {
  const files = new Set();
  let totals = null;
  let durationMs = Number.NaN;
  let leafPass = 0;
  let leafFail = 0;

  for await (const event of source) {
    const data = event.data ?? {};
    switch (event.type) {
      case 'test:fail': {
        // Only leaf tests; suite-level `subtestsFailed` rollups are noise.
        if (data.details?.type !== 'test') break;
        leafFail += 1;
        const error = data.details?.error;
        const message = String(error?.cause?.message ?? error?.message ?? 'failed').split('\n')[0];
        const location = data.file ? `${relFile(data.file)}:${data.line ?? '?'}` : '';
        yield `\n${red('✖')} ${bold(String(data.name ?? 'unnamed test'))}\n`;
        yield `    ${red(message)}\n`;
        if (location) yield `    ${dim(`at ${location}`)}\n`;
        break;
      }
      case 'test:pass': {
        if (data.details?.type === 'test') leafPass += 1;
        break;
      }
      case 'test:summary': {
        if (data.file) files.add(String(data.file));
        else if (data.counts) totals = data.counts;
        break;
      }
      case 'test:diagnostic': {
        if (!data.file) {
          const match = /^duration_ms\s+([\d.]+)/.exec(String(data.message ?? ''));
          if (match) durationMs = Number(match[1]);
        }
        break;
      }
      default:
        // Suppress enqueue / dequeue / start / complete / plan / stdout / stderr.
        break;
    }
  }

  const tests = totals?.tests ?? leafPass + leafFail;
  const failed = totals?.failed ?? leafFail;
  const fileCount = files.size || (tests > 0 ? 1 : 0);
  const duration = formatDuration(durationMs);
  const filesLabel = `${fileCount} file${fileCount === 1 ? '' : 's'}`;
  const sep = dim('·');
  const tail = duration ? ` ${sep} ${duration}` : '';

  if (failed === 0) {
    yield `${green('✓')} ${tests} tests passed ${sep} ${filesLabel}${tail}\n`;
  } else {
    yield `\n${red(`${tests} tests ${sep} ${failed} failed`)}${tail}\n`;
  }
}
