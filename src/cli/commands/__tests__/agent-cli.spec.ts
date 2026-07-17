/**
 * End-to-end tests for `sm agent install / uninstall / status`, the
 * distributable agent process skill (`spec/cli-contract.md` §Agent process
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
 *   - the canonical skill BODY teaches the interactive fixer-edit
 *     confirmation (the verb tests only pin bytes == constant, which says
 *     nothing about what the skill teaches).
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

import { PROCESS_JOBS_SKILL_CONTENT } from '../../../core/agent-skill/skill-template.js';
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

const CLAUDE_SKILL_REL = join('.claude', 'skills', 'sm-process-jobs', 'SKILL.md');

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
    strictEqual(readFileSync(join(dir, CLAUDE_SKILL_REL), 'utf8'), PROCESS_JOBS_SKILL_CONTENT);
    ok(outcome.out.includes('✓  sm agent: installed the sm-process-jobs skill'), 'installed wording');
    ok(outcome.out.includes('.claude/skills/sm-process-jobs/SKILL.md'), 'relative path named');
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
    ok(outcome.secondOut.includes('✓  sm agent: updated the sm-process-jobs skill'), 'updated wording');
    ok(outcome.secondOut.includes("to this CLI's version"), 'update names the cause');
    strictEqual(readFileSync(join(dir, CLAUDE_SKILL_REL), 'utf8'), PROCESS_JOBS_SKILL_CONTENT);
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
      readFileSync(join(dir, '.agents', 'skills', 'sm-process-jobs', 'SKILL.md'), 'utf8'),
      PROCESS_JOBS_SKILL_CONTENT,
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
    ok(outcome.firstOut.includes('✓  sm agent: removed the sm-process-jobs skill'), 'removed wording');
    ok(!existsSync(join(dir, '.claude', 'skills', 'sm-process-jobs')), 'folder gone');
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

/**
 * The canonical skill BODY. The verb tests above pin that the materialised
 * bytes equal `PROCESS_JOBS_SKILL_CONTENT`, which is tautological about what
 * the skill actually teaches. A fixer job is the ONE job kind that edits
 * the operator's own files, and a processing agent may well have a human
 * sitting next to it, so the skill must send it to that human before
 * writing, and must say why waiting is safe: TTL-less jobs never expire
 * (`spec/job-lifecycle.md` §TTL and auto-reap explicitly reserves the
 * no-TTL default for exactly this interactive pause).
 */
describe('the canonical sm-process-jobs skill, fixer-edit guidance', () => {
  it('sends an interactive agent to its user for a go-ahead before the edit', () => {
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('consult them before a fixer\'s edit'),
      'names consulting the user as the fixer-edit precondition',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('show the edit you intend to make and get their'),
      'the confirmation is show-then-approve, not a bare "ask first"',
    );
  });

  it('keeps the unattended processing run autonomous (edit, then report)', () => {
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('when processing unattended, make the edit'),
      'an agent with no user to consult still performs the edit',
    );
  });

  it('justifies the wait with the TTL-less default, so a claim can hold', () => {
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('Jobs carry no TTL by default'),
      'the skill states why pausing mid-claim is safe',
    );
  });

  /**
   * The agent that edited the file is the one that knows it changed, so
   * it owns the re-scan. Observed live: a fixer edited the node, nobody
   * scanned, and `sm findings` kept reporting the finding as FRESH
   * against a body that no longer existed on disk (staleness compares
   * two DB hashes, and the DB only learns from a scan).
   */
  it('makes the processing agent re-scan the node it edited', () => {
    // Live agent report 2026-07-17: the original wording said
    // `sm scan -n <path>`, but scan's `-n` is --dry-run (skips every DB
    // write, the silent inverse of the instruction's purpose) and scan
    // roots are directories, so a file path errors out. The working
    // instruction is the incremental full scan.
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('run `sm scan --changed`'),
      'names the incremental scan, never the dry-run -n flag',
    );
    ok(
      !PROCESS_JOBS_SKILL_CONTENT.includes('sm scan -n'),
      'the dry-run trap wording is gone',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('skill-map learns about edits only from a scan'),
      'states why: without it the map reports against the replaced version',
    );
  });
});
