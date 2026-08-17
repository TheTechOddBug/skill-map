/**
 * The session-journal HTTP surface (`spec/provider-activity.md`
 * §Session journal):
 *
 *   - `GET /api/activity/sessions` → `{ schemaVersion: '1', kind:
 *     'activity-sessions', sessions: SessionRecording[], skipped:
 *     string[] }`, the read-back for client hydration. Files read
 *     fresh per request in name order (chronological), AJV-validated
 *     against `session-recording.schema.json` with off-shape basenames
 *     honesty-listed in `skipped` (the map-views dialect); pending
 *     journal buffers flush first so a just-recorded session is
 *     visible without waiting out the debounce.
 *   - `POST /api/activity/sessions/recording` → the capture toggle
 *     (capture is a GESTURE, 2026-08-16): body `{ recording: bool }`,
 *     response the EFFECTIVE state (the boot master switch can refuse
 *     to engage). Stopping finalizes every open session; the GET above
 *     also stamps the live state so a reloaded page restores its
 *     control.
 *   - `DELETE /api/activity/sessions` → the wipe: empties
 *     `.skill-map/sessions/` AND the serve process's open in-memory
 *     buffers in one gesture, so a pending flush cannot resurrect a
 *     wiped file. Always `204` (an absent directory included); ONE
 *     `activity.sessions-clear` operations line with the deleted count.
 *
 * Loopback-gated like every `/api/*` route, NO serve.json token: this
 * is an operator UI surface (the SPA's Sessions tab and its
 * delete-recording affordances), not the bridge's ingest path.
 */

import type { Hono } from 'hono';

import { appendOperation } from '../../core/operations-log.js';
import type { IRuntimeContext } from '../../core/runtime/runtime-context.js';
import { readSessionJournalDetailed } from '../../kernel/session-journal/index.js';
import type { ActivityJournalService } from '../activity-journal.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { writeConfigValue } from '../../core/config/helper.js';
import {
  CAPTURE_LEVELS,
  type CaptureLevelState,
  type TCaptureLevel,
} from '../capture-level.js';
import { makeBodyValidator } from '../util/parse-body.js';

interface IRecordingBody {
  recording: boolean;
}

const RECORDING_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recording'],
  properties: {
    recording: { type: 'boolean' },
  },
} as const;

const CAPTURE_LEVEL_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['level'],
  properties: {
    level: { type: 'string', enum: [...CAPTURE_LEVELS] },
  },
} as const;

interface ICaptureLevelBody {
  level: TCaptureLevel;
}

const parseCaptureLevelBody = makeBodyValidator<ICaptureLevelBody>(CAPTURE_LEVEL_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.activityBodyNotJson,
  notObject: SERVER_TEXTS.activityBodyNotObject,
  invalid: SERVER_TEXTS.activityBodyNotObject,
});

const parseRecordingBody = makeBodyValidator<IRecordingBody>(RECORDING_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.activityBodyNotJson,
  notObject: SERVER_TEXTS.activityBodyNotObject,
  invalid: SERVER_TEXTS.activityBodyNotObject,
});

export interface IActivitySessionsRouteDeps {
  /**
   * Session journal (composition-root owned, explicit extra dep by the
   * activity custody contract, never on `IRouteDeps`).
   */
  journal: ActivityJournalService;
  /** Live capture-level cell (spec provider-activity.md, Capture level). */
  captureLevel: CaptureLevelState;
  /** Absolute `.skill-map/sessions` directory the GET reads. */
  sessionsDir: string;
  /** Boot runtime context; `cwd` anchors the operations-log line. */
  runtimeContext: IRuntimeContext;
}

export function registerActivitySessionsRoute(
  app: Hono,
  deps: IActivitySessionsRouteDeps,
): void {
  app.get('/api/activity/sessions', (c) => {
    deps.journal.flushNow();
    const { recordings, skipped } = readSessionJournalDetailed(deps.sessionsDir);
    return c.json({
      schemaVersion: '1',
      kind: 'activity-sessions',
      sessions: recordings,
      skipped,
      // The live capture state, so a reloaded page restores its
      // Record/Stop control (spec §Session journal · Capture is a
      // gesture).
      recording: deps.journal.isRecording(),
      // The live ladder position, so the level selector hydrates
      // (spec §Capture level).
      captureLevel: deps.captureLevel.current(),
    });
  });

  // Capture toggle (spec §Session journal · Capture is a gesture):
  // engaging requires the boot master switch, so the response carries
  // the EFFECTIVE state; disengaging finalizes every open session
  // (each logs its own `activity.session-write` line). Runtime state
  // only, so the toggle itself logs nothing.
  app.post('/api/activity/sessions/recording', async (c) => {
    const body = await parseRecordingBody(c.req.raw);
    const recording = deps.journal.setRecording(body.recording);
    return c.json({ recording });
  });

  // Capture-level move (spec §Capture level): updates the live ingest
  // filter immediately (stats, journal, broadcast all follow) AND
  // persists the project-local `activity.captureLevel` key so the next
  // boot resumes it. The persist is best-effort: a read-only scope
  // still moves the live level for this boot.
  app.post('/api/activity/capture-level', async (c) => {
    const body = await parseCaptureLevelBody(c.req.raw);
    // LOCKED while recording (spec §Capture level): a mid-recording
    // move is ambiguous to everyone watching, so the route answers the
    // unchanged effective level, mirroring the master-switch refusal
    // dialect of the recording toggle above.
    if (deps.journal.isRecording()) {
      return c.json({ captureLevel: deps.captureLevel.current() });
    }
    deps.captureLevel.set(body.level);
    try {
      writeConfigValue('activity.captureLevel', body.level, {
        cwd: deps.runtimeContext.cwd,
        target: 'project-local',
      });
    } catch {
      // Best-effort persistence; the live cell already moved.
    }
    return c.json({ captureLevel: deps.captureLevel.current() });
  });

  app.delete('/api/activity/sessions', (c) => {
    const deleted = deps.journal.clearAll();
    appendOperation(deps.runtimeContext.cwd, {
      op: 'activity.sessions-clear',
      target: '*',
      channel: 'ui',
      outcome: 'ok',
      detail: `deleted=${deleted}`,
    });
    return c.body(null, 204);
  });
}
