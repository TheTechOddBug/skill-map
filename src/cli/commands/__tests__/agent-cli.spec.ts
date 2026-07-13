/**
 * End-to-end tests for `sm agent install / uninstall / status`, the
 * distributable agent drain skill (`spec/cli-contract.md` §Agent drain
 * skill). Each command runs inside a fresh temp dir; the destination
 * resolves either from the active lens (a `.claude/` marker on disk) or
 * the explicit `--for <provider>` override.
 *
 * Coverage:
 *   - install resolves the claude lens from the on-disk marker and
 *     writes the canonical SKILL.md bytes verbatim.
 *   - reinstall is three-state ("updated" on drifted bytes, "already up
 *     to date" on identical bytes; drifted
 *     bytes rewritten back to canonical).
 *   - `--for codex` lands in the shared `.agents/skills` territory and
 *     drops the `.codex/` lens marker (mirroring `sm tutorial`).
 *   - status --json in all three states (not installed / installed
 *     fresh / installed stale), plus the default-lens fallback
 *     (`agent-skills`) and the human stale hint.
 *   - uninstall removes the folder and double-uninstall no-ops (exit 0).
 *   - `--for` refusals: unknown provider id, and a registered provider
 *     without a `scaffold.skillDir` (`markdown`), both exit 2.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { RUN_QUEUE_SKILL_CONTENT } from '../../../core/agent-skill/skill-template.js';
import {
  AgentInstallCommand,
  AgentStatusCommand,
  AgentUninstallCommand,
} from '../agent.js';

let tmpRoot: string;
let counter = 0;

interface ICaptured {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICaptured {
  const out: string[] = [];
  const err: string[] = [];
  const context = {
    stdout: { write: (s: string) => { out.push(s); return true; } },
    stderr: { write: (s: string) => { err.push(s); return true; } },
  } as unknown as BaseContext;
  return { context, stdout: () => out.join(''), stderr: () => err.join('') };
}

/** Fresh temp project dir (no `.skill-map/`, no vendor markers). */
function freshDir(): string {
  counter += 1;
  const dir = join(tmpRoot, `proj-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Assign EVERY Option field so direct instantiation mirrors a parse. */
function assignGlobals(
  cmd: AgentInstallCommand | AgentUninstallCommand | AgentStatusCommand,
  opts: { json?: boolean; forProvider?: string },
): void {
  cmd.json = opts.json ?? false;
  cmd.quiet = false;
  cmd.noColor = true;
  cmd.verbose = 0;
  cmd.db = undefined;
  cmd.forProvider = opts.forProvider;
}

function buildInstall(forProvider?: string): AgentInstallCommand {
  const cmd = new AgentInstallCommand();
  assignGlobals(cmd, forProvider === undefined ? {} : { forProvider });
  return cmd;
}

function buildUninstall(forProvider?: string): AgentUninstallCommand {
  const cmd = new AgentUninstallCommand();
  assignGlobals(cmd, forProvider === undefined ? {} : { forProvider });
  return cmd;
}

function buildStatus(json: boolean, forProvider?: string): AgentStatusCommand {
  const cmd = new AgentStatusCommand();
  assignGlobals(cmd, forProvider === undefined ? { json } : { json, forProvider });
  return cmd;
}

async function run(
  cmd: { context: BaseContext; execute(): Promise<number> },
  cap: ICaptured,
): Promise<number> {
  cmd.context = cap.context;
  return cmd.execute();
}

async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const orig = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(orig);
  }
}

const CLAUDE_SKILL_REL = join('.claude', 'skills', 'sm-run-queue', 'SKILL.md');

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-agent-cli-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('sm agent install', () => {
  it('resolves the claude lens from the .claude marker and writes the canonical bytes', async () => {
    const dir = freshDir();
    mkdirSync(join(dir, '.claude'), { recursive: true });
    const outcome = await withCwd(dir, async () => {
      const cap = captureContext();
      const code = await run(buildInstall(), cap);
      return { code, out: cap.stdout() };
    });
    strictEqual(outcome.code, 0);
    strictEqual(readFileSync(join(dir, CLAUDE_SKILL_REL), 'utf8'), RUN_QUEUE_SKILL_CONTENT);
    ok(outcome.out.includes('✓  sm agent: installed the sm-run-queue skill'), 'installed wording');
    ok(outcome.out.includes('.claude/skills/sm-run-queue/SKILL.md'), 'relative path named');
    ok(outcome.out.includes('(claude lens)'), 'lens named');
  });

  it('reinstall over drifted bytes reports "updated" and restores the canonical copy', async () => {
    const dir = freshDir();
    const outcome = await withCwd(dir, async () => {
      const first = captureContext();
      const firstCode = await run(buildInstall('claude'), first);
      // Drift the materialised copy (an older CLI's install); the update
      // must restore it verbatim.
      appendFileSync(join(dir, CLAUDE_SKILL_REL), 'tampered\n');
      const second = captureContext();
      const secondCode = await run(buildInstall('claude'), second);
      return { firstCode, secondCode, secondOut: second.stdout() };
    });
    strictEqual(outcome.firstCode, 0);
    strictEqual(outcome.secondCode, 0);
    ok(outcome.secondOut.includes('✓  sm agent: updated the sm-run-queue skill'), 'updated wording');
    ok(outcome.secondOut.includes("to this CLI's version"), 'update names the cause');
    strictEqual(readFileSync(join(dir, CLAUDE_SKILL_REL), 'utf8'), RUN_QUEUE_SKILL_CONTENT);
  });

  it('reinstall over identical bytes reports "already up to date" and writes nothing', async () => {
    const dir = freshDir();
    const outcome = await withCwd(dir, async () => {
      const firstCode = await run(buildInstall('claude'), captureContext());
      const before = statSync(join(dir, CLAUDE_SKILL_REL)).mtimeMs;
      const second = captureContext();
      const secondCode = await run(buildInstall('claude'), second);
      const after = statSync(join(dir, CLAUDE_SKILL_REL)).mtimeMs;
      return { firstCode, secondCode, secondOut: second.stdout(), before, after };
    });
    strictEqual(outcome.firstCode, 0);
    strictEqual(outcome.secondCode, 0);
    ok(outcome.secondOut.includes('already up to date'), 'up-to-date wording');
    strictEqual(outcome.before, outcome.after, 'file untouched (no rewrite)');
  });

  it('--for codex writes into the shared .agents/skills territory and drops the .codex marker', async () => {
    const dir = freshDir();
    const code = await withCwd(dir, async () => run(buildInstall('codex'), captureContext()));
    strictEqual(code, 0);
    strictEqual(
      readFileSync(join(dir, '.agents', 'skills', 'sm-run-queue', 'SKILL.md'), 'utf8'),
      RUN_QUEUE_SKILL_CONTENT,
    );
    ok(existsSync(join(dir, '.codex')), 'lens marker dropped alongside');
  });

  it('exits 2 with a hint when --for names an unknown provider id', async () => {
    const outcome = await withCwd(freshDir(), async () => {
      const cap = captureContext();
      const code = await run(buildInstall('no-such-provider'), cap);
      return { code, err: cap.stderr() };
    });
    strictEqual(outcome.code, 2);
    ok(outcome.err.includes('no registered provider "no-such-provider"'), 'headline');
    ok(outcome.err.includes('Providers with a skill directory:'), 'hint lists valid ids');
    ok(outcome.err.includes('claude'), 'claude offered');
  });

  it('exits 2 when --for names a provider without a skill directory (markdown)', async () => {
    const outcome = await withCwd(freshDir(), async () => {
      const cap = captureContext();
      const code = await run(buildInstall('markdown'), cap);
      return { code, err: cap.stderr() };
    });
    strictEqual(outcome.code, 2);
    ok(outcome.err.includes('provider "markdown" declares no skill directory'), 'headline');
    ok(outcome.err.includes('Providers with a skill directory:'), 'hint lists valid ids');
  });
});

describe('sm agent status', () => {
  it('--json reports not installed (stale false) on a fresh dir', async () => {
    const outcome = await withCwd(freshDir(), async () => {
      const cap = captureContext();
      const code = await run(buildStatus(true, 'claude'), cap);
      return { code, payload: JSON.parse(cap.stdout()) as Record<string, unknown> };
    });
    strictEqual(outcome.code, 0);
    deepStrictEqual(outcome.payload, {
      provider: 'claude',
      skillDir: '.claude/skills',
      installed: false,
      stale: false,
    });
  });

  it('--json reports installed + fresh right after an install', async () => {
    const outcome = await withCwd(freshDir(), async () => {
      await run(buildInstall('claude'), captureContext());
      const cap = captureContext();
      const code = await run(buildStatus(true, 'claude'), cap);
      return { code, payload: JSON.parse(cap.stdout()) as Record<string, unknown> };
    });
    strictEqual(outcome.code, 0);
    deepStrictEqual(outcome.payload, {
      provider: 'claude',
      skillDir: '.claude/skills',
      installed: true,
      stale: false,
    });
  });

  it('--json flips stale when the materialised bytes drift, and human mode hints the refresh', async () => {
    const dir = freshDir();
    const outcome = await withCwd(dir, async () => {
      await run(buildInstall('claude'), captureContext());
      appendFileSync(join(dir, CLAUDE_SKILL_REL), 'extra bytes\n');
      const jsonCap = captureContext();
      const jsonCode = await run(buildStatus(true, 'claude'), jsonCap);
      const humanCap = captureContext();
      const humanCode = await run(buildStatus(false, 'claude'), humanCap);
      return {
        jsonCode,
        humanCode,
        payload: JSON.parse(jsonCap.stdout()) as Record<string, unknown>,
        humanOut: humanCap.stdout(),
      };
    });
    strictEqual(outcome.jsonCode, 0);
    deepStrictEqual(outcome.payload, {
      provider: 'claude',
      skillDir: '.claude/skills',
      installed: true,
      stale: true,
    });
    strictEqual(outcome.humanCode, 0);
    ok(outcome.humanOut.includes('installed (stale)'), 'stale marker');
    ok(outcome.humanOut.includes('Re-run `sm agent install`'), 'actionable hint');
  });

  it('defaults to the open-standard lens (agent-skills) when no marker or config exists', async () => {
    const outcome = await withCwd(freshDir(), async () => {
      const cap = captureContext();
      const code = await run(buildStatus(true), cap);
      return { code, payload: JSON.parse(cap.stdout()) as Record<string, unknown> };
    });
    strictEqual(outcome.code, 0);
    deepStrictEqual(outcome.payload, {
      provider: 'agent-skills',
      skillDir: '.agents/skills',
      installed: false,
      stale: false,
    });
  });
});

describe('sm agent uninstall', () => {
  it('removes the skill folder and double-uninstall no-ops with exit 0', async () => {
    const dir = freshDir();
    const outcome = await withCwd(dir, async () => {
      await run(buildInstall('claude'), captureContext());
      const first = captureContext();
      const firstCode = await run(buildUninstall('claude'), first);
      const second = captureContext();
      const secondCode = await run(buildUninstall('claude'), second);
      return {
        firstCode,
        firstOut: first.stdout(),
        secondCode,
        secondErr: second.stderr(),
      };
    });
    strictEqual(outcome.firstCode, 0);
    ok(outcome.firstOut.includes('✓  sm agent: removed the sm-run-queue skill'), 'removed wording');
    ok(!existsSync(join(dir, '.claude', 'skills', 'sm-run-queue')), 'folder gone');
    strictEqual(outcome.secondCode, 0);
    ok(outcome.secondErr.includes('nothing to do'), 'idempotent advisory');
  });

  it('exits 2 with a hint when --for names an unknown provider id', async () => {
    const outcome = await withCwd(freshDir(), async () => {
      const cap = captureContext();
      const code = await run(buildUninstall('nope'), cap);
      return { code, err: cap.stderr() };
    });
    strictEqual(outcome.code, 2);
    ok(outcome.err.includes('no registered provider "nope"'), 'headline');
    ok(outcome.err.includes('Providers with a skill directory:'), 'hint');
  });
});
