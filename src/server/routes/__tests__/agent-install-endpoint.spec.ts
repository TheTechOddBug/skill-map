/**
 * `GET/POST /api/agent/install` + `POST /api/agent/uninstall`
 * integration tests (see `spec/cli-contract.md` §Agent process skill and
 * the HTTP API table rows).
 *
 * Each test boots a real `createServer()` (built-ins ON, so the real
 * `claude` / `codex` providers with their `scaffold.skillDir` are
 * registered) against a tempdir fixture cwd and fires `fetch()` at the
 * endpoints, then asserts BOTH the wire envelope and the on-disk
 * effects (the materialised `SKILL.md`, the lens marker). The
 * load-bearing cases: the 412 consent gate touches NOTHING, install is
 * three-state (installed / up-to-date / updated on tampered bytes,
 * byte-exact against the canonical template), uninstall is idempotent.
 */

import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { PROCESS_JOBS_SKILL_CONTENT } from '../../../core/agent-skill/skill-template.js';
import {
  createServer,
  type IServerOptions,
  type IServerHandle,
} from '../../index.js';

const CLAUDE_SKILL_DIR = '.claude/skills';
const SKILL_FOLDER_REL = `${CLAUDE_SKILL_DIR}/sm-process-jobs`;
const SKILL_FILE_REL = `${SKILL_FOLDER_REL}/SKILL.md`;

interface ITestRoot {
  tmp: string;
  fixtureRoot: string;
  dbPath: string;
}

let root: ITestRoot;

before(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'skill-map-agent-install-endpoint-'));
  root = {
    tmp,
    fixtureRoot: join(tmp, 'fixture'),
    dbPath: join(tmp, 'primed.db'),
  };
});

after(() => {
  rmSync(root.tmp, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(root.fixtureRoot, { recursive: true, force: true });
  mkdirSync(root.fixtureRoot, { recursive: true });
});

function defaultOptions(): IServerOptions {
  return {
    port: 0,
    host: '127.0.0.1',
    dbPath: root.dbPath,
    uiDist: null,
    noUi: false,
    noBuiltIns: false,
    noPlugins: true,
    open: false,
    devCors: false,
    noWatcher: true,
    mcpServer: false,
  };
}

async function bootAndUse<T>(fn: (handle: IServerHandle) => Promise<T>): Promise<T> {
  const handle = await createServer(defaultOptions(), {
    runtimeContext: { cwd: root.fixtureRoot },
  });
  try {
    return await fn(handle);
  } finally {
    await handle.close();
  }
}

function url(handle: IServerHandle, path: string): string {
  return `http://127.0.0.1:${handle.address.port}${path}`;
}

async function getStatus(handle: IServerHandle, provider: string): Promise<Response> {
  return fetch(url(handle, `/api/agent/install?provider=${provider}`));
}

async function post(handle: IServerHandle, path: string, body: unknown): Promise<Response> {
  return fetch(url(handle, path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function skillFilePath(): string {
  return join(root.fixtureRoot, SKILL_FILE_REL);
}

interface IStatusEnvelope {
  provider: string;
  supported: boolean;
  skillDir: string | null;
  installed: boolean;
  stale: boolean;
  outcome?: string;
  removed?: boolean;
}

describe('GET /api/agent/install, status probe', () => {
  it('400 bad-query when the provider param is missing', async () => {
    await bootAndUse(async (handle) => {
      const res = await fetch(url(handle, '/api/agent/install'));
      assert.equal(res.status, 400);
      const envelope = (await res.json()) as { error: { code: string } };
      assert.equal(envelope.error.code, 'bad-query');
    });
  });

  it('404 not-found on an unknown provider id', async () => {
    await bootAndUse(async (handle) => {
      const res = await getStatus(handle, 'nope');
      assert.equal(res.status, 404);
      const envelope = (await res.json()) as { error: { code: string } };
      assert.equal(envelope.error.code, 'not-found');
    });
  });

  it('supported: false for a registered provider without scaffold.skillDir', async () => {
    await bootAndUse(async (handle) => {
      const res = await getStatus(handle, 'markdown');
      assert.equal(res.status, 200);
      const envelope = (await res.json()) as IStatusEnvelope;
      assert.deepEqual(envelope, {
        provider: 'markdown',
        supported: false,
        skillDir: null,
        installed: false,
        stale: false,
      });
    });
  });

  it('claude pre-install: supported, skillDir surfaced, not installed', async () => {
    await bootAndUse(async (handle) => {
      const res = await getStatus(handle, 'claude');
      assert.equal(res.status, 200);
      const envelope = (await res.json()) as IStatusEnvelope;
      assert.deepEqual(envelope, {
        provider: 'claude',
        supported: true,
        skillDir: CLAUDE_SKILL_DIR,
        installed: false,
        stale: false,
      });
    });
  });
});

describe('POST /api/agent/install, consent gate + three-state outcome', () => {
  it('412 confirm-required without confirm, and NOTHING is written', async () => {
    await bootAndUse(async (handle) => {
      const res = await post(handle, '/api/agent/install', { provider: 'claude' });
      assert.equal(res.status, 412);
      const envelope = (await res.json()) as { error: { code: string; message: string } };
      assert.equal(envelope.error.code, 'confirm-required');
      assert.equal(envelope.error.message.includes(SKILL_FILE_REL), true);
      assert.equal(existsSync(join(root.fixtureRoot, '.claude')), false);
    });
  });

  it('404 on an unknown provider; 400 on no skillDir; 400 on a body without provider', async () => {
    await bootAndUse(async (handle) => {
      assert.equal(
        (await post(handle, '/api/agent/install', { provider: 'nope', confirm: true })).status,
        404,
      );
      assert.equal(
        (await post(handle, '/api/agent/install', { provider: 'markdown', confirm: true }))
          .status,
        400,
      );
      assert.equal((await post(handle, '/api/agent/install', {})).status, 400);
    });
  });

  it('installs with confirm: true, writing the canonical bytes', async () => {
    await bootAndUse(async (handle) => {
      const res = await post(handle, '/api/agent/install', {
        provider: 'claude',
        confirm: true,
      });
      assert.equal(res.status, 200);
      const envelope = (await res.json()) as IStatusEnvelope;
      assert.equal(envelope.outcome, 'installed');
      assert.equal(envelope.installed, true);
      assert.equal(envelope.stale, false);
      assert.equal(envelope.skillDir, CLAUDE_SKILL_DIR);
      assert.equal(readFileSync(skillFilePath(), 'utf8'), PROCESS_JOBS_SKILL_CONTENT);

      const status = (await (await getStatus(handle, 'claude')).json()) as IStatusEnvelope;
      assert.equal(status.installed, true);
      assert.equal(status.stale, false);
    });
  });

  it('reinstall on identical bytes reports up-to-date', async () => {
    await bootAndUse(async (handle) => {
      await post(handle, '/api/agent/install', { provider: 'claude', confirm: true });
      const res = await post(handle, '/api/agent/install', {
        provider: 'claude',
        confirm: true,
      });
      assert.equal(res.status, 200);
      const envelope = (await res.json()) as IStatusEnvelope;
      assert.equal(envelope.outcome, 'up-to-date');
      assert.equal(envelope.installed, true);
    });
  });

  it('tampered bytes: status reports stale, reinstall reports updated and restores', async () => {
    await bootAndUse(async (handle) => {
      await post(handle, '/api/agent/install', { provider: 'claude', confirm: true });
      writeFileSync(skillFilePath(), '# tampered by an older CLI\n');

      const status = (await (await getStatus(handle, 'claude')).json()) as IStatusEnvelope;
      assert.equal(status.installed, true);
      assert.equal(status.stale, true);

      const res = await post(handle, '/api/agent/install', {
        provider: 'claude',
        confirm: true,
      });
      assert.equal(res.status, 200);
      const envelope = (await res.json()) as IStatusEnvelope;
      assert.equal(envelope.outcome, 'updated');
      assert.equal(envelope.stale, false);
      assert.equal(readFileSync(skillFilePath(), 'utf8'), PROCESS_JOBS_SKILL_CONTENT);
    });
  });

  it('codex: installs into the shared territory and drops the lens marker', async () => {
    await bootAndUse(async (handle) => {
      const res = await post(handle, '/api/agent/install', {
        provider: 'codex',
        confirm: true,
      });
      assert.equal(res.status, 200);
      const envelope = (await res.json()) as IStatusEnvelope;
      assert.equal(envelope.outcome, 'installed');
      assert.equal(envelope.skillDir, '.agents/skills');
      assert.equal(
        readFileSync(join(root.fixtureRoot, '.agents/skills/sm-process-jobs/SKILL.md'), 'utf8'),
        PROCESS_JOBS_SKILL_CONTENT,
      );
      // The `.codex/` marker disambiguates the lens in the shared
      // `.agents/skills` territory (mirrors `sm agent install --for codex`).
      assert.equal(existsSync(join(root.fixtureRoot, '.codex')), true);
    });
  });
});

describe('POST /api/agent/uninstall, consent gate + idempotence', () => {
  it('412 confirm-required without confirm, skill untouched', async () => {
    await bootAndUse(async (handle) => {
      await post(handle, '/api/agent/install', { provider: 'claude', confirm: true });

      const res = await post(handle, '/api/agent/uninstall', { provider: 'claude' });
      assert.equal(res.status, 412);
      const envelope = (await res.json()) as { error: { code: string; message: string } };
      assert.equal(envelope.error.code, 'confirm-required');
      assert.equal(envelope.error.message.includes(`${SKILL_FOLDER_REL}/`), true);
      assert.equal(readFileSync(skillFilePath(), 'utf8'), PROCESS_JOBS_SKILL_CONTENT);
    });
  });

  it('uninstalls with confirm: true, then a second uninstall is a removed: false no-op', async () => {
    await bootAndUse(async (handle) => {
      await post(handle, '/api/agent/install', { provider: 'claude', confirm: true });

      const res = await post(handle, '/api/agent/uninstall', {
        provider: 'claude',
        confirm: true,
      });
      assert.equal(res.status, 200);
      const envelope = (await res.json()) as IStatusEnvelope;
      assert.equal(envelope.removed, true);
      assert.equal(envelope.installed, false);
      assert.equal(existsSync(join(root.fixtureRoot, SKILL_FOLDER_REL)), false);

      const again = await post(handle, '/api/agent/uninstall', {
        provider: 'claude',
        confirm: true,
      });
      assert.equal(again.status, 200);
      const secondEnvelope = (await again.json()) as IStatusEnvelope;
      assert.equal(secondEnvelope.removed, false);
      assert.equal(secondEnvelope.installed, false);
    });
  });
});
