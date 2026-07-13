/**
 * End-to-end tests for `sm actions list / show`, the manifest view over
 * the composed Action catalog. Each command runs inside a fresh EMPTY
 * temp dir (no `.skill-map/`), so only the built-ins compose; the
 * report-schema ref, the mode default, and the probabilistic detail
 * section are asserted against the real bundled manifests
 * (`core/markdown-summarizer` probabilistic + summarizer,
 * `core/node-bump` deterministic).
 *
 * Coverage:
 *   - list --json: row shape (mode / duration / source).
 *   - list human: table headers + footer noun + tip.
 *   - show --json with a BARE id: qualified resolution + reportSchemaRef.
 *   - show human: Probabilistic section present / absent
 *     (deterministic action).
 *   - show unknown id: exit 5 + actionable hint on stderr.
 *
 * `core/node-set-tags` is the deterministic anchor (not `core/node-bump`,
 * which ships `stability: 'experimental'` and is therefore disabled by
 * default, so it never reaches the composed catalog these verbs render).
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strictEqual, ok, match } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import type { BaseContext } from 'clipanion';

import { ActionsListCommand, ActionsShowCommand } from '../actions.js';

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

/** Fresh empty project dir: no `.skill-map/`, so only built-ins compose. */
function freshDir(): string {
  counter += 1;
  const dir = join(tmpRoot, `proj-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function buildList(json: boolean): ActionsListCommand {
  const cmd = new ActionsListCommand();
  cmd.json = json;
  cmd.quiet = false;
  cmd.noColor = true;
  cmd.verbose = 0;
  cmd.db = undefined;
  return cmd;
}

function buildShow(id: string, json: boolean): ActionsShowCommand {
  const cmd = new ActionsShowCommand();
  cmd.id = id;
  cmd.json = json;
  cmd.quiet = false;
  cmd.noColor = true;
  cmd.verbose = 0;
  cmd.db = undefined;
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

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-actions-cli-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('sm actions list', () => {
  it('--json emits one row per built-in action with the manifest fields', async () => {
    const outcome = await withCwd(freshDir(), async () => {
      const cap = captureContext();
      const code = await run(buildList(true), cap);
      return { code, rows: JSON.parse(cap.stdout()) as Array<Record<string, unknown>> };
    });
    strictEqual(outcome.code, 0);
    ok(Array.isArray(outcome.rows));

    const summarizer = outcome.rows.find(
      (r) => r['qualifiedId'] === 'core/markdown-summarizer',
    );
    ok(summarizer, 'core/markdown-summarizer row present');
    strictEqual(summarizer['mode'], 'probabilistic');
    // Derived traits carry no field of their own (decision 2026-07-13):
    // the summarizer signal is readable only through show's reportSchemaRef.
    ok(!('summarizer' in summarizer), 'no derived summarizer field');
    strictEqual(summarizer['probExpectedDurationSeconds'], 120);
    strictEqual(summarizer['source'], 'built-in');

    const setTags = outcome.rows.find((r) => r['qualifiedId'] === 'core/node-set-tags');
    ok(setTags, 'core/node-set-tags row present');
    strictEqual(setTags['mode'], 'deterministic');
    strictEqual(setTags['source'], 'built-in');
  });

  it('human table renders the headers, footer noun, and tip', async () => {
    const outcome = await withCwd(freshDir(), async () => {
      const cap = captureContext();
      const code = await run(buildList(false), cap);
      return { code, out: cap.stdout() };
    });
    strictEqual(outcome.code, 0);
    ok(outcome.out.includes('ID'), 'ID header');
    ok(outcome.out.includes('MODE'), 'MODE header');
    ok(!outcome.out.includes('SUMMARIZER'), 'no derived-trait column');
    ok(outcome.out.includes('DESCRIPTION'), 'DESCRIPTION header');
    match(outcome.out, /\n\d+ actions\n/, 'plural footer noun');
    ok(
      outcome.out.includes(
        'Tip: `sm actions show <id>` for the full manifest; `sm job submit <id> -n <node>` to queue one.',
      ),
      'footer tip',
    );
    ok(outcome.out.includes('core/markdown-summarizer'), 'summarizer row rendered');
  });
});

describe('sm actions show', () => {
  it('--json resolves a BARE id and reports the summaries schema ref', async () => {
    const outcome = await withCwd(freshDir(), async () => {
      const cap = captureContext();
      const code = await run(buildShow('markdown-summarizer', true), cap);
      return { code, detail: JSON.parse(cap.stdout()) as Record<string, unknown> };
    });
    strictEqual(outcome.code, 0);
    strictEqual(outcome.detail['qualifiedId'], 'core/markdown-summarizer');
    ok(!('summarizer' in outcome.detail), 'no derived summarizer field');
    strictEqual(
      outcome.detail['reportSchemaRef'],
      'https://skill-map.ai/spec/v0/summaries/markdown.schema.json',
    );
    strictEqual(outcome.detail['hasPromptTemplate'], true);
  });

  it('human detail renders the Probabilistic section for a summarizer', async () => {
    const outcome = await withCwd(freshDir(), async () => {
      const cap = captureContext();
      const code = await run(buildShow('core/markdown-summarizer', false), cap);
      return { code, out: cap.stdout() };
    });
    strictEqual(outcome.code, 0);
    ok(outcome.out.includes('Probabilistic'), 'Probabilistic section title');
    ok(outcome.out.includes('120s'), 'expected duration');
    ok(outcome.out.includes('summaries/markdown.schema.json'), 'schema ref is the signal');
    ok(!outcome.out.includes('(summarizer)'), 'no derived-trait tag');
  });

  it('human detail drops the Probabilistic section for a deterministic action', async () => {
    const outcome = await withCwd(freshDir(), async () => {
      const cap = captureContext();
      const code = await run(buildShow('core/node-set-tags', false), cap);
      return { code, out: cap.stdout() };
    });
    strictEqual(outcome.code, 0);
    ok(outcome.out.includes('core/node-set-tags'), 'header present');
    ok(!outcome.out.includes('Probabilistic'), 'no Probabilistic section');
  });

  it('exits 5 with an actionable hint when the id is unknown', async () => {
    const outcome = await withCwd(freshDir(), async () => {
      const cap = captureContext();
      const code = await run(buildShow('no/such-action', false), cap);
      return { code, err: cap.stderr() };
    });
    strictEqual(outcome.code, 5);
    match(outcome.err, /action no\/such-action not found/);
    ok(
      outcome.err.includes('Run `sm actions list` to see the registered ids.'),
      'hint on stderr',
    );
  });
});
