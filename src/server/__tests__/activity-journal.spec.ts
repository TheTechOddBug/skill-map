/**
 * `ActivityJournalService` unit tests, filesystem-only (no DB, no server
 * boot). The write / grouping / finalize / retention semantics are
 * normative in `spec/provider-activity.md` §Session journal; each case
 * pins one rule, and the written bytes are AJV-validated against
 * `spec/schemas/session-recording.schema.json` (the guard the coverage
 * matrix row 41 promises while no conformance case can drive a live
 * ingest).
 */

import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { defaultProjectSessionsDir } from '../../core/paths/db-path.js';
import { ActivityJournalService } from '../activity-journal.js';

/** Short debounce so the specs wait milliseconds, not the 2s default. */
const DEBOUNCE_MS = 5;

const roots: string[] = [];

function makeScope(opts?: { skillMapDir?: boolean }): string {
  const root = mkdtempSync(join(tmpdir(), 'skill-map-journal-'));
  roots.push(root);
  if (opts?.skillMapDir !== false) mkdirSync(join(root, '.skill-map'));
  return root;
}

/** Fake monotonic clock: deterministic timestamps and file names. */
function makeClock(startAt = 1_723_800_000_000): () => number {
  let at = startAt;
  return () => {
    at += 1000;
    return at;
  };
}

function makeJournal(
  root: string,
  opts?: Partial<ConstructorParameters<typeof ActivityJournalService>[0]> & {
    /** Capture gesture state; the harness arms it by default (2026-08-16). */
    recording?: boolean;
  },
): ActivityJournalService {
  const { recording, ...serviceOpts } = opts ?? {};
  const journal = new ActivityJournalService({
    enabled: true,
    sessionsDir: defaultProjectSessionsDir(root),
    cwd: root,
    debounceMs: DEBOUNCE_MS,
    now: makeClock(),
    ...serviceOpts,
  });
  // Capture is a gesture, never ambient: almost every case exercises
  // the capturing path, so the harness presses Record for them.
  if (recording !== false) journal.setRecording(true);
  return journal;
}

function sessionFiles(root: string): string[] {
  const dir = defaultProjectSessionsDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort();
}

function readSession(root: string, fileName: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(defaultProjectSessionsDir(root), fileName), 'utf8'),
  ) as Record<string, unknown>;
}

async function settle(ms = DEBOUNCE_MS * 6): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('ActivityJournalService writes', () => {
  it('persists a debounced session file that validates against session-recording.schema.json', async () => {
    const root = makeScope();
    const journal = makeJournal(root);
    journal.recordActivity('claude', {
      nodePath: '.claude/skills/deploy/SKILL.md',
      phase: 'start',
      owner: 'main:abc-123',
    });
    journal.recordActivity('claude', {
      nodePath: 'mcp://notion',
      phase: 'start',
      owner: 'main:abc-123',
      access: 'mcp',
      detail: 'notion-create-pages',
    });
    await settle();

    const files = sessionFiles(root);
    assert.equal(files.length, 1);
    const doc = readSession(root, files[0]!);
    const validated = loadSchemaValidators().validate('session-recording', doc);
    assert.equal(validated.ok, true, validated.ok ? '' : validated.errors);
    assert.equal(doc['rootOwner'], 'main:abc-123');
    // The `main:` prefix hint fills sessionId, and the suffix names the file.
    assert.equal(doc['sessionId'], 'abc-123');
    assert.match(files[0]!, /-abc-123\.json$/);
    assert.equal(doc['provider'], 'claude');
    assert.equal((doc['frames'] as unknown[]).length, 2);
    // Still open: finalization has not stamped endedAt.
    assert.equal('endedAt' in doc, false);
    journal.shutdown();
  });

  it('strips the boot-scoped derived fields (stats / pairCount) from journaled frames', async () => {
    const root = makeScope();
    const journal = makeJournal(root);
    // Defensive-strip check: hand the journal ALREADY-enriched payloads
    // (the real call site feeds pre-enrichment data; the strip guards a
    // future reorder).
    journal.recordActivity('claude', {
      nodePath: '.claude/skills/deploy/SKILL.md',
      phase: 'start',
      owner: 'main:s1',
      stats: { count: 3, lastStartAt: 1, distinctOwners: 1 },
    });
    journal.recordSpawn('claude', {
      spawnId: 'tool-1',
      phase: 'start',
      parentOwner: 'main:s1',
      childName: 'architect',
      pairCount: 7,
    });
    await settle();

    const files = sessionFiles(root);
    assert.equal(files.length, 1);
    const doc = readSession(root, files[0]!);
    const frames = doc['frames'] as Array<{ type: string; data: Record<string, unknown> }>;
    assert.equal(frames.length, 2);
    assert.equal('stats' in frames[0]!.data, false);
    assert.equal('pairCount' in frames[1]!.data, false);
    // The closed frame shapes are what make content-free-by-construction
    // hold, so the stripped document must still validate.
    const validated = loadSchemaValidators().validate('session-recording', doc);
    assert.equal(validated.ok, true, validated.ok ? '' : validated.errors);
    journal.shutdown();
  });
});

describe('ActivityJournalService grouping', () => {
  it('attributes a spawned child owner to the spawning session (structural claim)', async () => {
    const root = makeScope();
    const journal = makeJournal(root);
    // Session context spawns (no parentNodePath => parentOwner is a root).
    journal.recordSpawn('claude', {
      spawnId: 'spawn-1',
      phase: 'start',
      parentOwner: 'main:s1',
      childName: 'architect',
    });
    journal.recordSpawn('claude', {
      spawnId: 'spawn-1',
      phase: 'handoff',
      parentOwner: 'main:s1',
      childOwner: 'agent-1',
    });
    // The child's own activity lands in the SAME session.
    journal.recordActivity('claude', {
      nodePath: '.claude/agents/architect.md',
      phase: 'start',
      owner: 'agent-1',
      sticky: true,
    });
    // A different root opens a second session.
    journal.recordActivity('claude', {
      nodePath: 'README.md',
      phase: 'start',
      owner: 'main:s2',
    });
    await settle();

    const files = sessionFiles(root);
    assert.equal(files.length, 2);
    const bySession = files.map((f) => readSession(root, f));
    const s1 = bySession.find((d) => d['rootOwner'] === 'main:s1');
    const s2 = bySession.find((d) => d['rootOwner'] === 'main:s2');
    assert.ok(s1);
    assert.ok(s2);
    assert.equal((s1['frames'] as unknown[]).length, 3);
    assert.equal((s2['frames'] as unknown[]).length, 1);
    journal.shutdown();
  });

  it('an unattributable frame rides the most recent open session, else the unattributed bucket', async () => {
    const root = makeScope();
    const journal = makeJournal(root);
    // Nothing open yet: the ownerless frame falls to the bucket file.
    journal.recordActivity('claude', { phase: 'end', turnEnd: true });
    // A session is open now: the next ownerless frame rides it instead.
    journal.recordActivity('claude', {
      nodePath: 'README.md',
      phase: 'start',
      owner: 'main:s1',
    });
    journal.recordActivity('claude', { phase: 'end', turnEnd: true });
    await settle();

    const files = sessionFiles(root);
    assert.equal(files.length, 2);
    const docs = files.map((f) => readSession(root, f));
    const bucket = docs.find((d) => d['rootOwner'] === '');
    const session = docs.find((d) => d['rootOwner'] === 'main:s1');
    assert.ok(bucket);
    assert.ok(session);
    assert.equal((bucket['frames'] as unknown[]).length, 1);
    assert.equal((session['frames'] as unknown[]).length, 2);
    // The bucket file is schema-legal: the empty rootOwner is its identity.
    const validated = loadSchemaValidators().validate('session-recording', bucket);
    assert.equal(validated.ok, true, validated.ok ? '' : validated.errors);
    journal.shutdown();
  });

  it('a late childOwner claim adopts the session mis-rooted at that owner (hook race)', async () => {
    const root = makeScope();
    const journal = makeJournal(root);
    // The real 2026-08-16 trace: the child's sticky claim beat the
    // handoff frame that declares its owner, so the streaming fold had
    // already opened a first-sight session for it.
    journal.recordSpawn('claude', {
      spawnId: 'spawn-1',
      phase: 'start',
      parentOwner: 'main:s1',
      childName: 'content-editor',
    });
    journal.recordActivity('claude', {
      nodePath: '.claude/agents/content-editor.md',
      phase: 'start',
      owner: 'agent-1',
      sticky: true,
    });
    journal.recordSpawn('claude', {
      spawnId: 'spawn-1',
      phase: 'handoff',
      parentOwner: 'main:s1',
      childOwner: 'agent-1',
    });
    journal.recordActivity('claude', {
      nodePath: 'docs/STYLE.md',
      phase: 'start',
      owner: 'agent-1',
      access: 'read',
    });
    await settle();

    const files = sessionFiles(root);
    assert.equal(files.length, 1);
    const doc = readSession(root, files[0]!);
    assert.equal(doc['rootOwner'], 'main:s1');
    const frames = doc['frames'] as Array<{ tMs: number; type: string }>;
    assert.equal(frames.length, 4);
    // Chronological after the merge: the raced sticky sits between the
    // spawn start and the handoff, where it actually happened.
    assert.deepEqual(
      frames.map((f) => f.type),
      ['agent.spawn', 'node.activity', 'agent.spawn', 'node.activity'],
    );
    assert.ok(frames.every((f, i) => i === 0 || f.tMs >= frames[i - 1]!.tMs));
    journal.shutdown();
  });

  it('adoption removes an orphan file the debounce already flushed', async () => {
    const root = makeScope();
    const journal = makeJournal(root);
    journal.recordActivity('claude', {
      nodePath: '.claude/agents/content-editor.md',
      phase: 'start',
      owner: 'agent-1',
      sticky: true,
    });
    journal.flushNow();
    assert.equal(sessionFiles(root).length, 1);

    journal.recordSpawn('claude', {
      spawnId: 'spawn-1',
      phase: 'handoff',
      parentOwner: 'main:s1',
      childOwner: 'agent-1',
    });
    journal.flushNow();
    const files = sessionFiles(root);
    assert.equal(files.length, 1);
    const doc = readSession(root, files[0]!);
    assert.equal(doc['rootOwner'], 'main:s1');
    assert.equal((doc['frames'] as unknown[]).length, 2);
    journal.shutdown();
  });
});

describe('ActivityJournalService capture-level stamp', () => {
  it('stamps each recording with the MINIMUM level active while it captured', async () => {
    const root = makeScope();
    let level = 'mcp';
    const journal = makeJournal(root, { captureLevel: () => level });
    journal.recordActivity('claude', {
      nodePath: 'README.md',
      phase: 'start',
      owner: 'main:s1',
      session: 's1',
    });
    // The operator dips the selector mid-recording: the stamp must
    // remember the weakest window (those frame classes are gone).
    level = 'executions';
    journal.recordActivity('claude', {
      nodePath: '.claude/skills/deploy/SKILL.md',
      phase: 'start',
      owner: 'main:s1',
    });
    level = 'mcp';
    journal.recordActivity('claude', { phase: 'end', sessionScope: true, session: 's1' });
    await settle();

    const files = sessionFiles(root);
    assert.equal(files.length, 1);
    const doc = readSession(root, files[0]!);
    assert.equal(doc['captureLevel'], 'executions');
    // The stamped envelope stays schema-legal.
    const validated = loadSchemaValidators().validate('session-recording', doc);
    assert.equal(validated.ok, true, validated.ok ? '' : validated.errors);
    journal.shutdown();
  });
});

describe('ActivityJournalService finalization', () => {
  it('finalizes on a sessionScope end: endedAt stamped + one operations-log line', async () => {
    const root = makeScope();
    const journal = makeJournal(root);
    journal.recordActivity('codex', {
      nodePath: '.codex/agents/worker.toml',
      phase: 'start',
      owner: 'main:sess-9',
      session: 'sess-9',
    });
    journal.recordActivity('codex', {
      phase: 'end',
      sessionScope: true,
      session: 'sess-9',
    });
    await settle();

    const files = sessionFiles(root);
    assert.equal(files.length, 1);
    const doc = readSession(root, files[0]!);
    assert.equal(typeof doc['endedAt'], 'number');
    const validated = loadSchemaValidators().validate('session-recording', doc);
    assert.equal(validated.ok, true, validated.ok ? '' : validated.errors);

    const log = readFileSync(join(root, '.skill-map', 'operations.log'), 'utf8');
    const lines = log.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    const writes = lines.filter((l) => l['op'] === 'activity.session-write');
    assert.equal(writes.length, 1);
    assert.equal(writes[0]!['channel'], 'hook');
    assert.equal(writes[0]!['target'], '*');
    assert.equal(writes[0]!['detail'], 'frames=2');
    journal.shutdown();
  });

  it('a terminal ownerScope end finalizes only when the owner IS a session root', () => {
    const root = makeScope();
    const journal = makeJournal(root, { debounceMs: 60_000 });
    journal.recordActivity('antigravity', {
      nodePath: 'README.md',
      phase: 'start',
      owner: 'main:s1',
    });
    journal.recordSpawn('antigravity', {
      spawnId: 'spawn-1',
      phase: 'handoff',
      parentOwner: 'main:s1',
      childOwner: 'agent-1',
    });
    // A SUBAGENT's terminal end never closes the session it belongs to.
    journal.recordActivity('antigravity', {
      nodePath: '.claude/agents/worker.md',
      phase: 'end',
      owner: 'agent-1',
      ownerScope: true,
    });
    assert.equal(sessionFiles(root).length, 0);

    // The ROOT owner's terminal end is the fully-idle Stop shape: close.
    journal.recordActivity('antigravity', {
      phase: 'end',
      owner: 'main:s1',
      ownerScope: true,
    });
    const files = sessionFiles(root);
    assert.equal(files.length, 1);
    assert.equal(typeof readSession(root, files[0]!)['endedAt'], 'number');
    journal.shutdown();
  });

  it('a finalized session REOPENS onto its same file when its root keeps talking (codex per-turn Stop)', async () => {
    const root = makeScope();
    const journal = makeJournal(root);
    // Turn 1: activity + the per-turn sessionScope release codex emits.
    journal.recordActivity('codex', {
      nodePath: 'README.md',
      phase: 'start',
      owner: 'main:s1',
      session: 's1',
    });
    journal.recordActivity('codex', { phase: 'end', sessionScope: true, session: 's1' });
    const afterTurn1 = sessionFiles(root);
    assert.equal(afterTurn1.length, 1);
    assert.equal(typeof readSession(root, afterTurn1[0]!)['endedAt'], 'number');

    // Turn 2: the SAME conversation keeps going; without reopen this
    // would fragment into a second file.
    journal.recordActivity('codex', {
      nodePath: 'docs/STYLE.md',
      phase: 'start',
      owner: 'main:s1',
      session: 's1',
    });
    journal.flushNow();
    const reopened = sessionFiles(root);
    assert.equal(reopened.length, 1);
    assert.equal(reopened[0], afterTurn1[0]); // same file, stable name
    const openDoc = readSession(root, reopened[0]!);
    assert.equal((openDoc['frames'] as unknown[]).length, 3);
    assert.equal('endedAt' in openDoc, false); // open again until the next release

    // Turn 2's release re-finalizes the same file.
    journal.recordActivity('codex', { phase: 'end', sessionScope: true, session: 's1' });
    const closed = readSession(root, sessionFiles(root)[0]!);
    assert.equal((closed['frames'] as unknown[]).length, 4);
    assert.equal(typeof closed['endedAt'], 'number');
    journal.shutdown();
  });

  it('the reopen memory dies with the recording window: a new gesture starts a new file', async () => {
    const root = makeScope();
    const journal = makeJournal(root);
    journal.recordActivity('codex', {
      nodePath: 'README.md',
      phase: 'start',
      owner: 'main:s1',
      session: 's1',
    });
    journal.recordActivity('codex', { phase: 'end', sessionScope: true, session: 's1' });
    assert.equal(journal.setRecording(false), false);
    assert.equal(sessionFiles(root).length, 1);

    // A NEW recording window: the same conversation opens a fresh file.
    assert.equal(journal.setRecording(true), true);
    journal.recordActivity('codex', {
      nodePath: 'README.md',
      phase: 'start',
      owner: 'main:s1',
      session: 's1',
    });
    journal.flushNow();
    assert.equal(sessionFiles(root).length, 2);
    journal.shutdown();
  });

  it('shutdown flushes and finalizes still-open sessions before the debounce fires', () => {
    const root = makeScope();
    const journal = makeJournal(root, { debounceMs: 60_000 });
    journal.recordActivity('claude', {
      nodePath: 'README.md',
      phase: 'start',
      owner: 'main:s1',
    });
    journal.shutdown();

    const files = sessionFiles(root);
    assert.equal(files.length, 1);
    const doc = readSession(root, files[0]!);
    assert.equal(typeof doc['endedAt'], 'number');
    // Idempotent: a second shutdown neither throws nor duplicates.
    journal.shutdown();
    assert.equal(sessionFiles(root).length, 1);
  });
});

describe('ActivityJournalService retention', () => {
  it('prunes oldest files past the file-count bound at finalization', async () => {
    const root = makeScope();
    const journal = makeJournal(root, { maxFiles: 2 });
    for (const id of ['s1', 's2', 's3']) {
      journal.recordActivity('codex', {
        nodePath: 'README.md',
        phase: 'start',
        owner: `main:${id}`,
        session: id,
      });
      journal.recordActivity('codex', { phase: 'end', sessionScope: true, session: id });
    }
    await settle();

    const files = sessionFiles(root);
    assert.equal(files.length, 2);
    // Oldest-first deletion: the s1 file (earliest startedAt) is gone.
    assert.equal(files.some((f) => f.endsWith('-s1.json')), false);
    journal.shutdown();
  });

  it('prunes oldest first past the total-byte bound too', async () => {
    const root = makeScope();
    // Each padded file lands well under the bound alone and well over
    // it combined, so the sweep must drop exactly the oldest.
    const journal = makeJournal(root, { maxTotalBytes: 1200 });
    for (const id of ['s1', 's2']) {
      journal.recordActivity('codex', {
        nodePath: 'README.md',
        phase: 'start',
        owner: `main:${id}`,
        session: id,
        detail: 'x'.repeat(500),
      });
      journal.recordActivity('codex', { phase: 'end', sessionScope: true, session: id });
    }
    await settle();

    const files = sessionFiles(root);
    assert.equal(files.length, 1);
    assert.equal(files[0]!.endsWith('-s2.json'), true);
    journal.shutdown();
  });
});

describe('ActivityJournalService.clearAll', () => {
  it('wipes every file AND the open buffers, so a later flush cannot resurrect them', async () => {
    const root = makeScope();
    const journal = makeJournal(root, { debounceMs: 60_000 });
    // One finalized file on disk plus one still-open in-memory session.
    journal.recordActivity('codex', {
      nodePath: 'README.md',
      phase: 'start',
      owner: 'main:s1',
      session: 's1',
    });
    journal.recordActivity('codex', { phase: 'end', sessionScope: true, session: 's1' });
    journal.recordActivity('claude', {
      nodePath: 'README.md',
      phase: 'start',
      owner: 'main:s2',
    });
    assert.equal(sessionFiles(root).length, 1);

    assert.equal(journal.clearAll(), 1);
    assert.equal(sessionFiles(root).length, 0);

    // The buffered session went with the wipe: shutdown finalizes NOTHING.
    journal.shutdown();
    await settle();
    assert.equal(sessionFiles(root).length, 0);
  });

  it('works while the write gate is off (prior boots left files behind)', () => {
    const root = makeScope();
    mkdirSync(defaultProjectSessionsDir(root), { recursive: true });
    writeFileSync(join(defaultProjectSessionsDir(root), 'old.json'), '{}');
    const journal = makeJournal(root, { enabled: false });
    assert.equal(journal.clearAll(), 1);
    assert.equal(sessionFiles(root).length, 0);
  });
});

describe('ActivityJournalService recording gesture', () => {
  it('captures NOTHING unless the operator pressed record (never ambient)', async () => {
    const root = makeScope();
    const journal = makeJournal(root, { recording: false });
    journal.recordActivity('claude', {
      nodePath: 'README.md',
      phase: 'start',
      owner: 'main:s1',
    });
    await settle();
    assert.equal(journal.isRecording(), false);
    assert.equal(sessionFiles(root).length, 0);

    assert.equal(journal.setRecording(true), true);
    journal.recordActivity('claude', {
      nodePath: 'README.md',
      phase: 'start',
      owner: 'main:s1',
    });
    await settle();
    assert.equal(sessionFiles(root).length, 1);
  });

  it('stopping finalizes every open session (endedAt + operations line)', async () => {
    const root = makeScope();
    const journal = makeJournal(root, { debounceMs: 60_000 });
    journal.recordActivity('claude', {
      nodePath: 'README.md',
      phase: 'start',
      owner: 'main:s1',
    });
    assert.equal(journal.setRecording(false), false);
    const files = sessionFiles(root);
    assert.equal(files.length, 1);
    assert.equal(typeof readSession(root, files[0]!)['endedAt'], 'number');
    // Frames arriving after the stop never land.
    journal.recordActivity('claude', {
      nodePath: 'README.md',
      phase: 'start',
      owner: 'main:s2',
    });
    await settle();
    assert.equal(sessionFiles(root).length, 1);
  });

  it('the master switch off refuses to engage the recording toggle', () => {
    const root = makeScope();
    const journal = makeJournal(root, { enabled: false, recording: false });
    assert.equal(journal.setRecording(true), false);
    assert.equal(journal.isRecording(), false);
  });
});

describe('ActivityJournalService gates', () => {
  it('is a full no-op when the enabled gate is off', async () => {
    const root = makeScope();
    const journal = makeJournal(root, { enabled: false });
    journal.recordActivity('claude', {
      nodePath: 'README.md',
      phase: 'start',
      owner: 'main:s1',
    });
    await settle();
    journal.shutdown();
    assert.equal(existsSync(defaultProjectSessionsDir(root)), false);
  });

  it('stays silent without a .skill-map directory (never provisions the scope)', async () => {
    const root = makeScope({ skillMapDir: false });
    const journal = makeJournal(root);
    journal.recordActivity('claude', {
      nodePath: 'README.md',
      phase: 'start',
      owner: 'main:s1',
    });
    await settle();
    journal.shutdown();
    assert.equal(existsSync(join(root, '.skill-map')), false);
  });
});
