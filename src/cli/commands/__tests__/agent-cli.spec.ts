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

import {
  PROCESS_JOBS_SKILL_CONTENT,
  PROCESS_JOBS_SKILL_FILES,
} from '../../../core/agent-skill/skill-template.js';

/** Materialised body of one skill file, by its folder-relative path. */
function skillFileBody(path: string): string {
  const file = PROCESS_JOBS_SKILL_FILES.find((f) => f.path === path);
  ok(file !== undefined, `skill file ${path} exists in the canonical set`);
  return file.content;
}
const MCP_MODE_BODY = skillFileBody('mcp.md');
const CLI_MODE_BODY = skillFileBody('cli.md');
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

const CLAUDE_SKILL_FOLDER = join('.claude', 'skills', 'sm-process-jobs');
const CLAUDE_SKILL_REL = join(CLAUDE_SKILL_FOLDER, 'SKILL.md');

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

  it('materialises every file in the canonical set with verbatim bytes', async () => {
    const dir = freshDir();
    await withCwd(dir, async () => run(buildInstall('claude'), captureContext()));
    for (const f of PROCESS_JOBS_SKILL_FILES) {
      const path = join(dir, CLAUDE_SKILL_FOLDER, f.path);
      ok(existsSync(path), `${f.path} materialised on disk`);
      strictEqual(readFileSync(path, 'utf8'), f.content, `${f.path} written verbatim`);
    }
  });

  it('a partial copy (a sibling file deleted) reinstalls as "updated"', async () => {
    const dir = freshDir();
    const outcome = await withCwd(dir, async () => {
      await run(buildInstall('claude'), captureContext());
      // An older CLI shipped only SKILL.md; drop a mode file to simulate.
      rmSync(join(dir, CLAUDE_SKILL_FOLDER, 'mcp.md'));
      const second = captureContext();
      const code = await run(buildInstall('claude'), second);
      return { code, out: second.stdout() };
    });
    strictEqual(outcome.code, 0);
    ok(outcome.out.includes('✓  sm agent: updated the sm-process-jobs skill'), 'missing sibling => updated');
    ok(existsSync(join(dir, CLAUDE_SKILL_FOLDER, 'mcp.md')), 'the missing file is restored');
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
      PROCESS_JOBS_SKILL_CONTENT.includes('Before a fixer\'s edit, show the'),
      'names showing the edit before writing it as the fixer-edit precondition',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('get their go-ahead'),
      'the confirmation is show-then-approve, not a bare "ask first"',
    );
  });

  it('sends a genuine choice back as a choose-one question, not a silent guess', () => {
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('present the concrete options as a'),
      'a job that needs the author\'s choice surfaces the options',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('choose-one question and apply the one they pick'),
      'the options are a choose-one the agent applies in-session, not a deferred note',
    );
  });

  it('keeps the unattended processing run autonomous (edit, then report)', () => {
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('make the edit and report it'),
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
   * Split into three progressive-disclosure files 2026-07-23: SKILL.md
   * (probe + routing + shared processing loop + Rules) always loads; the
   * per-mode management surface lives in mcp.md / cli.md, read on demand.
   */
  it('materialises three files: SKILL.md plus the per-mode mcp.md / cli.md', () => {
    deepStrictEqual(
      PROCESS_JOBS_SKILL_FILES.map((f) => f.path),
      ['SKILL.md', 'mcp.md', 'cli.md'],
      'entry file first, then the two mode resources',
    );
    strictEqual(
      skillFileBody('SKILL.md'),
      PROCESS_JOBS_SKILL_CONTENT,
      'SKILL.md content is the exported canonical constant',
    );
  });

  it('routes management per mode: MCP tools in mcp.md, sm verbs in cli.md', () => {
    // SKILL.md hosts the probe + routing and the shared processing loop.
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('HYBRID mode, recommended'),
      'SKILL.md leads with the hybrid-MCP recommendation',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('PROCESS with the CLI'),
      'processing stays on the blocking CLI claim in SKILL.md',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('`mcp.md` in this folder'),
      'SKILL.md routes MCP management to mcp.md',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('do NOT announce the mode') &&
        PROCESS_JOBS_SKILL_CONTENT.includes("no 'MCP is live'"),
      'in hybrid mode the skill proceeds silently, no mode/probe announcement',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('`cli.md` in this'),
      'SKILL.md routes CLI-only management to cli.md',
    );
    // mcp.md names the typed tools; cli.md names the sm verbs.
    ok(
      MCP_MODE_BODY.includes('list_extensions') && MCP_MODE_BODY.includes('list_findings'),
      'mcp.md documents the typed queue + findings tools',
    );
    ok(
      CLI_MODE_BODY.includes('`sm jobs submit') && CLI_MODE_BODY.includes('`sm findings'),
      'cli.md documents the sm verb equivalents',
    );
  });

  it('opens with a one-line MCP tip when processing without MCP', () => {
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('make your FIRST line to the user a'),
      'a non-MCP run recommends enabling MCP on its first line',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('enable the MCP server in Settings > Project'),
      'the tip points at the Settings toggle',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('a one-time first line') &&
        PROCESS_JOBS_SKILL_CONTENT.includes('do not restate that MCP is off'),
      'the MCP tip is one-time, never repeated in later reports',
    );
  });

  /**
   * The setup diagnosis must be a three-step ORDERED checklist (user,
   * 2026-07-23): (1) is `sm serve` up on the port, (2) is the MCP server
   * toggle active, (3) has the client registered it. A live agent skipped
   * to step 3 because an open port 4242 (the `sm serve` UI) is not the
   * same as `/mcp` being mounted.
   */
  it('tips MCP setup as an ordered checklist: serve up, then MCP toggle, then client registration', () => {
    const serveAt = PROCESS_JOBS_SKILL_CONTENT.indexOf('Is `sm` up on the port');
    const toggleAt = PROCESS_JOBS_SKILL_CONTENT.indexOf('enable the MCP server in Settings');
    const registerAt = PROCESS_JOBS_SKILL_CONTENT.indexOf(
      'claude mcp add --transport http --scope local skill-map <mcp-url>',
    );
    ok(serveAt !== -1, 'step 1 (serve up on the port) is present');
    ok(toggleAt !== -1, 'step 2 (enable the MCP toggle in Settings) is present');
    ok(registerAt !== -1, 'step 3 (project-local client registration) is present');
    ok(serveAt < toggleAt && toggleAt < registerAt, 'checked in order: serve up -> MCP toggle -> register');
    // The endpoint authority is the live serve.json, never a hardcoded
    // port (user report 2026-07-28: `sm --port 5252` sent agents to the
    // 4242 default); the literal default survives only as the
    // file-absent fallback.
    const authorityAt = PROCESS_JOBS_SKILL_CONTENT.indexOf(
      '`.skill-map/serve.json` is the authority',
    );
    ok(authorityAt !== -1 && authorityAt < serveAt, 'the endpoint is resolved from serve.json BEFORE the checklist');
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('only when that file is absent assume the\n  default `http://127.0.0.1:4242/mcp`'),
      'the default port is only the serve.json-absent fallback',
    );
    ok(
      !PROCESS_JOBS_SKILL_CONTENT.includes('skill-map http://127.0.0.1:4242/mcp'),
      'no per-runtime register snippet hardcodes the default port',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('the MCP server is a separate toggle'),
      'warns that an open serve port does not by itself mount /mcp',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('Do NOT start it yourself'),
      'step 1 notifies the user, the agent never starts the server',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('`claude mcp list`'),
      'step 3 can be confirmed up front via the runtime MCP-server listing',
    );
    // A registered-but-"Failed to connect" server is a step-2 (toggle off)
    // symptom, NOT a step-3 client problem; the skill must route it to
    // Settings, not to re-adding / restarting the client.
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('"Failed to connect"') &&
        PROCESS_JOBS_SKILL_CONTENT.includes('it is not a client problem'),
      'a failed-connect on a registered server points at the toggle (step 2), not the client',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('Do not reconfigure the client'),
      'step 3 forbids re-adding / restarting the client while step 2 is unmet',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('a 200 from `/` is only the'),
      'the checklist verifies /mcp itself, not a plain hit to the port root',
    );
  });

  /**
   * The skill must reach for MCP on startup, not fall straight through to
   * the CLI claim. Observed live 2026-07-23: the agent went to the CLI
   * fallback without ever probing for the MCP tools.
   */
  it('probes for the MCP tools as its very first action', () => {
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('## First: probe for the MCP tools'),
      'the skill leads with an MCP probe section before any claim',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('Your very first action, before you claim anything'),
      'the probe is framed as the first action',
    );
  });

  /**
   * Default inverted 2026-07-23: the skill stays resident and watches by
   * default (arming the blocking `--wait` claim), and only processes a
   * single pass when invoked with `once`. The old default (single-pass,
   * opt-in watch) is gone.
   */
  it('defaults to the resident watch loop and processes a single pass only on `once`', () => {
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('## Process the queue (default: stay resident and watch)'),
      'the default processing loop is resident/watch',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('Claim (arm the wait)**: run `sm jobs claim --wait --json`'),
      'the default claim is the blocking wait',
    );
    // Regression (user 2026-07-24): an agent added `--timeout 60` to the
    // resident wait, took the exit-1 as "queue empty", and stopped. The
    // skill must warn that --timeout ends the resident loop and that a wait
    // returning without a job is not a stop signal.
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('Do NOT add `--timeout` here'),
      'the resident wait warns against --timeout',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('is NOT a signal to stop'),
      'a wait returning without a job is not a stop signal, re-arm',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('## Single pass (once)'),
      'a `once` single-pass mode exists',
    );
    ok(
      PROCESS_JOBS_SKILL_CONTENT.includes('Run `sm jobs claim --json` (plain, no `--wait`)'),
      'the single pass uses the plain, non-blocking claim',
    );
    ok(
      !PROCESS_JOBS_SKILL_CONTENT.includes('Repeat until the queue is empty'),
      'the old single-pass-by-default framing is gone',
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
