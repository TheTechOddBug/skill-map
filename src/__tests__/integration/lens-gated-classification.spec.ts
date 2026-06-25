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
 * Scan once per lens and assert the resulting nodes. `agent-skills` is
 * `gatedByActiveLens` (and stable, the locked open default lens), so the
 * open-standard `SKILL.md` classifies as a `skill` under `agent-skills`
 * AND under any vendor lens that COMPOSES the open-standard classifier
 * (today `codex`, which reads its skills from `.agents/skills/`). Under a
 * vendor lens that does NOT compose it (`claude`), the file falls through
 * to the universal `core/markdown` base. `core/markdown` is the only
 * non-gated base provider.
 *
 *   Under `activeProvider = 'claude'`:
 *     foo.md           -> claude/agent           (vendor active)
 *     bar.toml         -> NO NODE                (no universal claims .toml)
 *     baz/SKILL.md     -> markdown/markdown      (agent-skills gated off)
 *     random.md        -> markdown/markdown      (universal fallback)
 *
 *   Under `activeProvider = 'codex'`:
 *     foo.md           -> markdown/markdown      (claude gated off; fallback)
 *     bar.toml         -> codex/agent           (vendor active)
 *     baz/SKILL.md     -> codex/skill           (codex composes the open standard)
 *     random.md        -> markdown/markdown      (universal fallback)
 *
 *   Under `activeProvider = 'agent-skills'`:
 *     foo.md           -> markdown/markdown      (claude gated off; fallback)
 *     bar.toml         -> NO NODE                (codex gated off)
 *     baz/SKILL.md     -> agent-skills/skill     (vendor active under its lens)
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

    // bar.toml has no node: codex is gated off; no universal claims .toml.
    const bar = nodes.find((n) => n.path === '.codex/agents/bar.toml');
    strictEqual(bar, undefined, '.codex/*.toml MUST NOT produce a node under claude lens');

    // SKILL.md: agent-skills is gated off under the claude lens, so the
    // file falls through to the universal core/markdown fallback.
    const baz = nodes.find((n) => n.path === '.agents/skills/baz/SKILL.md');
    ok(baz, 'open-standard SKILL.md must classify under the markdown fallback when agent-skills is gated off');
    deepStrictEqual(
      { provider: baz!.provider, kind: baz!.kind },
      { provider: 'markdown', kind: 'markdown' },
    );

    // notes/random.md falls through to core/markdown universal fallback.
    const random = nodes.find((n) => n.path === 'notes/random.md');
    ok(random, 'plain markdown must classify under the markdown fallback');
    deepStrictEqual(
      { provider: random!.provider, kind: random!.kind },
      { provider: 'markdown', kind: 'markdown' },
    );
  });

  it("activeProvider='codex': codex classifies its territory, claude territory falls back to markdown", async () => {
    const nodes = await scanWithLens('codex');

    // bar.toml classifies as codex/agent (vendor active under this lens).
    const bar = nodes.find((n) => n.path === '.codex/agents/bar.toml');
    ok(bar, 'codex territory file must be classified under codex lens');
    deepStrictEqual(
      { provider: bar!.provider, kind: bar!.kind },
      { provider: 'codex', kind: 'agent' },
    );

    // foo.md: claude is gated off under codex, but the file is still .md
    // so core/markdown's universal fallback claims it.
    const foo = nodes.find((n) => n.path === '.claude/agents/foo.md');
    ok(foo, '.claude/*.md must still classify via core/markdown fallback under codex lens');
    deepStrictEqual(
      { provider: foo!.provider, kind: foo!.kind },
      { provider: 'markdown', kind: 'markdown' },
    );

    // SKILL.md: the codex provider composes the open-standard `.agents/skills/`
    // classifier (Codex reads its skills from that layout), so under the codex
    // lens the file is claimed as codex/skill, NOT the markdown fallback.
    // `agent-skills` itself stays gated off; codex owns the path here.
    const baz = nodes.find((n) => n.path === '.agents/skills/baz/SKILL.md');
    ok(baz, 'open-standard SKILL.md must classify as codex/skill under the codex lens');
    deepStrictEqual(
      { provider: baz!.provider, kind: baz!.kind },
      { provider: 'codex', kind: 'skill' },
    );

    // notes/random.md still falls through to the universal markdown fallback.
    const random = nodes.find((n) => n.path === 'notes/random.md');
    ok(random, 'plain markdown must classify under the markdown fallback');
    deepStrictEqual(
      { provider: random!.provider, kind: random!.kind },
      { provider: 'markdown', kind: 'markdown' },
    );
  });

  it("activeProvider='agent-skills': the open-standard SKILL.md classifies under its own lens", async () => {
    const nodes = await scanWithLens('agent-skills');

    // Under the agent-skills lens the gated provider opens up and claims
    // the open-standard path as a `skill` node. The scan uses
    // `extensions: builtIns()`, so agent-skills is present (the kernel
    // run does not apply the stability filter); only the active-lens gate
    // decides, and here it is satisfied.
    const baz = nodes.find((n) => n.path === '.agents/skills/baz/SKILL.md');
    ok(baz, 'open-standard SKILL.md must classify as a skill under the agent-skills lens');
    deepStrictEqual(
      { provider: baz!.provider, kind: baz!.kind },
      { provider: 'agent-skills', kind: 'skill' },
    );

    // claude is gated off under this lens, so foo.md falls back to markdown.
    const foo = nodes.find((n) => n.path === '.claude/agents/foo.md');
    ok(foo, '.claude/*.md must classify via core/markdown fallback under the agent-skills lens');
    deepStrictEqual(
      { provider: foo!.provider, kind: foo!.kind },
      { provider: 'markdown', kind: 'markdown' },
    );

    // bar.toml has no node: codex is gated off; no universal claims .toml.
    const bar = nodes.find((n) => n.path === '.codex/agents/bar.toml');
    strictEqual(bar, undefined, '.codex/*.toml MUST NOT produce a node under the agent-skills lens');

    // notes/random.md still falls through to the universal markdown fallback.
    const random = nodes.find((n) => n.path === 'notes/random.md');
    ok(random, 'plain markdown must classify under the markdown fallback');
    deepStrictEqual(
      { provider: random!.provider, kind: random!.kind },
      { provider: 'markdown', kind: 'markdown' },
    );
  });
});
