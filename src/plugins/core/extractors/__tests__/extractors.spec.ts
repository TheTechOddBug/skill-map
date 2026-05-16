import { describe, it } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';

import { annotationsExtractor } from '../annotations/index.js';
import { slashExtractor } from '../slash/index.js';
import { atDirectiveExtractor } from '../at-directive/index.js';
import { markdownLinkExtractor } from '../markdown-link/index.js';
import type { IExtractorContext, IExtractor } from '../../../../kernel/extensions/index.js';
import type { ISidecarOverlay, Link, Node } from '../../../../kernel/types.js';

function mockNode(path: string, sidecar?: ISidecarOverlay | null): Node {
  return {
    path,
    kind: 'markdown',
    provider: 'claude',
    bodyHash: 'x'.repeat(64),
    frontmatterHash: 'y'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    ...(sidecar !== undefined ? { sidecar } : {}),
  };
}

/**
 * Build a context plus a captured-links array. Mirrors what the
 * orchestrator does at runtime: the extractor emits via `ctx.emitLink`
 * and `ctx.enrichNode`, both of which the test captures into local
 * arrays for inspection.
 */
function ctx(
  path: string,
  body: string,
  frontmatter: Record<string, unknown> = {},
  sidecar?: ISidecarOverlay | null,
): { ctx: IExtractorContext; links: Link[]; enrichments: Partial<Node>[] } {
  const links: Link[] = [];
  const enrichments: Partial<Node>[] = [];
  const context: IExtractorContext = {
    node: mockNode(path, sidecar),
    body,
    frontmatter,
    settings: {},
    emitLink: (l) => links.push(l),
    enrichNode: (p) => enrichments.push(p),
    // No-op stub, captures view contributions only when a test
    // exercises the `emitContribution` path.
    emitContribution: () => undefined,
  };
  return { ctx: context, links, enrichments };
}

/**
 * Compose a sidecar overlay with the given annotations block. Saves
 * each annotations test from spelling out `present: true` + `status`
 * + `root` boilerplate.
 */
function withAnnotations(annotations: Record<string, unknown>): ISidecarOverlay {
  return { present: true, status: 'fresh', annotations, root: { annotations } };
}

// Extractors' `extract()` returns `void | Promise<void>`. Await resolves
// both uniformly and lets the test continue on the captured `links` array.
async function extract(extractor: IExtractor, context: IExtractorContext): Promise<void> {
  await extractor.extract(context);
}

describe('annotations extractor', () => {
  it('emits supersedes links from annotations.supersedes[]', async () => {
    const { ctx: context, links } = ctx(
      'a.md',
      '',
      {},
      withAnnotations({ supersedes: ['b.md', 'c.md'] }),
    );
    await extract(annotationsExtractor, context);
    deepStrictEqual(
      links.map((l) => ({ s: l.source, t: l.target, k: l.kind })),
      [{ s: 'a.md', t: 'b.md', k: 'supersedes' }, { s: 'a.md', t: 'c.md', k: 'supersedes' }],
    );
  });

  it('inverts supersededBy so the edge points from the new node', async () => {
    const { ctx: context, links } = ctx(
      'old.md',
      '',
      {},
      withAnnotations({ supersededBy: 'new.md' }),
    );
    await extract(annotationsExtractor, context);
    strictEqual(links.length, 1);
    strictEqual(links[0]?.source, 'new.md');
    strictEqual(links[0]?.target, 'old.md');
    strictEqual(links[0]?.kind, 'supersedes');
  });

  it('emits nothing when no sidecar is present', async () => {
    const { ctx: context, links } = ctx('a.md', '', {});
    await extract(annotationsExtractor, context);
    deepStrictEqual(links, []);
  });

  it('emits nothing when sidecar is present but the annotations block is empty', async () => {
    const { ctx: context, links } = ctx(
      'a.md',
      '',
      {},
      { present: true, status: 'fresh', annotations: null, root: {} },
    );
    await extract(annotationsExtractor, context);
    deepStrictEqual(links, []);
  });

  it('ignores legacy frontmatter `metadata:` (sidecar is the only source)', async () => {
    // Post-fallback-drop guard: the legacy `metadata:` block in the
    // frontmatter of unmigrated nodes used to feed this extractor;
    // those edges must now be silently ignored.
    const { ctx: context, links } = ctx(
      'a.md',
      '',
      { metadata: { supersedes: ['b.md', 'c.md'] } },
    );
    await extract(annotationsExtractor, context);
    deepStrictEqual(links, []);
  });

  it('filters out non-string entries silently', async () => {
    const { ctx: context, links } = ctx(
      'a.md',
      '',
      {},
      withAnnotations({ supersedes: ['b.md', 42, null, ''] }),
    );
    await extract(annotationsExtractor, context);
    strictEqual(links.length, 1);
    strictEqual(links[0]?.target, 'b.md');
  });

  it('emits the right manifest shape', () => {
    strictEqual(annotationsExtractor.id, 'annotations');
    strictEqual(annotationsExtractor.pluginId, 'core');
    // Structure-as-truth: `emitsLinkKinds` / `defaultConfidence` were
    // retired. Per-emit confidence on `ctx.emitLink` is the contract.
    strictEqual(annotationsExtractor.scope, 'frontmatter');
  });
});

describe('slash extractor', () => {
  it('extracts /command tokens from body', async () => {
    const { ctx: context, links } = ctx('a.md', 'Run /deploy or /rollback when ready.');
    await extract(slashExtractor, context);
    strictEqual(links.length, 2);
    const targets = links.map((l) => l.trigger?.normalizedTrigger).sort();
    deepStrictEqual(targets, ['/deploy', '/rollback']);
  });

  it('dedupes repeated invocations', async () => {
    const { ctx: context, links } = ctx('a.md', '/deploy then /deploy again.');
    await extract(slashExtractor, context);
    strictEqual(links.length, 1);
  });

  it('does not match mid-word slashes (paths)', async () => {
    const { ctx: context, links } = ctx('a.md', 'See src/cli/entry.ts for details.');
    await extract(slashExtractor, context);
    strictEqual(links.length, 0);
  });

  it('does not match slashes after `.` (markdown relative links / dotfiles)', async () => {
    const { ctx: context, links } = ctx(
      'a.md',
      'Link to [docs](./readme.md) and [parent](../README.md). Domain at example.com/api.',
    );
    await extract(slashExtractor, context);
    strictEqual(links.length, 0);
  });

  it('does not match absolute filesystem paths (multi-segment after the slash)', async () => {
    // Reproduces the tester finding: `Cwd: /Volumes/macintoshexterno/...`
    // used to emit a broken `/Volumes` invokes link. With the new
    // negative-lookahead `(?!/)` the first slash-token whose next
    // char is another `/` is rejected as part of a path.
    const { ctx: context, links } = ctx(
      'a.md',
      'Cwd: /Volumes/macintoshexterno/Developer\nAPI at /api/v1/items.',
    );
    await extract(slashExtractor, context);
    strictEqual(links.length, 0, 'no path segment should land as an invokes link');
  });

  it('does not match tokens inside fenced code blocks', async () => {
    // Authors fence code regions explicitly to mean "literal payload,
    // not invocation surface". Every LLM-driven runtime reads it the
    // same way; the extractor now mirrors that.
    const { ctx: context, links } = ctx(
      'a.md',
      ['Run /real-command outside.', '```', '/inside-fence', '```'].join('\n'),
    );
    await extract(slashExtractor, context);
    strictEqual(links.length, 1);
    strictEqual(links[0]?.trigger?.originalTrigger, '/real-command');
  });

  it('does not match tokens inside inline code spans', async () => {
    const { ctx: context, links } = ctx(
      'a.md',
      'Type `/inside-backticks` then run /outside-backticks.',
    );
    await extract(slashExtractor, context);
    strictEqual(links.length, 1);
    strictEqual(links[0]?.trigger?.originalTrigger, '/outside-backticks');
  });

  it('does not match slashes after `:` (URL schemes / drive letters)', async () => {
    const { ctx: context, links } = ctx(
      'a.md',
      'Visit https://example.com/path and the file at c:/Windows/foo.',
    );
    await extract(slashExtractor, context);
    strictEqual(links.length, 0);
  });

  it('supports namespaced commands (/ns:verb)', async () => {
    const { ctx: context, links } = ctx('a.md', 'Run /skill-map:explore please.');
    await extract(slashExtractor, context);
    strictEqual(links.length, 1);
    strictEqual(links[0]?.trigger?.originalTrigger, '/skill-map:explore');
  });

  it('normalizes case + hyphens for collision detection', async () => {
    const { ctx: context, links } = ctx('a.md', 'Try /My-Command here.');
    await extract(slashExtractor, context);
    strictEqual(links[0]?.trigger?.normalizedTrigger, '/my command');
  });

  it('emits the right manifest shape', () => {
    strictEqual(slashExtractor.id, 'slash');
    strictEqual(slashExtractor.pluginId, 'core');
    // emitsLinkKinds / defaultConfidence retired per structure-as-truth refactor.
    strictEqual(slashExtractor.scope, 'body');
  });
});

describe('at-directive extractor', () => {
  it('extracts @handle tokens', async () => {
    const { ctx: context, links } = ctx('a.md', 'Ask @backend-architect and @security-auditor.');
    await extract(atDirectiveExtractor, context);
    strictEqual(links.length, 2);
  });

  it('does not match email addresses', async () => {
    const { ctx: context, links } = ctx('a.md', 'Contact foo@bar.com if needed.');
    await extract(atDirectiveExtractor, context);
    strictEqual(links.length, 0);
  });

  it('supports namespaced handles (@scope/name and @ns:verb)', async () => {
    const slash = ctx('a.md', 'Via @my-plugin/foo-extractor.');
    await extract(atDirectiveExtractor, slash.ctx);
    strictEqual(slash.links[0]?.trigger?.originalTrigger, '@my-plugin/foo-extractor');
    const colon = ctx('a.md', 'Or @skill-map:explore works too.');
    await extract(atDirectiveExtractor, colon.ctx);
    strictEqual(colon.links[0]?.trigger?.originalTrigger, '@skill-map:explore');
  });

  it('dedupes on normalized trigger', async () => {
    const { ctx: context, links } = ctx('a.md', '@Agent and @AGENT and @agent.');
    await extract(atDirectiveExtractor, context);
    strictEqual(links.length, 1);
  });

  it('emits the right manifest shape', () => {
    strictEqual(atDirectiveExtractor.id, 'at-directive');
    strictEqual(atDirectiveExtractor.pluginId, 'core');
    // emitsLinkKinds / defaultConfidence retired per structure-as-truth refactor.
    strictEqual(atDirectiveExtractor.scope, 'body');
  });

  // The four tests below codify the LLM-aligned semantics from the
  // research note (Claude Code / Gemini CLI / Cursor all read `@name`
  // vs `@file.ext` differently): plain handles stay mentions, file-
  // flavoured tokens become references, and code regions are skipped.

  it('treats `@<name>.<ext>` as a `references` link (file-ref semantics)', async () => {
    // Reproduces the tester finding: `re-invoca @sm-tutorial.md desde
    // la misma carpeta` used to emit a broken `@sm-tutorial` mention.
    // Now it lands as a references link to `sm-tutorial.md`, the same
    // way Claude Code would resolve `@sm-tutorial.md` as a file ref.
    const { ctx: context, links } = ctx(
      'a.md',
      'Re-invoke @sm-tutorial.md from the same folder.',
    );
    await extract(atDirectiveExtractor, context);
    strictEqual(links.length, 1);
    strictEqual(links[0]?.kind, 'references');
    strictEqual(links[0]?.target, 'sm-tutorial.md');
    strictEqual(links[0]?.trigger?.originalTrigger, '@sm-tutorial.md');
  });

  it('treats `@<dir>/<file>.<ext>` as a `references` link', async () => {
    const { ctx: context, links } = ctx(
      'a.md',
      'See @docs/api/v1.md for the schema.',
    );
    await extract(atDirectiveExtractor, context);
    strictEqual(links.length, 1);
    strictEqual(links[0]?.kind, 'references');
    strictEqual(links[0]?.target, 'docs/api/v1.md');
  });

  it('treats `@./<file>` and `@../<file>` as `references` links', async () => {
    const relative = ctx('a.md', 'Inline @./sibling.md and @../parent/file.md.');
    await extract(atDirectiveExtractor, relative.ctx);
    strictEqual(relative.links.length, 2);
    strictEqual(relative.links[0]?.kind, 'references');
    strictEqual(relative.links[0]?.target, 'sibling.md');
    strictEqual(relative.links[1]?.kind, 'references');
    strictEqual(relative.links[1]?.target, '../parent/file.md');
  });

  it('does not match tokens inside fenced or inline code', async () => {
    const { ctx: context, links } = ctx(
      'a.md',
      [
        'Outside: @real-handle.',
        '```',
        '@fenced-handle',
        '@fenced-file.md',
        '```',
        'Inline `@backticked` is skipped too.',
      ].join('\n'),
    );
    await extract(atDirectiveExtractor, context);
    strictEqual(links.length, 1);
    strictEqual(links[0]?.trigger?.originalTrigger, '@real-handle');
  });
});

// Cross-provider invariant: the extractors live in `core/` and run
// over the node body regardless of which Provider classified the
// node. The contract we check below is: for the SAME prose body,
// the SAME set of links lands no matter whether the host file is
// under `.claude/`, `.gemini/`, or `.agents/skills/`. This is what
// "agnostic" actually means in skill-map, and it's how the tester
// can trust that fixing the extractor once fixes the experience
// for every supported runtime.
describe('cross-provider invariance (claude / gemini / agent-skills)', () => {
  // Single body that exercises every branch the LLM-aligned semantics
  // care about: bare mention, namespaced mention, file ref by ext,
  // file ref by path, code-block silence, slash command, slash path.
  const BODY = [
    'See @backend-architect about this.',
    'Use @my-plugin/foo-extractor for the heavy lift.',
    'Reference @docs/api/v1.md and the local @./readme.md.',
    'Inline literal: `@inside-code` and `/inside-code` must NOT register.',
    '```',
    '@fenced-too',
    '/fenced-cmd',
    '```',
    'Run /scan when ready; ignore /Volumes/disk paths.',
  ].join('\n');

  // The provider is purely metadata on the node, not an input to the
  // extractor. Looping over it documents the invariant.
  const PROVIDERS = ['claude', 'gemini', 'agent-skills'] as const;

  for (const provider of PROVIDERS) {
    it(`emits the same links under provider="${provider}"`, async () => {
      const node: Node = {
        path: 'host.md',
        kind: 'markdown',
        provider,
        bodyHash: 'x'.repeat(64),
        frontmatterHash: 'y'.repeat(64),
        bytes: { frontmatter: 0, body: 0, total: 0 },
        linksOutCount: 0,
        linksInCount: 0,
        externalRefsCount: 0,
      };
      const links: Link[] = [];
      const baseCtx: IExtractorContext = {
        node,
        body: BODY,
        frontmatter: {},
        settings: {},
        emitLink: (l) => links.push(l),
        enrichNode: () => undefined,
        emitContribution: () => undefined,
      };

      await extract(atDirectiveExtractor, baseCtx);
      await extract(slashExtractor, baseCtx);

      const triggers = links.map((l) => `${l.kind}:${l.trigger?.originalTrigger ?? l.target}`).sort();
      deepStrictEqual(triggers, [
        'invokes:/scan',
        'mentions:@backend-architect',
        'mentions:@my-plugin/foo-extractor',
        'references:@./readme.md',
        'references:@docs/api/v1.md',
      ]);
    });
  }
});

describe('markdown-link extractor', () => {
  it('resolves [text](./sibling.md) against the source dir', async () => {
    const { ctx: context, links } = ctx('docs/overview.md', 'See [api](./api.md) for details.');
    await extract(markdownLinkExtractor, context);
    strictEqual(links.length, 1);
    strictEqual(links[0]?.target, 'docs/api.md');
    strictEqual(links[0]?.kind, 'references');
    strictEqual(links[0]?.confidence, 'high');
    strictEqual(links[0]?.trigger?.originalTrigger, './api.md');
  });

  it('resolves [text](../parent.md) one directory up', async () => {
    const { ctx: context, links } = ctx('docs/api/v1.md', '[parent](../README.md)');
    await extract(markdownLinkExtractor, context);
    strictEqual(links.length, 1);
    strictEqual(links[0]?.target, 'docs/README.md');
  });

  it('resolves bare paths without leading ./', async () => {
    const { ctx: context, links } = ctx('docs/overview.md', '[bare](api.md)');
    await extract(markdownLinkExtractor, context);
    strictEqual(links.length, 1);
    strictEqual(links[0]?.target, 'docs/api.md');
  });

  it('strips #anchor and ?query from the target before resolving', async () => {
    const { ctx: context, links } = ctx(
      'docs/overview.md',
      '[a](./api.md#install) and [b](./api.md?v=1)',
    );
    await extract(markdownLinkExtractor, context);
    // Both resolve to the same target; dedup keeps one.
    strictEqual(links.length, 1);
    strictEqual(links[0]?.target, 'docs/api.md');
  });

  it('skips image syntax ![alt](path)', async () => {
    const { ctx: context, links } = ctx('a.md', 'Below: ![diagram](./diagram.png)');
    await extract(markdownLinkExtractor, context);
    strictEqual(links.length, 0);
  });

  it('skips URL schemes (http, mailto, tel), those are not file paths', async () => {
    const { ctx: context, links } = ctx(
      'a.md',
      '[home](https://example.com) [mail](mailto:a@b.c) [phone](tel:+1) [data](data:text/plain,foo)',
    );
    await extract(markdownLinkExtractor, context);
    strictEqual(links.length, 0);
  });

  it('skips fragment-only links (#section)', async () => {
    const { ctx: context, links } = ctx('a.md', 'Jump to [section](#install) below.');
    await extract(markdownLinkExtractor, context);
    strictEqual(links.length, 0);
  });

  it('skips absolute paths starting with /', async () => {
    const { ctx: context, links } = ctx('a.md', '[absolute](/etc/foo.md)');
    await extract(markdownLinkExtractor, context);
    strictEqual(links.length, 0);
  });

  it('dedupes repeated links to the same resolved target', async () => {
    const { ctx: context, links } = ctx(
      'docs/overview.md',
      '[a](./api.md) and again [b](./api.md) and once more [c](api.md)',
    );
    await extract(markdownLinkExtractor, context);
    strictEqual(links.length, 1);
  });

  it('honours the optional CommonMark "title" syntax: [text](path "title")', async () => {
    const { ctx: context, links } = ctx('a.md', '[doc](./api.md "API reference")');
    await extract(markdownLinkExtractor, context);
    strictEqual(links.length, 1);
    strictEqual(links[0]?.target, 'api.md');
  });

  it('captures the line number in the location field', async () => {
    const { ctx: context, links } = ctx(
      'a.md',
      'first line\nsecond line\n[link](./foo.md)\nfourth',
    );
    await extract(markdownLinkExtractor, context);
    strictEqual(links.length, 1);
    strictEqual(links[0]?.location?.line, 3);
  });

  it('emits the right manifest shape', () => {
    strictEqual(markdownLinkExtractor.id, 'markdown-link');
    strictEqual(markdownLinkExtractor.pluginId, 'core');
    // emitsLinkKinds / defaultConfidence retired per structure-as-truth refactor.
    strictEqual(markdownLinkExtractor.scope, 'body');
  });
});
