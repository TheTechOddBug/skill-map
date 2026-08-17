/**
 * `RunScanOptions.tokenizer` end-to-end: the resolved encoder name
 * actually selects which encoding (`cl100k_base` / `o200k_base`) builds
 * the per-node `tokens` counts, and is carried onto `ScanResult.tokenizer`.
 *
 * Behaviour pinned here:
 *   - default (no `tokenizer`) → `cl100k_base`, and `result.tokenizer`
 *     reports it.
 *   - `tokenizer: 'o200k_base'` → the per-node counts differ from the
 *     cl100k_base counts for a string the two encoders tokenize
 *     differently (CJK text), proving the encoder genuinely switched.
 *   - an out-of-allow-list `tokenizer` falls back to `cl100k_base`
 *     (belt-and-suspenders guard over the override layer; the config
 *     schema's AJV enum already covers the config layers).
 *
 * The fixture body is multibyte CJK text because cl100k_base and
 * o200k_base produce different token counts for it (18 vs 15 at
 * authoring time); short ASCII strings tokenize identically under both
 * encoders, so they would not prove the switch.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, notStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan } from '../../index.js';
import type { ScanResult } from '../../types.js';
import { builtIns } from '../../../plugins/built-ins.js';

let fixture: string;

// CJK text: the two encoders disagree on its token count, so the per-node
// `tokens.body` is the discriminator between cl100k_base and o200k_base.
const CJK_BODY = '日本語のテキストをトークン化する例文です';

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-tokenizer-'));
  const abs = join(fixture, '.claude/skills/probe/SKILL.md');
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(
    abs,
    ['---', 'name: probe', 'description: D', '---', CJK_BODY].join('\n'),
  );
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

async function scanWith(tokenizer?: string): Promise<ScanResult> {
  const kernel = createKernel();
  const baseline = builtIns();
  return runScan(kernel, {
    roots: [fixture],
    ...(tokenizer !== undefined ? { tokenizer } : {}),
    extensions: {
      providers: baseline.providers,
      extractors: [],
      analyzers: [],
    },
  });
}

function bodyTokensOf(result: ScanResult): number {
  const node = result.nodes.find((n) => n.path.endsWith('SKILL.md'));
  ok(node, 'fixture skill node should be present');
  ok(node.tokens, 'node should carry token counts when tokenization is on');
  return node.tokens.body;
}

describe('RunScanOptions.tokenizer selects the encoder', () => {
  it('default resolves to cl100k_base and reports it on the result', async () => {
    const result = await scanWith();
    strictEqual(result.tokenizer, 'cl100k_base');
  });

  it('o200k_base produces different body token counts than cl100k_base', async () => {
    const cl = await scanWith('cl100k_base');
    const o2 = await scanWith('o200k_base');
    strictEqual(cl.tokenizer, 'cl100k_base');
    strictEqual(o2.tokenizer, 'o200k_base');
    notStrictEqual(
      bodyTokensOf(o2),
      bodyTokensOf(cl),
      'switching to o200k_base must change the per-node token counts',
    );
  });

  it('an out-of-allow-list name falls back to cl100k_base', async () => {
    const fallback = await scanWith('p50k_base');
    const cl = await scanWith('cl100k_base');
    strictEqual(fallback.tokenizer, 'cl100k_base');
    strictEqual(
      bodyTokensOf(fallback),
      bodyTokensOf(cl),
      'unknown encoder must produce cl100k_base counts',
    );
  });
});
