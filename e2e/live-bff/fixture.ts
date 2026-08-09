/**
 * Live-BFF fixture builder — closes R10 from the §Step 9.6 review queue.
 *
 * Programmatically materialises a minimal kernel-scope under `.tmp/`
 * (project-local per AGENTS.md §`.tmp/` baseline) so the Playwright
 * globalSetup can boot `sm serve` against it without touching any
 * checked-in fixture under `.claude/` (the static-fixture route is
 * sandbox-restricted for AI agents writing this harness in the first
 * place).
 *
 * Layout produced (rooted at `<repoRoot>/.tmp/e2e-live-bff-<timestamp>/`):
 *
 *   .claude/
 *     agents/
 *       stale-agent.md   — agent body the bump flow will refresh.
 *       stale-agent.sm   — sidecar with a deliberately wrong
 *                          `identity.bodyHash`, so the kernel resolves
 *                          `sidecar.status` to 'stale-body'. The UI's
 *                          stale-badge predicate
 *                          (see `models/node.ts:isStaleSidecar`) then
 *                          returns true and the inspector bump button
 *                          enables.
 *   docs/
 *     guide.md, api.md   — TWO plain markdown files, so the files rail
 *                          renders a real `docs` folder row (a
 *                          single-child folder chain compacts into a
 *                          prefixed leaf row and would leave the
 *                          map-scope spec without a folder checkbox to
 *                          exercise).
 *
 * The chosen `bodyHash` literal is 64 hex zeros — guaranteed to never
 * collide with `sha256(body)` for any real body, no extra hashing in the
 * fixture builder. `frontmatterHash` mirrors the same trick.
 *
 * Why no `.skill-map/skill-map.db` here: the watcher's initial batch
 * (Decision #121, BFF-side) runs the first scan + persists immediately
 * after `start()`; we do NOT pre-seed a DB. The harness waits for
 * `/api/health` to come back `db: ok` before yielding to the tests.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Sentinel hash that cannot match any real `sha256(body)`. We use 'a'
 * repeated 64 times rather than '0' repeated 64 times because YAML
 * parses `0000…` as the number `0` (no `'` quotes around the unparsed
 * scalar makes it look numeric to js-yaml's plain-scalar resolver),
 * which then fails the sidecar schema's `string` type guard. An
 * all-letters scalar parses unambiguously as a string AND still matches
 * the schema's `^[a-f0-9]{64}$` pattern.
 */
const SENTINEL_HASH = 'a'.repeat(64);

const STALE_AGENT_MD = `---
name: stale-agent
description: Live-BFF e2e fixture agent. Paired with a deliberately stale .sm so the bump flow has something to clear, plus a broken @mention that exercises the reserved-corner-slot regression.
model: claude-opus-4-7
---

# Stale Agent

Reference fixture for the live-BFF Playwright harness (R10 closure). The
sibling stale-agent.sm carries an identity.bodyHash that intentionally
does not match the sha256 of this body, so the kernel resolves the
sidecar overlay to status: 'stale-body'. The bump happy-path test clicks the
inspector bump button, waits for the WS sidecar.bumped event, and
asserts the stale badge clears + the version increments.

The trailing @nonexistent-handle below is INTENTIONAL: it produces a
broken-ref finding (the trigger resolves to no node in the graph) so
the \`graph-node-alert.spec.ts\` regression test has a node carrying a
finding that USED to surface as a corner badge under the old contract.
The reserved-slot policy now keeps the corner clean; the footer chip
on \`card.footer.right\` still surfaces the broken-ref count.

Refer this work to @nonexistent-handle for review.
`;

const STALE_AGENT_SM = `identity:
  path: .claude/agents/stale-agent.md
  bodyHash: ${SENTINEL_HASH}
  frontmatterHash: ${SENTINEL_HASH}
annotations:
  version: 3
  stability: stable
  tags:
    - e2e
    - live-bff-fixture
settings: {}
audit:
  createdAt: '2026-05-07T00:00:00.000Z'
  createdBy: cli
  lastBumpedAt: '2026-05-07T00:00:00.000Z'
  lastBumpedBy: cli
`;

export interface ILiveBffFixture {
  /** Absolute path to the materialised fixture root (the `cwd` `sm serve` will see). */
  readonly cwd: string;
  /** Scope-relative path of the stale agent (matches what the SPA shows in the URL / `data-testid`). */
  readonly stalePath: string;
  /** Annotation `version` baked into the seeded sidecar; the bump increments by 1. */
  readonly seededVersion: number;
}

/**
 * Materialise a fresh fixture rooted at `<repoRoot>/.tmp/e2e-live-bff-<ts>/`.
 *
 * `repoRoot` is taken from the caller (the e2e workspace lives at
 * `<repoRoot>/e2e/`, so callers pass `resolve(__dirname, '..', '..')`
 * or equivalent). The function never reads `process.cwd()` itself —
 * keeps the helper trivially testable and aligned with the BFF's "no
 * implicit globals" stance.
 */
export function createLiveBffFixture(repoRoot: string): ILiveBffFixture {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cwd = join(repoRoot, '.tmp', `e2e-live-bff-${stamp}`);
  const agentsDir = join(cwd, '.claude', 'agents');
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, 'stale-agent.md'), STALE_AGENT_MD, 'utf8');
  writeFileSync(join(agentsDir, 'stale-agent.sm'), STALE_AGENT_SM, 'utf8');
  // Two plain markdown files under one folder: the map-scope spec needs
  // a real `docs` folder row in the rail (single-child chains compact).
  const docsDir = join(cwd, 'docs');
  mkdirSync(docsDir, { recursive: true });
  writeFileSync(join(docsDir, 'guide.md'), '# Guide\n\nLive-BFF map-scope fixture file.\n', 'utf8');
  writeFileSync(join(docsDir, 'api.md'), '# API\n\nLive-BFF map-scope fixture file.\n', 'utf8');
  // Three sacrificial files OWNED by `ignore.spec.ts` (it removes them
  // from the corpus by appending `.skillmapignore` patterns). Dedicated
  // folder on purpose: the suite shares ONE server (workers: 1, specs
  // run serially), so ignoring anything under `.claude/` or `docs/`
  // would break the bump / map-scope specs that run around it.
  const notesDir = join(cwd, 'notes');
  mkdirSync(notesDir, { recursive: true });
  writeFileSync(join(notesDir, 'scratch.md'), '# Scratch\n\nLive-BFF ignore fixture file.\n', 'utf8');
  writeFileSync(join(notesDir, 'todo.md'), '# Todo\n\nLive-BFF ignore fixture file.\n', 'utf8');
  writeFileSync(join(notesDir, 'draft.md'), '# Draft\n\nLive-BFF ignore fixture file.\n', 'utf8');
  // `core/node-bump` ships `defaultEnabled: false` (2026-07-21 enabled-gate
  // sweep) and its surface is the header version chip, so the bump spec
  // needs the explicit opt-in. Project layer only: `.sm` write consent
  // stays UNgranted, the spec exercises the 412 consent dialog.
  const smDir = join(cwd, '.skill-map');
  mkdirSync(smDir, { recursive: true });
  writeFileSync(
    join(smDir, 'settings.json'),
    JSON.stringify(
      { plugins: { core: { extensions: { 'node-bump': { enabled: true } } } } },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  return {
    cwd,
    stalePath: '.claude/agents/stale-agent.md',
    seededVersion: 3,
  };
}

/**
 * Best-effort tempdir cleanup. Swallows ENOENT (idempotent for
 * globalTeardown). Any other error propagates so CI surfaces a real
 * fault.
 */
export function disposeLiveBffFixture(cwd: string): void {
  if (!existsSync(cwd)) return;
  rmSync(cwd, { recursive: true, force: true });
}
