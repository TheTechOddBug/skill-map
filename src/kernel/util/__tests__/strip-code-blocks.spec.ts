import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert/strict';

import { stripCodeBlocks } from '../strip-code-blocks.js';

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
