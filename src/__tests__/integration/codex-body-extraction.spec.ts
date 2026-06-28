/**
 * Integration: the OpenAI Codex body extractor (ROADMAP Step 13).
 *
 * Codex sub-agents are pure TOML under `.codex/agents/*.toml`; their
 * markdown prompt lives in the triple-quoted `developer_instructions`
 * field, not after a frontmatter fence. The codex provider declares
 * `read.bodyField: 'developer_instructions'`, so the kernel walker yields
 * that field as the node body and the normal body pipeline runs over it:
 *
 *   - `core/markdown-link` (universal) turns `[the guide](guide.md)` into a
 *     `references` edge.
 *   - `core/at-file` (the vendor-neutral `@`-file-picker extractor, gated to
 *     claude / codex / antigravity) turns a file-shaped `@builder.toml` into a
 *     path-resolved `references` edge to the other Codex agent's file. Codex's
 *     `@` is a file picker, not an agent-mention grammar, so the claude
 *     `at-directive` (bare-handle mentions) is NOT gated under codex.
 *
 * The contrast test pins the lens gate: under the `claude` lens the Codex
 * agent is not classified at all, so its developer_instructions never reach
 * any extractor and it contributes no links.
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

  // Two Codex sub-agents. `deployer`'s prompt (the TOML
  // `developer_instructions` field) references the other agent's FILE
  // (`@builder.toml`, a Codex `@`-file reference), a doc by markdown link,
  // and an external URL.
  write(
    DEPLOYER,
    [
      'name = "deployer"',
      'description = "Coordinates a release"',
      'developer_instructions = "Coordinate with @builder.toml before shipping. See [the guide](guide.md). CI at https://example.com/ci."',
    ].join('\n'),
  );
  write(
    '.codex/agents/builder.toml',
    [
      'name = "builder"',
      'description = "Builds artifacts"',
      'developer_instructions = "Just build."',
    ].join('\n'),
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

describe('Codex body extraction (read.bodyField = developer_instructions)', () => {
  it("under the codex lens, the agent's developer_instructions body feeds the link pipeline", async () => {
    const result = await scan('codex');

    // The Codex agent is classified under the codex lens.
    ok(
      result.nodes.some((n) => n.path === DEPLOYER && n.provider === 'codex'),
      'deployer.toml must classify as an codex agent',
    );

    const fromDeployer = result.links.filter((l) => l.source === DEPLOYER);
    ok(
      fromDeployer.length > 0,
      'the body extractor must surface links from the developer_instructions field',
    );

    // markdown-link (universal) parsed `[the guide](guide.md)`.
    ok(
      fromDeployer.some((l) => l.kind === 'references' && l.target.endsWith('guide.md')),
      'a markdown link in developer_instructions becomes a references edge',
    );

    // at-file (the codex `@`-file extractor) parsed `@builder.toml` and the
    // resolver path-matched it to the builder agent FILE (references). Codex's
    // `@` is a file picker, so it forms a `references` edge, not a `mentions`.
    ok(
      fromDeployer.some((l) => l.kind === 'references' && l.target.endsWith('builder.toml')),
      'a file-shaped @ token in developer_instructions becomes a references edge under the codex lens',
    );
    // And NO `mentions` edge forms (Codex has no agent-mention grammar).
    ok(
      !fromDeployer.some((l) => l.kind === 'mentions'),
      'a bare @handle does not form a mentions edge under the codex lens',
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
