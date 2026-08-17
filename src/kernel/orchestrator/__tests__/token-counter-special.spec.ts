/**
 * Special-token policy of the token counter: counting NEVER throws.
 *
 * `gpt-tokenizer`'s default encode options reject text containing a
 * literal special token (`<|endoftext|>`), which under the previous
 * `js-tiktoken` engine aborted the whole scan when one markdown file
 * pasted such a token into prose (latent bug: surfaced only as a
 * generic scan-error). The counter passes an empty `disallowedSpecial`
 * set so the text is BPE-encoded as plain prose instead.
 *
 * Pinned here:
 *   - unit: both encodings count special-token text without throwing,
 *     and the literal token costs more than one token (proving it was
 *     NOT collapsed to its single special id).
 *   - integration: a scan over a fixture whose body contains
 *     `<|endoftext|>` succeeds and the node carries token counts.
 */

import { describe, it, before, after } from 'node:test';
import { ok, strictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getTokenCounterHandle } from '../token-counter.js';
import { createKernel, runScan } from '../../index.js';
import { builtIns } from '../../../plugins/built-ins.js';

const SPECIAL = '<|endoftext|>';

describe('token counter special-token policy (unit)', () => {
  for (const name of ['cl100k_base', 'o200k_base'] as const) {
    it(`${name}: counts prose containing a literal special token without throwing`, async () => {
      const counter = await getTokenCounterHandle(name).resolve();
      const split = counter.count('', `x ${SPECIAL} y`);
      ok(split.total > 0, 'special-token prose must produce a positive count');
      strictEqual(split.frontmatter, 0);
    });

    it(`${name}: a bare special token is BPE-encoded as plain text (> 1 token)`, async () => {
      const counter = await getTokenCounterHandle(name).resolve();
      const split = counter.count('', SPECIAL);
      ok(
        split.total > 1,
        `literal ${SPECIAL} must cost more than one token (got ${split.total}), ` +
          'proving it was not collapsed to its special id',
      );
    });
  }

  it('empty inputs short-circuit to zero without loading work', async () => {
    const counter = await getTokenCounterHandle('cl100k_base').resolve();
    const split = counter.count('', '');
    strictEqual(split.frontmatter, 0);
    strictEqual(split.body, 0);
    strictEqual(split.total, 0);
  });
});

describe('token counter special-token policy (integration)', () => {
  let fixture: string;

  before(() => {
    fixture = mkdtempSync(join(tmpdir(), 'skill-map-special-token-'));
    const abs = join(fixture, '.claude/skills/hostile/SKILL.md');
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(
      abs,
      ['---', 'name: hostile', 'description: D', '---', `prose with ${SPECIAL} inside`].join('\n'),
    );
  });

  after(() => {
    rmSync(fixture, { recursive: true, force: true });
  });

  it('a scan over a body containing a literal special token succeeds with tokens', async () => {
    const kernel = createKernel();
    const baseline = builtIns();
    const result = await runScan(kernel, {
      roots: [fixture],
      extensions: {
        providers: baseline.providers,
        extractors: [],
        analyzers: [],
      },
    });
    const node = result.nodes.find((n) => n.path.endsWith('SKILL.md'));
    ok(node, 'the hostile fixture node must be present (scan did not abort)');
    ok(node.tokens, 'the node must carry token counts');
    ok(node.tokens.body > 0, 'body tokens must be positive');
  });
});
