/**
 * Integration: end-to-end coverage of lens-gated provider classification
 * (spec § Active-lens scope for providers, architecture.md).
 *
 * Fixture lays down one file under every Provider's territory so we can
 * exercise the four classification outcomes:
 *
 *   - `.claude/agents/foo.md`            -> Claude vendor territory
 *   - `.codex/agents/bar.toml`           -> Codex vendor territory
 *   - `.agents/skills/baz/SKILL.md`      -> open-standard universal
 *   - `notes/random.md`                  -> universal markdown fallback
 *
 * Scan twice (once per vendor lens) and assert the resulting nodes:
 *
 *   Under `activeProvider = 'claude'`:
 *     foo.md           -> claude/agent           (vendor active)
 *     bar.toml         -> NO NODE                (no universal claims .toml)
 *     baz/SKILL.md     -> agent-skills/skill     (universal, always runs)
 *     random.md        -> markdown/markdown      (universal fallback)
 *
 *   Under `activeProvider = 'openai'`:
 *     foo.md           -> markdown/markdown      (claude gated off; fallback)
 *     bar.toml         -> openai/agent           (vendor active)
 *     baz/SKILL.md     -> agent-skills/skill     (universal, always runs)
 *     random.md        -> markdown/markdown      (universal fallback)
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan } from '../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../plugins/built-ins.js';
import type { Node } from '../../kernel/types.js';

let fixture: string;

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-lens-gated-'));
  const write = (rel: string, body: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  };

  write(
    '.claude/agents/foo.md',
    ['---', 'name: foo', 'description: A Claude agent', '---', 'Body.'].join('\n'),
  );
  // Codex sub-agent stored as TOML structured frontmatter (no body).
  write(
    '.codex/agents/bar.toml',
    ['name = "bar"', 'description = "A Codex agent"', ''].join('\n'),
  );
  write(
    '.agents/skills/baz/SKILL.md',
    ['---', 'name: baz', 'description: An open-standard skill', '---', 'Body.'].join('\n'),
  );
  write('notes/random.md', '# random');
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

interface IClassifiedNode {
  path: string;
  provider: string;
  kind: string;
}

function summarise(nodes: readonly Node[]): IClassifiedNode[] {
  return nodes
    .map((n) => ({ path: n.path, provider: n.provider, kind: n.kind }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function scanWithLens(activeProvider: string): Promise<IClassifiedNode[]> {
  const kernel = createKernel();
  for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
  const result = await runScan(kernel, {
    roots: [fixture],
    extensions: builtIns(),
    activeProvider,
  });
  return summarise(result.nodes);
}

describe('lens-gated classification (integration)', () => {
  it("activeProvider='claude': claude classifies its territory, codex is invisible", async () => {
    const nodes = await scanWithLens('claude');

    // foo.md classifies as claude/agent (vendor active under this lens).
    const foo = nodes.find((n) => n.path === '.claude/agents/foo.md');
    ok(foo, 'claude territory file must be classified under claude lens');
    deepStrictEqual(
      { provider: foo!.provider, kind: foo!.kind },
      { provider: 'claude', kind: 'agent' },
    );

    // bar.toml has no node: openai is gated off; no universal claims .toml.
    const bar = nodes.find((n) => n.path === '.codex/agents/bar.toml');
    strictEqual(bar, undefined, '.codex/*.toml MUST NOT produce a node under claude lens');

    // SKILL.md from the open standard ALWAYS classifies via agent-skills.
    const baz = nodes.find((n) => n.path === '.agents/skills/baz/SKILL.md');
    ok(baz, 'open-standard SKILL.md must classify regardless of lens');
    deepStrictEqual(
      { provider: baz!.provider, kind: baz!.kind },
      { provider: 'agent-skills', kind: 'skill' },
    );

    // notes/random.md falls through to core/markdown universal fallback.
    const random = nodes.find((n) => n.path === 'notes/random.md');
    ok(random, 'plain markdown must classify under the markdown fallback');
    deepStrictEqual(
      { provider: random!.provider, kind: random!.kind },
      { provider: 'markdown', kind: 'markdown' },
    );
  });

  it("activeProvider='openai': codex classifies its territory, claude territory falls back to markdown", async () => {
    const nodes = await scanWithLens('openai');

    // bar.toml classifies as openai/agent (vendor active under this lens).
    const bar = nodes.find((n) => n.path === '.codex/agents/bar.toml');
    ok(bar, 'codex territory file must be classified under openai lens');
    deepStrictEqual(
      { provider: bar!.provider, kind: bar!.kind },
      { provider: 'openai', kind: 'agent' },
    );

    // foo.md: claude is gated off under openai, but the file is still .md
    // so core/markdown's universal fallback claims it.
    const foo = nodes.find((n) => n.path === '.claude/agents/foo.md');
    ok(foo, '.claude/*.md must still classify via core/markdown fallback under openai lens');
    deepStrictEqual(
      { provider: foo!.provider, kind: foo!.kind },
      { provider: 'markdown', kind: 'markdown' },
    );

    // SKILL.md from the open standard ALWAYS classifies via agent-skills.
    const baz = nodes.find((n) => n.path === '.agents/skills/baz/SKILL.md');
    ok(baz, 'open-standard SKILL.md must classify regardless of lens');
    deepStrictEqual(
      { provider: baz!.provider, kind: baz!.kind },
      { provider: 'agent-skills', kind: 'skill' },
    );

    // notes/random.md still falls through to the universal markdown fallback.
    const random = nodes.find((n) => n.path === 'notes/random.md');
    ok(random, 'plain markdown must classify under the markdown fallback');
    deepStrictEqual(
      { provider: random!.provider, kind: random!.kind },
      { provider: 'markdown', kind: 'markdown' },
    );
  });
});
