/**
 * Integration: OpenAI Codex skill-invocation grammar (the corrected model).
 *
 * Codex invokes a user skill with `$skill` (the codex-owned `dollar-skill`
 * extractor), reserves `/` for its OWN built-in commands (so the claude
 * `slash-command` extractor is NOT gated under codex), and uses `@` as a file
 * picker (the codex-owned `at-file` extractor turns a file-shaped `@x.toml`
 * into a `references` link, never an agent mention). A `$`-skill named like a
 * built-in command (`model`) is NOT reserved, because `$model` lives in a
 * namespace disjoint from Codex's `/model` command, so it cannot shadow it.
 *
 * End-to-end guard for the four target behaviours, run through `runScan`
 * under the codex lens.
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
const REVIEWER = '.codex/agents/reviewer.toml';
const CHECK_LINKS = '.agents/skills/check-links/SKILL.md';
const MODEL_SKILL = '.agents/skills/model/SKILL.md';

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-codex-invoke-'));
  const write = (rel: string, body: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  };
  // A Codex sub-agent whose prompt invokes a skill (`$check-links`), names a
  // built-in command (`/model`, which is NOT a skill invocation under codex),
  // and references a sibling agent FILE (`@reviewer.toml`, the file picker).
  write(
    DEPLOYER,
    [
      'name = "deployer"',
      'description = "Coordinates a release."',
      'developer_instructions = "First run $check-links. Use /model to switch models. Then brief @reviewer.toml. If unsure, $missing-skill."',
    ].join('\n'),
  );
  write(
    REVIEWER,
    ['name = "reviewer"', 'description = "Reviews the diff."', 'developer_instructions = "Review."'].join('\n'),
  );
  write(CHECK_LINKS, '---\nname: check-links\ndescription: Check internal links.\n---\n# Check links\n');
  // A skill named after a built-in `/` command. Under codex it is `$model`, a
  // different namespace from `/model`, so it must NOT be flagged reserved.
  write(MODEL_SKILL, '---\nname: model\ndescription: A skill named like a built-in.\n---\n# Model\n');
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

async function scan(activeProvider: string): Promise<ScanResult> {
  const kernel = createKernel();
  for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
  return runScan(kernel, { roots: [fixture], extensions: builtIns(), activeProvider });
}

describe('Codex skill-invocation grammar ($skill / @file / no reserved skills)', () => {
  it('$skill invokes, /model forms no edge, @file references, and `model` skill is not reserved', async () => {
    const result = await scan('codex');
    const fromDeployer = result.links.filter((l) => l.source === DEPLOYER);

    // 1. `$check-links` -> invokes -> resolved (confidence 1.0) to the skill.
    const invoke = fromDeployer.find((l) => l.kind === 'invokes' && l.target === '$check-links');
    ok(invoke, 'a `$skill` token forms an invokes link (codex dollar-skill extractor)');
    ok(invoke && invoke.confidence === 1, '`$check-links` resolves to the check-links skill (confidence 1.0)');
    const checkLinks = result.nodes.find((n) => n.path === CHECK_LINKS);
    ok(checkLinks && checkLinks.linksInCount >= 1, 'the check-links skill has an incoming invoke');

    // 1b. A `$skill` that resolves to nothing is genuinely broken: the broken
    // confidence (0.5) plus a `reference-broken` issue on the source. Confirms
    // the `$` sigil participates in broken-ref detection (stripTriggerSigil).
    const broken = fromDeployer.find((l) => l.kind === 'invokes' && l.target === '$missing-skill');
    ok(broken, '`$missing-skill` forms an invokes link');
    ok(broken && broken.confidence === 0.5, 'an unresolved `$skill` carries the broken-reference confidence (0.5)');
    ok(
      result.issues.some(
        (i) => i.analyzerId === 'reference-broken' && (i.nodeIds ?? []).includes(DEPLOYER),
      ),
      'an unresolved `$skill` is flagged as a broken reference',
    );

    // 2. `/model` forms NO edge: the claude slash extractor is ungated under
    // codex (Codex reserves `/` for its own built-in commands), so no link
    // carries a `/model` trigger and nothing links to the `model` skill.
    ok(!result.links.some((l) => l.target === '/model'), 'no `/model` slash edge under the codex lens');
    const modelSkill = result.nodes.find((n) => n.path === MODEL_SKILL);
    ok(modelSkill && modelSkill.linksInCount === 0, 'nothing invokes the `model` skill (no `$model` written)');

    // 3. `@reviewer.toml` -> references -> the reviewer agent file (path-match),
    // never a `mentions`/agent edge.
    ok(
      fromDeployer.some((l) => l.kind === 'references' && l.target.endsWith('reviewer.toml')),
      'a file-shaped `@x.toml` forms a references edge (codex at-file extractor)',
    );
    ok(!fromDeployer.some((l) => l.kind === 'mentions'), 'no agent-mention edges under the codex lens');

    // 4. The `$`-skill named `model` is NOT reserved: `$model` cannot shadow
    // Codex's built-in `/model` command (disjoint namespaces).
    ok(
      !result.issues.some(
        (i) => i.analyzerId === 'name-reserved' && (i.nodeIds ?? []).includes(MODEL_SKILL),
      ),
      'a skill named `model` is not flagged reserved under the codex lens',
    );
  });

  it('under the claude lens, the codex agent is gated off (no node, no links)', async () => {
    const result = await scan('claude');
    ok(
      !result.nodes.some((n) => n.path === DEPLOYER),
      'a .codex/*.toml agent is not classified under the claude lens',
    );
  });
});
