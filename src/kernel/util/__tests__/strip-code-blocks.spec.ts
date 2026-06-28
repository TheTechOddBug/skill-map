import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert/strict';

import {
  extractCodeRegions,
  findBacktickImbalance,
  stripCodeAndHtml,
  stripCodeBlocks,
  stripHtml,
} from '../strip-code-blocks.js';

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

  it('blanks HTML (independent of stripCodeBlocks, so the mask never resurrects it)', () => {
    // Critical invariant: stripHtml is NOT folded into stripCodeBlocks, so
    // a backticked path hiding next to HTML in the mask is unaffected and
    // HTML never counts as a code region for backtick-path.
    const input = 'A <a href="x">tag</a> and `refs/a.md`.';
    const out = extractCodeRegions(input);
    strictEqual(/href/.test(out), false); // HTML not a code region
    strictEqual(out.includes('refs/a.md'), true); // backtick path survives
  });
});

describe('stripHtml', () => {
  it('returns empty input untouched', () => {
    strictEqual(stripHtml(''), '');
  });

  it('leaves HTML-free prose unchanged', () => {
    const input = 'See [a](b.md) and @handle, no html here.';
    strictEqual(stripHtml(input), input);
  });

  it('blanks a markdown link commented out with an HTML comment', () => {
    const input = 'Live [a](a.md) but <!-- [old](old.md) --> is dead.';
    const out = stripHtml(input);
    strictEqual(out.length, input.length);
    strictEqual(/\[old\]/.test(out), false);
    strictEqual(/old\.md/.test(out), false);
    strictEqual(/\[a\]\(a\.md\)/.test(out), true); // real link survives
  });

  it('blanks a multi-line HTML comment but preserves line count', () => {
    const input = ['Before.', '<!--', '[x](x.md)', '-->', 'After.'].join('\n');
    const out = stripHtml(input);
    strictEqual(out.split('\n').length, 5);
    strictEqual(/x\.md/.test(out), false);
    strictEqual(out.split('\n')[0], 'Before.');
    strictEqual(out.split('\n')[4], 'After.');
  });

  it('blanks a link-shaped token hiding in an attribute value', () => {
    const input = 'Img: <img src="d.png" alt="[see](ref.md)"> done.';
    const out = stripHtml(input);
    strictEqual(/\[see\]/.test(out), false);
    strictEqual(/ref\.md/.test(out), false);
    strictEqual(out.length, input.length);
  });

  it('blanks tag tokens but keeps markdown nested between open and close tags', () => {
    const input = '<div align="center">\n\n[real](real.md)\n\n</div>';
    const out = stripHtml(input);
    strictEqual(/<div/.test(out), false);
    strictEqual(/<\/div>/.test(out), false);
    strictEqual(/\[real\]\(real\.md\)/.test(out), true);
  });

  it('handles `>` inside a quoted attribute value', () => {
    const input = '<a title="a > b" href="x">';
    const out = stripHtml(input);
    strictEqual(out.trim(), '');
    strictEqual(out.length, input.length);
  });

  it('does not treat non-tag `<` in prose as HTML', () => {
    const input = 'If a < b and x <3 y then [k](k.md) holds.';
    const out = stripHtml(input);
    strictEqual(out, input);
  });
});

describe('stripCodeAndHtml', () => {
  it('blanks code regions and HTML in one pass, preserving length', () => {
    const input = 'Run `@team` and <!-- [x](x.md) --> and <img alt="[y](y.md)"> but [z](z.md) stays.';
    const out = stripCodeAndHtml(input);
    strictEqual(out.length, input.length);
    strictEqual(/@team/.test(out), false); // code span gone
    strictEqual(/x\.md/.test(out), false); // html comment gone
    strictEqual(/y\.md/.test(out), false); // attribute gone
    strictEqual(/\[z\]\(z\.md\)/.test(out), true); // real prose link survives
  });
});

describe('findBacktickImbalance', () => {
  it('returns null for empty / code-free prose', () => {
    strictEqual(findBacktickImbalance(''), null);
    strictEqual(findBacktickImbalance('plain prose, no backticks'), null);
  });

  it('returns null when an inline span and a fence are balanced', () => {
    const body = 'A `inline` span\n\n```js\nconst a = 1;\n```\n\nDone.';
    strictEqual(findBacktickImbalance(body), null);
  });

  it('flags an unclosed fenced block at the opening fence line', () => {
    const body = 'intro\n```js\nconst a = `x\nmore code\n';
    const r = findBacktickImbalance(body);
    strictEqual(r?.kind, 'fence');
    strictEqual(r?.line, 2);
  });

  it('flags an unclosed inline backtick at its line, with the source line', () => {
    const body = 'one\ntwo\nthree `oops\n';
    const r = findBacktickImbalance(body);
    strictEqual(r?.kind, 'inline');
    strictEqual(r?.line, 3);
    strictEqual(r?.sourceLine, 'three `oops');
  });

  // Regression: a 3-backtick fence shown INSIDE a 4-backtick wrapper is
  // valid (stripCodeBlocks closes the outer on length >= rule). The old
  // analyzer's `ch === fenceChar` close (length-blind) mis-fired here.
  it('does NOT flag a fence nested inside a longer wrapper fence', () => {
    const body = '````md\nTo start a code block, type:\n```\n````\n';
    strictEqual(findBacktickImbalance(body), null);
    // And the policy it protects agrees the block is fully stripped.
    strictEqual(/type:/.test(stripCodeBlocks(body)), false);
  });

  it('treats a backslash-escaped backtick as literal text (no false positive)', () => {
    strictEqual(findBacktickImbalance('A literal \\` backtick stays plain.'), null);
  });

  it('treats a 4-space-indented ``` as a NON-fence (CommonMark indent rule)', () => {
    // FENCE_RE allows up to 3 spaces of indent; 4 spaces is an indented
    // code block, NOT a fence opener (matches stripCodeBlocks). So this
    // never opens a fence that swallows the rest of the file; the leftover
    // run reads as an unclosed inline backtick, never `kind: 'fence'`.
    const r = findBacktickImbalance('prose\n    ```\nmore prose');
    strictEqual(r?.kind, 'inline');
  });

  it('returns null for a double-backtick span wrapping a literal backtick', () => {
    strictEqual(findBacktickImbalance('Use ``code ` here`` to wrap.'), null);
  });
});
