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

  /**
   * NODELESS render (`spec/job-lifecycle.md` §Submit · Nodeless submit):
   * no body means no `<user-content>` block at all, not an empty one. The
   * seam still carries the kernel prelude.
   */
  it('emits no user-content block for a nodeless job', () => {
    const out = renderJobContent({
      node: { path: 'sm://core/ai-ping-action' },
      nodeBody: null,
      promptTemplate: 'Task.\n{{userContent}}\nEnd.',
      preamble: PREAMBLE,
      reportContract: '## Report contract',
    });
    strictEqual(out, 'PREAMBLE LINE\n\nTask.\n## Report contract\nEnd.');
    ok(!out.includes('<user-content'));
    // The synthetic id never leaks into the prompt either: with no block
    // to attribute, there is nothing to name.
    ok(!out.includes('sm://core/ai-ping-action'));
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

  /**
   * Skill-instructions seam placement (`spec/job-lifecycle.md` §Submit
   * step 9; `spec/skill-actions.md`): the skill section expands FIRST
   * among the seam sections, before findings / current tags / report
   * contract, and always OUTSIDE the `<user-content>` block.
   */
  it('renders the skill section first at the seam, outside the delimiter', () => {
    const out = renderJobContent({
      node: { path: 'n.md' },
      nodeBody: 'BODY',
      promptTemplate: 'Task.\n{{userContent}}\nEnd.',
      preamble: PREAMBLE,
      skillSection: '## Skill instructions\n\nSKILL BODY',
      findingsSection: '## Findings to resolve',
      currentTagsSection: '## Current tags',
      reportContract: '## Report contract',
    });
    strictEqual(
      out,
      'PREAMBLE LINE\n\nTask.\n' +
        '## Skill instructions\n\nSKILL BODY\n\n' +
        '## Findings to resolve\n\n' +
        '## Current tags\n\n' +
        '## Report contract\n\n' +
        '<user-content id="n.md">\nBODY\n</user-content>\nEnd.',
    );
    // The skill body sits OUTSIDE the delimiter block.
    ok(out.indexOf('SKILL BODY') < out.indexOf('<user-content'));
  });

  it('template validation is unaffected by a skill section (the section is not a template)', () => {
    // The canonical wrapper IS the template and must carry the
    // placeholder; the skill section never passes validateTemplate, so a
    // section full of delimiter-looking text renders fine while a
    // placeholder-less TEMPLATE still rejects.
    throws(
      () =>
        renderJobContent({
          node: { path: 'n.md' },
          nodeBody: 'B',
          promptTemplate: 'No placeholder here.',
          preamble: PREAMBLE,
          skillSection: '## Skill instructions\n\nX',
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

  it('neutralises case / whitespace variants of the close tag (injection escape)', () => {
    // Tag semantics are case-insensitive to HTML consumers and LLMs, so an
    // attacker-cased or padded close tag must not survive verbatim
    // (spec/prompt-preamble.md §Delimiter contract rule 2).
    const variants = [
      '</USER-CONTENT>',
      '</User-Content>',
      '</user-content >',
      '</ user-content>',
      '</\tuser-content\t>',
      '</USER-CONTENT >',
    ];
    for (const variant of variants) {
      const block = wrapUserContent('n.md', `x ${variant} y`);
      // No un-neutralised variant survives inside the wrapped body: the
      // ONLY genuine close tag is the kernel's own final wrapper line.
      const inner = block.slice(0, block.lastIndexOf('</user-content>'));
      ok(
        !/(<\/\s*user-content\s*)>/i.test(inner),
        `variant ${JSON.stringify(variant)} must be neutralised`,
      );
      ok(inner.includes('&#x200B;>'), 'entity inserted before the closing >');
    }
  });

  it('escape preserves the original bytes and unescape restores them exactly', () => {
    const body = 'a </USER-CONTENT> b </user-content > c </user-content> d';
    const block = wrapUserContent('n.md', body);
    // Original casing / spacing preserved (only the entity was inserted).
    ok(block.includes('</USER-CONTENT&#x200B;>'));
    ok(block.includes('</user-content &#x200B;>'));
    strictEqual(
      unescapeUserContentClose(block),
      `<user-content id="n.md">\n${body}\n</user-content>`,
    );
  });

  it('hashing input is unaffected by the display unescape (stored form keeps the entity)', () => {
    const rendered = renderJobContent({
      node: { path: 'n.md' },
      nodeBody: 'x </USER-CONTENT> y',
      promptTemplate: '{{userContent}}',
      preamble: PREAMBLE,
    });
    // The stored (hashed) form carries the neutralised tag; unescaping for
    // display yields a DIFFERENT string, proving the two forms are distinct
    // and the unescape must never run before hashing.
    ok(rendered.includes('</USER-CONTENT&#x200B;>'));
    ok(unescapeUserContentClose(rendered) !== rendered);
  });
});
