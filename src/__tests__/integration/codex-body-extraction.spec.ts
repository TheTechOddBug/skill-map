/**
 * Integration: the OpenAI Codex body extractor (ROADMAP Step 13).
 *
 * Codex sub-agents are pure TOML under `.codex/agents/*.toml`; their
 * markdown prompt lives in the triple-quoted `instructions` field, not
 * after a frontmatter fence. The openai provider declares
 * `read.bodyField: 'instructions'`, so the kernel walker yields that field
 * as the node body and the normal body pipeline runs over it:
 *
 *   - `core/markdown-link` (universal) turns `[the guide](guide.md)` into a
 *     `references` edge.
 *   - `claude/at-directive` (precondition widened to `['claude','openai']`)
 *     turns `@builder` into a `mentions` edge that resolves to the other
 *     Codex agent (openai `resolution.mentions: ['agent']`).
 *
 * The contrast test pins the lens gate: under the `claude` lens the Codex
 * agent is not classified at all, so its instructions never reach any
 * extractor and it contributes no links.
 */

import { describe, it, before, after } from 'node:test';
import { ok } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan, type ScanResult } from '../../kernel/index.js';
import { builtIns, listBuiltIns } from '../../plugins/built-ins.js';

let fixture: string;

const DEPLOYER = '.codex/agents/deployer.toml';

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-codex-body-'));
  const write = (rel: string, body: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  };

  // Two Codex sub-agents. `deployer`'s prompt (the TOML `instructions`
  // field) references the other agent (`@builder`), a doc by markdown
  // link, and an external URL.
  write(
    DEPLOYER,
    [
      'name = "deployer"',
      'description = "Coordinates a release"',
      'instructions = "Coordinate with @builder before shipping. See [the guide](guide.md). CI at https://example.com/ci."',
    ].join('\n'),
  );
  write(
    '.codex/agents/builder.toml',
    ['name = "builder"', 'description = "Builds artifacts"', 'instructions = "Just build."'].join(
      '\n',
    ),
  );
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

async function scan(activeProvider: string): Promise<ScanResult> {
  const kernel = createKernel();
  for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
  return runScan(kernel, {
    roots: [fixture],
    extensions: builtIns(),
    activeProvider,
  });
}

describe('Codex body extraction (read.bodyField = instructions)', () => {
  it("under the openai lens, the agent's instructions body feeds the link pipeline", async () => {
    const result = await scan('openai');

    // The Codex agent is classified under the openai lens.
    ok(
      result.nodes.some((n) => n.path === DEPLOYER && n.provider === 'openai'),
      'deployer.toml must classify as an openai agent',
    );

    const fromDeployer = result.links.filter((l) => l.source === DEPLOYER);
    ok(
      fromDeployer.length > 0,
      'the body extractor must surface links from the instructions field',
    );

    // markdown-link (universal) parsed `[the guide](guide.md)`.
    ok(
      fromDeployer.some((l) => l.kind === 'references' && l.target.endsWith('guide.md')),
      'a markdown link in instructions becomes a references edge',
    );

    // at-directive (now authorised under openai) parsed `@builder` and the
    // resolver matched it to the builder agent (mentions -> agent).
    ok(
      fromDeployer.some((l) => l.kind === 'mentions'),
      'an @mention in instructions becomes a mentions edge under the openai lens',
    );
  });

  it('under the claude lens, the Codex agent is gated off (no node, no links)', async () => {
    const result = await scan('claude');
    ok(
      !result.nodes.some((n) => n.path === DEPLOYER),
      'a .codex/*.toml agent is not classified under the claude lens',
    );
    ok(
      !result.links.some((l) => l.source === DEPLOYER),
      'a gated-off Codex agent contributes no links',
    );
  });
});
