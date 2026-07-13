/**
 * Unit tests for the `ClaudeCliRunner` helpers (Step 10 Phase E). No real
 * `claude` binary is ever spawned: the extraction helpers are pure, and
 * the ENOENT path spawns a deliberately nonexistent binary name.
 *
 * Coverage:
 *   - `extractReportJson`: bare object, prose-wrapped object, fenced
 *     block (last one wins), last-of-two bare objects, nested objects
 *     returned whole (never as inner fragments), no-JSON / array-only /
 *     empty -> null.
 *   - `extractRunReport`: the `--output-format json` envelope (result +
 *     usage tokens), a fenced report inside the envelope's result text,
 *     non-envelope stdout degrading to raw-text extraction with zero
 *     tokens.
 *   - missing binary -> typed `ClaudeCliNotFoundError`.
 */

import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  ClaudeCliNotFoundError,
  ClaudeCliRunner,
  extractReportJson,
  extractRunReport,
} from '../claude-cli.js';

const REPORT = { whatItCovers: 'x', confidence: 0.5, safety: { injectionDetected: false } };
const REPORT_JSON = JSON.stringify(REPORT);

describe('extractReportJson', () => {
  it('returns the whole text when it is a single JSON object', () => {
    strictEqual(extractReportJson(`  ${REPORT_JSON}\n`), REPORT_JSON);
  });

  it('extracts an object embedded in prose', () => {
    const text = `Here is the report you asked for:\n${REPORT_JSON}\nHope that helps!`;
    strictEqual(extractReportJson(text), REPORT_JSON);
  });

  it('extracts a fenced ```json block', () => {
    const text = 'Report:\n```json\n' + REPORT_JSON + '\n```\ndone';
    strictEqual(extractReportJson(text), REPORT_JSON);
  });

  it('takes the LAST parseable fenced block (a retry supersedes)', () => {
    const first = '```json\n{"draft": true}\n```';
    const second = '```json\n' + REPORT_JSON + '\n```';
    strictEqual(extractReportJson(`${first}\nactually, corrected:\n${second}`), REPORT_JSON);
  });

  it('takes the LAST bare object when several appear', () => {
    const text = `{"first": 1} some prose {"second": 2}`;
    strictEqual(extractReportJson(text), '{"second": 2}');
  });

  it('returns a nested object whole, never an inner fragment', () => {
    const text = `prose before ${REPORT_JSON} prose after`;
    const extracted = extractReportJson(text);
    strictEqual(extracted, REPORT_JSON);
    // The inner safety object must not have won the scan.
    ok(extracted!.includes('whatItCovers'));
  });

  it('is not confused by braces inside JSON strings', () => {
    const tricky = '{"text": "a } inside a string { still fine"}';
    strictEqual(extractReportJson(`noise ${tricky} noise`), tricky);
  });

  it('returns null for text with no JSON object', () => {
    strictEqual(extractReportJson('no json here'), null);
  });

  it('returns null for an array-only payload (a report is an object)', () => {
    strictEqual(extractReportJson('[1, 2, 3]'), null);
  });

  it('returns null for empty / whitespace input', () => {
    strictEqual(extractReportJson('   \n  '), null);
  });
});

describe('extractRunReport', () => {
  it('unwraps the print-mode envelope and carries the usage tokens', () => {
    const envelope = JSON.stringify({
      type: 'result',
      result: REPORT_JSON,
      usage: { input_tokens: 321, output_tokens: 45 },
    });
    deepStrictEqual(extractRunReport(envelope), {
      reportJson: REPORT_JSON,
      tokensIn: 321,
      tokensOut: 45,
    });
  });

  it('extracts a fenced report from the envelope result text', () => {
    const envelope = JSON.stringify({
      result: 'Sure!\n```json\n' + REPORT_JSON + '\n```\n',
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    const extracted = extractRunReport(envelope);
    strictEqual(extracted.reportJson, REPORT_JSON);
    strictEqual(extracted.tokensIn, 10);
  });

  it('sums the prompt-cache usage fields into tokensIn', () => {
    // With prompt caching active the real input arrives mostly in the
    // cache fields; input_tokens alone undercounts by orders of magnitude.
    const envelope = JSON.stringify({
      result: REPORT_JSON,
      usage: {
        input_tokens: 4,
        cache_creation_input_tokens: 1200,
        cache_read_input_tokens: 30_000,
        output_tokens: 45,
      },
    });
    const extracted = extractRunReport(envelope);
    strictEqual(extracted.tokensIn, 4 + 1200 + 30_000);
    strictEqual(extracted.tokensOut, 45);
  });

  it('treats absent / malformed cache fields as 0', () => {
    const envelope = JSON.stringify({
      result: REPORT_JSON,
      usage: {
        input_tokens: 7,
        cache_creation_input_tokens: 'not-a-number',
        output_tokens: 1,
      },
    });
    strictEqual(extractRunReport(envelope).tokensIn, 7);
  });

  it('degrades to raw-text extraction (zero tokens) when stdout is not the envelope', () => {
    const extracted = extractRunReport(`plain text then ${REPORT_JSON}`);
    strictEqual(extracted.reportJson, REPORT_JSON);
    strictEqual(extracted.tokensIn, 0);
    strictEqual(extracted.tokensOut, 0);
  });

  it('falls back to the trimmed text when nothing is extractable', () => {
    const extracted = extractRunReport('  not a report  ');
    strictEqual(extracted.reportJson, 'not a report');
  });
});

describe('ClaudeCliRunner, missing binary', () => {
  it('rejects with the typed ClaudeCliNotFoundError on spawn ENOENT', async () => {
    const runner = new ClaudeCliRunner({ binary: 'skill-map-no-such-binary-xyz' });
    await rejects(
      runner.run('content', { timeoutMs: 5_000 }),
      (err: unknown) => {
        ok(err instanceof ClaudeCliNotFoundError, 'typed error');
        ok(err.message.includes('claude CLI not found'), 'advisory names the problem');
        return true;
      },
    );
  });
});
