import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert/strict';

import { extractCodeRegions, stripCodeBlocks } from '../strip-code-blocks.js';

describe('stripCodeBlocks', () => {
  it('returns empty input untouched', () => {
    strictEqual(stripCodeBlocks(''), '');
  });

  it('leaves prose without code regions unchanged', () => {
    const input = 'See @handle and /command in this paragraph.';
    strictEqual(stripCodeBlocks(input), input);
  });

  it('blanks the body of a fenced block but preserves line count', () => {
    const input = [
      'Before.',
      '```',
      'Cwd: /Volumes/foo',
      '@team-lead lives here',
      '```',
      'After.',
    ].join('\n');
    const out = stripCodeBlocks(input);
    const lines = out.split('\n');
    strictEqual(lines.length, 6);
    strictEqual(lines[0], 'Before.');
    strictEqual(lines[5], 'After.');
    // Middle lines lost their tokens; nothing for a downstream extractor to match.
    strictEqual(/@team/.test(out), false);
    strictEqual(/\/Volumes/.test(out), false);
  });

  it('handles ~~~ fences alongside ```', () => {
    const input = '~~~\n/cmd\n~~~';
    strictEqual(/\/cmd/.test(stripCodeBlocks(input)), false);
  });

  it('requires matching fence length to close', () => {
    const input = '````\n@inside\n```\nstill inside\n````\n@outside';
    const out = stripCodeBlocks(input);
    strictEqual(/@inside/.test(out), false);
    strictEqual(/still inside/.test(out), false);
    strictEqual(/@outside/.test(out), true);
  });

  it('strips inline code spans', () => {
    const input = 'Run `@team` not the literal mention, but @real should match.';
    const out = stripCodeBlocks(input);
    strictEqual(/`@team`/.test(out), false);
    strictEqual(/@real/.test(out), true);
  });

  it('handles multi-tick inline spans (``code``)', () => {
    const input = 'Doubled ``@inside`` and single `also-inside` and @outside.';
    const out = stripCodeBlocks(input);
    strictEqual(/@inside/.test(out), false);
    strictEqual(/also-inside/.test(out), false);
    strictEqual(/@outside/.test(out), true);
  });

  it('ignores backticks mid-token (does not open a fence)', () => {
    const input = 'inline ``` code ``` survives unless balanced';
    // Balanced run of 3, treated as inline span.
    const out = stripCodeBlocks(input);
    strictEqual(/code/.test(out), false);
  });
});

describe('extractCodeRegions', () => {
  it('returns empty input untouched', () => {
    strictEqual(extractCodeRegions(''), '');
  });

  it('output length always equals input length', () => {
    const input = [
      'Prose with @handle.',
      'Inline `refs/a.md` span.',
      '```bash',
      'cat refs/b.md',
      '```',
      'Trailing prose.',
    ].join('\n');
    strictEqual(extractCodeRegions(input).length, input.length);
  });

  it('keeps inline-span payload at its original offsets, blanks the prose', () => {
    const input = 'Read `refs/a.md` now.';
    const out = extractCodeRegions(input);
    const start = input.indexOf('refs/a.md');
    strictEqual(out.slice(start, start + 'refs/a.md'.length), 'refs/a.md');
    strictEqual(/Read/.test(out), false);
    strictEqual(/now/.test(out), false);
  });

  it('keeps fenced-block payload and preserves line count', () => {
    const input = ['Before.', '```', 'cat refs/a.md', '```', 'After.'].join('\n');
    const out = extractCodeRegions(input);
    strictEqual(out.split('\n').length, 5);
    strictEqual(/refs\/a\.md/.test(out), true);
    strictEqual(/Before/.test(out), false);
    strictEqual(/After/.test(out), false);
  });

  it('prose tokens do not survive the mask (exact inverse guarantee)', () => {
    const input = 'A bare refs/a.md path and a [link](refs/b.md) in prose.';
    const out = extractCodeRegions(input);
    strictEqual(/refs\//.test(out), false);
    strictEqual(out.length, input.length);
  });

  it('backtick and fence glyphs resurrect in the mask (pinned diff artifact)', () => {
    // stripCodeBlocks blanks the delimiters, so the diff keeps them.
    // Harmless to the backtick-path grammar; pinned so a future rewrite
    // that changes the artifact does so consciously.
    const input = 'Span `x` and:\n```bash\ny\n```';
    const out = extractCodeRegions(input);
    strictEqual(/`x`/.test(out), true);
    strictEqual(/```bash/.test(out), true);
  });
});
