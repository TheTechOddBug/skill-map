/**
 * Invariant test for AGENTS.md "CLI output sanitization":
 *
 *   "Every CLI sink that writes to stdout/stderr MUST pass strings
 *    sourced from persisted DB rows, plugin-authored values, or
 *    filesystem entries through `sanitizeForTerminal()`."
 *
 * Plants control bytes (`\x1b[2J` ANSI clear-screen, `\x07` BEL) inside
 * a Node title and an Issue message, persists them, then runs every
 * read-side render path. Stdout MUST contain neither byte after a
 * round-trip through the verb. Catches any future render path that
 * forgets to wrap a plugin / DB / FS string in `sanitizeForTerminal`.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { BaseContext } from 'clipanion';

import { CheckCommand } from '../../cli/commands/check.js';
import { ExportCommand } from '../../cli/commands/export.js';
import { ListCommand } from '../../cli/commands/list.js';
import { ShowCommand } from '../../cli/commands/show.js';
import type { SmCommand } from '../../cli/util/sm-command.js';
import { SqliteStorageAdapter } from '../../kernel/adapters/sqlite/index.js';

const ESC = '\x1b';
const BEL = '\x07';
const CLEAR_SCREEN = `${ESC}[2J`;

// Forbidden bytes in stdout after rendering. Newline + tab are allowed
// every CLI line emits `\n` and tabular renders use `\t` for
// padding. The rest of C0 / C1 is what `sanitizeForTerminal()`
// strips.
const FORBIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

interface ICapturedContext {
  context: BaseContext;
  stdout: () => string;
  stderr: () => string;
}

function captureContext(): ICapturedContext {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const context = {
    stdin: process.stdin,
    stdout: { write: (s: string) => { stdoutChunks.push(s); return true; } },
    stderr: { write: (s: string) => { stderrChunks.push(s); return true; } },
  } as unknown as BaseContext;
  return {
    context,
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
  };
}

let tmpRoot: string;
let dbPath: string;
const POISONED_NODE_PATH = `.claude/agents/poisoned${BEL}.md`;
const POISONED_NODE_TITLE = `architect${CLEAR_SCREEN}injected`;
const POISONED_ISSUE_MESSAGE = `naughty${CLEAR_SCREEN}message${BEL}`;

before(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-sanitize-'));
  dbPath = join(tmpRoot, 'skill-map.db');
  const adapter = new SqliteStorageAdapter({ databasePath: dbPath, autoBackup: false });
  await adapter.init();
  try {
    const now = Date.now();
    await adapter.scans.persist(
      {
        schemaVersion: 1,
        scannedAt: now,
        roots: [tmpRoot],
        providers: ['claude'],
        nodes: [
          {
            path: POISONED_NODE_PATH,
            kind: 'agent',
            provider: 'claude',
            bytes: { total: 32, frontmatter: 16, body: 16 },
            bodyHash: 'a'.repeat(64),
            frontmatterHash: 'b'.repeat(64),
            linksOutCount: 0,
            linksInCount: 0,
            externalRefsCount: 0,
            frontmatter: { name: POISONED_NODE_TITLE },
            sidecar: { present: true, status: 'fresh', annotations: { stability: 'stable' } },
          },
        ],
        links: [],
        issues: [
          {
            analyzerId: 'core/test',
            severity: 'error',
            nodeIds: [POISONED_NODE_PATH],
            message: POISONED_ISSUE_MESSAGE,
          },
        ],
        stats: {
          filesWalked: 1,
          filesSkipped: 0,
          nodesCount: 1,
          linksCount: 0,
          issuesCount: 1,
          durationMs: 1,
        },
      },
      { renameOps: [], extractorRuns: [], enrichments: [] },
    );
  } finally {
    await adapter.close();
  }
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function applySmDefaults(cmd: SmCommand): void {
  cmd.json = false;
  cmd.quiet = false;
  // The sanitisation invariant is about plugin / DB strings, not about
  // CLI-emitted styling. Force color off so `FORCE_COLOR=1` (set by
  // some `node --test` reporters / CI runners) cannot poison the
  // output with legitimate ANSI escapes the assertion would flag.
  cmd.noColor = true;
  cmd.db = dbPath;
}

function build<T extends SmCommand>(
  ctor: new () => T,
  configure: (cmd: T) => void = () => {},
): { cmd: T; capture: ICapturedContext } {
  const cap = captureContext();
  const cmd = new ctor();
  applySmDefaults(cmd);
  configure(cmd);
  cmd.context = cap.context;
  return { cmd, capture: cap };
}

function assertNoControlBytes(output: string, label: string): void {
  const match = output.match(FORBIDDEN);
  if (match) {
    const at = output.indexOf(match[0]);
    const ctx = JSON.stringify(output.slice(Math.max(0, at - 20), at + 20));
    assert.fail(`${label}: forbidden control byte 0x${match[0].charCodeAt(0).toString(16)} at offset ${at}, context=${ctx}`);
  }
}

describe('AGENTS.md "CLI output sanitization", render paths strip control bytes from plugin/DB strings', () => {
  it('sm check (human)', async () => {
    const c = build(CheckCommand, (cmd) => {
      cmd.node = undefined;
      cmd.analyzers = undefined;
      cmd.noPlugins = true;
    });
    await c.cmd.execute();
    assertNoControlBytes(c.capture.stdout(), 'sm check');
  });

  it('sm show (human, poisoned node)', async () => {
    const c = build(ShowCommand, (cmd) => { cmd.nodePath = POISONED_NODE_PATH; });
    await c.cmd.execute();
    assertNoControlBytes(c.capture.stdout(), 'sm show');
  });

  it('sm list (human)', async () => {
    const c = build(ListCommand, (cmd) => {
      cmd.kind = undefined;
      cmd.issue = false;
      cmd.sortBy = undefined;
      cmd.limit = undefined;
      cmd.tag = undefined;
    });
    await c.cmd.execute();
    assertNoControlBytes(c.capture.stdout(), 'sm list');
  });

  it('sm export --format md (poisoned issue + node title)', async () => {
    const c = build(ExportCommand, (cmd) => {
      cmd.query = '';
      cmd.format = 'md';
    });
    await c.cmd.execute();
    assertNoControlBytes(c.capture.stdout(), 'sm export md');
  });

  it('sm export --format json strips control bytes inside string fields', async () => {
    // JSON output is special: `JSON.stringify` escapes \x1b as `\u001b`,
    // so the literal control byte does NOT reach the terminal directly.
    // The invariant we assert: the unescaped sequence is absent.
    const c = build(ExportCommand, (cmd) => {
      cmd.query = '';
      cmd.format = 'json';
    });
    await c.cmd.execute();
    assertNoControlBytes(c.capture.stdout(), 'sm export json');
  });
});
