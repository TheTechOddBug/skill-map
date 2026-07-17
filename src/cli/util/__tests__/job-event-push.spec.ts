/**
 * Unit tests for the CLI-to-server job-event push leg
 * (`cli/util/job-event-push.ts`, `spec/job-events.md` §Transport).
 *
 * The helper's whole contract is "best-effort, silent, cannot throw":
 *   - no serve.json (no server) resolves silently, no request.
 *   - a malformed serve.json resolves silently, no request.
 *   - a valid serve.json produces exactly one POST /api/job-events with
 *     the per-session token in x-skill-map-token and the envelope as the
 *     JSON body.
 *   - an unreachable server (stale serve.json) resolves silently within
 *     the abort window.
 *   - a serve.json whose scopeRoot names ANOTHER project is refused (a
 *     copied / tampered file must not cross projects), no request.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { pushJobEvent, type IJobEventEnvelope } from '../job-event-push.js';

let tmpRoot: string;
let counter = 0;

const ENVELOPE: IJobEventEnvelope = {
  type: 'job.claimed',
  timestamp: 1_745_159_455_300,
  runId: 'r-ext-20260420-143055-a3f2',
  jobId: 'd-20260420-143055-b001',
  data: { extensionId: 'core/skill-summarizer', nodeId: 'skills/my-skill.md' },
};

/** Fresh scope root with an empty `.skill-map/` directory. */
function freshScope(): string {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  mkdirSync(join(root, '.skill-map'), { recursive: true });
  return root;
}

/** Write a `serve.json` for `scopeRoot`, with optional field overrides. */
function writeServeJson(scopeRoot: string, overrides: Record<string, unknown> = {}): void {
  const info = {
    schemaVersion: 1,
    host: '127.0.0.1',
    port: 1,
    pid: process.pid,
    scopeRoot,
    startedAt: new Date().toISOString(),
    smVersion: '0.0.0-test',
    token: 'tok-test',
    ...overrides,
  };
  writeFileSync(join(scopeRoot, '.skill-map', 'serve.json'), JSON.stringify(info));
}

interface IStubRequest {
  url: string;
  token: string | undefined;
  body: unknown;
}

interface IStub {
  port: number;
  requests: IStubRequest[];
  close: () => Promise<void>;
}

/** Loopback stub server on port 0; records every request, answers 202. */
async function startStub(): Promise<IStub> {
  const requests: IStubRequest[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      raw += chunk;
    });
    req.on('end', () => {
      requests.push({
        url: req.url ?? '',
        token: req.headers['x-skill-map-token'] as string | undefined,
        body: JSON.parse(raw),
      });
      res.statusCode = 202;
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    requests,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
}

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-job-event-push-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('pushJobEvent', () => {
  it('resolves silently when serve.json is absent (no server running)', async () => {
    const root = freshScope();
    await pushJobEvent(root, ENVELOPE); // must not throw
  });

  it('resolves silently on a malformed serve.json', async () => {
    const root = freshScope();
    writeFileSync(join(root, '.skill-map', 'serve.json'), '{ not json at all');
    await pushJobEvent(root, ENVELOPE); // must not throw
  });

  it('POSTs the envelope to /api/job-events with the session token', async () => {
    const root = freshScope();
    const stub = await startStub();
    try {
      writeServeJson(root, { port: stub.port, token: 'tok-live' });
      await pushJobEvent(root, ENVELOPE);
      strictEqual(stub.requests.length, 1, 'exactly one push landed');
      const req = stub.requests[0]!;
      strictEqual(req.url, '/api/job-events');
      strictEqual(req.token, 'tok-live');
      deepStrictEqual(req.body, ENVELOPE, 'the envelope travels verbatim');
    } finally {
      await stub.close();
    }
  });

  it('resolves silently when the server is unreachable (stale serve.json)', async () => {
    const root = freshScope();
    // Grab a port that WAS live and close it: the classic crashed-server
    // leftover. The push must fail open, silently, within the abort window.
    const stub = await startStub();
    await stub.close();
    writeServeJson(root, { port: stub.port });
    const startedAt = Date.now();
    await pushJobEvent(root, ENVELOPE); // must not throw
    ok(Date.now() - startedAt < 2_000, 'resolved within the abort window');
  });

  it('refuses a serve.json whose scopeRoot names another project', async () => {
    const root = freshScope();
    const otherRoot = freshScope();
    const stub = await startStub();
    try {
      // serve.json copied from another project: right shape, wrong scope.
      writeServeJson(root, { port: stub.port, scopeRoot: otherRoot });
      await pushJobEvent(root, ENVELOPE);
      strictEqual(stub.requests.length, 0, 'no cross-project push');
    } finally {
      await stub.close();
    }
  });
});
