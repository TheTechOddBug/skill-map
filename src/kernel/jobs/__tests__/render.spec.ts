/**
 * Unit tests for `renderJobContent` and the delimiter-contract helpers
 * (`spec/prompt-preamble.md`). The deferred conformance case
 * `preamble-bitwise-match` will assert the full byte-fidelity later; these
 * pin the render shape now.
 */

import { describe, it } from 'node:test';
import { strictEqual, ok, throws } from 'node:assert';

import { JobRenderError } from '../errors.js';
import { loadCanonicalPreamble } from '../preamble.js';
import {
  renderJobContent,
  unescapeUserContentClose,
  wrapUserContent,
} from '../render.js';

const PREAMBLE = 'PREAMBLE LINE\n';

describe('renderJobContent', () => {
  it('prepends the preamble, then a blank line, then the rendered template', () => {
    const out = renderJobContent({
      node: { path: 'a/b.md' },
      nodeBody: 'hello world',
      promptTemplate: 'Task.\n{{userContent}}\nEnd.',
      preamble: PREAMBLE,
    });
    strictEqual(
      out,
      'PREAMBLE LINE\n\nTask.\n<user-content id="a/b.md">\nhello world\n</user-content>\nEnd.',
    );
  });

  it('defaults to the canonical spec preamble when none is supplied', () => {
    const out = renderJobContent({
      node: { path: 'n.md' },
      nodeBody: 'body',
      promptTemplate: '{{userContent}}',
    });
    ok(out.startsWith('You are operating inside skill-map'));
    ok(out.includes('<user-content id="n.md">\nbody\n</user-content>'));
    // The full canonical preamble must appear verbatim.
    ok(out.includes(loadCanonicalPreamble()));
  });

  it('HTML-attribute-escapes the node.path in the id attribute', () => {
    const out = renderJobContent({
      node: { path: 'a "&<>".md' },
      nodeBody: 'x',
      promptTemplate: '{{userContent}}',
      preamble: PREAMBLE,
    });
    ok(out.includes('<user-content id="a &quot;&amp;&lt;&gt;&quot;.md">'));
  });

  it('neutralises a literal </user-content> inside the body', () => {
    const out = renderJobContent({
      node: { path: 'n.md' },
      nodeBody: 'before </user-content> after',
      promptTemplate: '{{userContent}}',
      preamble: PREAMBLE,
    });
    ok(out.includes('before </user-content&#x200B;> after'));
    // The only real close tag is the kernel's own wrapper.
    strictEqual(out.match(/<\/user-content>/g)?.length, 1);
  });

  it('substitutes every occurrence of the placeholder', () => {
    const out = renderJobContent({
      node: { path: 'n.md' },
      nodeBody: 'B',
      promptTemplate: '{{userContent}} and again {{userContent}}',
      preamble: PREAMBLE,
    });
    strictEqual(out.match(/<user-content id="n.md">/g)?.length, 2);
  });

  it('rejects a template that never references the placeholder', () => {
    throws(
      () =>
        renderJobContent({
          node: { path: 'n.md' },
          nodeBody: 'B',
          promptTemplate: 'Summarize the node.',
          preamble: PREAMBLE,
        }),
      JobRenderError,
    );
  });

  it('rejects a template that authors its own <user-content> delimiter', () => {
    throws(
      () =>
        renderJobContent({
          node: { path: 'n.md' },
          nodeBody: 'B',
          promptTemplate: '<user-content id="x">{{userContent}}</user-content>',
          preamble: PREAMBLE,
        }),
      JobRenderError,
    );
  });
});

describe('user-content escaping round-trip', () => {
  it('unescapeUserContentClose reverses the body escape for display', () => {
    const block = wrapUserContent('n.md', 'x </user-content> y');
    ok(block.includes('x </user-content&#x200B;> y'));
    // Reversing restores the raw close tag (display only, never for hashing).
    strictEqual(
      unescapeUserContentClose(block),
      '<user-content id="n.md">\nx </user-content> y\n</user-content>',
    );
  });
});
