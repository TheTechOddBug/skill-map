/**
 * `POST /api/activity`, live-activity ingest (see
 * `spec/provider-activity.md` §Ingest).
 *
 * The activity bridge (a short-lived, zero-dependency process the
 * provider runtime spawns per hook event, or opencode's in-process
 * plugin) forwards ONE raw provider hook payload per request:
 *
 *   `{ provider: "<provider-id>", event: <raw payload> }`
 *
 * with the per-session token from `serve.json` in the
 * `x-skill-map-token` header. Flow:
 *
 *   1. Token gate FIRST, before any body processing: missing / wrong
 *      token rejects 403 `token-mismatch` (typed `ActivityTokenError`,
 *      the loopback gate's sibling). Constant-time comparison so the
 *      check leaks nothing about the expected value.
 *   2. AJV body validation via the shared `makeBodyValidator` factory.
 *   2b. Wiring self-test short-circuit: an event carrying
 *      `__skillMapProbe` is recorded in the boot-scoped nonce ring and
 *      answered `202` immediately, BEFORE any mapping, so a probe never
 *      lights a node, counts as an execution, or broadcasts a frame
 *      (`spec/provider-activity.md` §Wiring self-test).
 *   3. `resolveActivityEvent` maps the raw event through the Provider's
 *      `activity.mapEvent` and resolves each signal against the scanned
 *      node set. Per resolved activity payload the stats accumulator
 *      records it and one (stats-enriched, when the start counted)
 *      `node.activity` WS envelope broadcasts; per resolved spawn the
 *      consent-gated conversation store records it (a no-op while the
 *      gate is off) and one METADATA-ONLY `agent.spawn` envelope
 *      broadcasts.
 *   4. `202` accepted ALWAYS on a well-formed request, also when nothing
 *      resolved: the bridge is fire-and-forget and never needs the
 *      outcome.
 *
 * **Privacy invariant (normative)**: the request body may carry prompts,
 * command text, even file contents. It is never logged, never thrown
 * inside an error message, never persisted, and never forwarded beyond
 * the mapper. The `node.activity` payload carries only the resolved
 * shape (`nodePath`, `phase`, `owner?`, flags, server-side stats); the
 * `agent.spawn` payload is projected through `toSpawnEventData`, whose
 * return type has NO content fields, so the conversation halves
 * (`prompt` / `response`) cannot ride the WS by construction. They
 * reach ONLY the in-memory conversation store, and only while the
 * capture gate is on.
 */

import type { Hono } from 'hono';

import type { WsBroadcaster } from '../broadcaster.js';
import type { ActivityConversationStore } from '../activity-conversations.js';
import type { ActivityJournalService } from '../activity-journal.js';
import type { ActivityOwnerIndex } from '../activity-owner-index.js';
import { probeNonceOf, type ActivityProbeStore } from '../activity-probe.js';
import type { ActivityStatsService } from '../activity-stats.js';
import {
  buildAgentSpawnEvent,
  buildNodeActivityEvent,
  type IAgentSpawnEventData,
  type INodeActivityEventData,
} from '../events.js';
import {
  resolveActivityEvent,
  type IActivityResolution,
  type IResolvedSpawn,
} from '../activity-resolver.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { assertIngestToken, INGEST_TOKEN_HEADER } from '../util/ingest-token.js';
import { makeBodyValidator } from '../util/parse-body.js';
import type { IRouteDeps } from './deps.js';
import { log } from '../../kernel/util/logger.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';

interface IActivityBody {
  /** Registered provider id the bridge was installed for (e.g. `claude`). */
  provider: string;
  /** The provider runtime's raw hook payload, forwarded verbatim. */
  event: Record<string, unknown>;
}

const ACTIVITY_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['provider', 'event'],
  properties: {
    provider: { type: 'string', minLength: 1 },
    event: { type: 'object' },
    // Tolerated and ignored: generated OpenCode plugins installed before
    // the agent doorbell was removed stamp this on every ingest. Accepting
    // it keeps their activity alive until `sm activity install` regenerates
    // the plugin; nothing reads it.
    agentEndpoint: { type: 'string' },
  },
} as const;

const parseBody = makeBodyValidator<IActivityBody>(ACTIVITY_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.activityBodyNotJson,
  notObject: SERVER_TEXTS.activityBodyNotObject,
  invalid: SERVER_TEXTS.activityBodyNotObject,
  mapping: {
    '/provider:required': SERVER_TEXTS.activityProviderRequired,
    '/provider:type:string': SERVER_TEXTS.activityProviderRequired,
    '/provider:minLength': SERVER_TEXTS.activityProviderRequired,
    '/event:required': SERVER_TEXTS.activityEventRequired,
    '/event:type:object': SERVER_TEXTS.activityEventRequired,
  },
});

export interface IActivityRouteDeps extends IRouteDeps {
  broadcaster: WsBroadcaster;
  /** Per-session shared secret minted by the composition root at boot. */
  activityToken: string;
  /** Boot-scoped self-test nonce ring (composition-root owned). */
  probes: ActivityProbeStore;
  /** Boot-scoped execution-stats accumulator (composition-root owned). */
  stats: ActivityStatsService;
  /**
   * Boot-scoped `owner -> agent node` index (composition-root owned):
   * anchors a spawn that names no parent on the agent that owner runs.
   */
  owners: ActivityOwnerIndex;
  /**
   * Consent-gated conversation store. Explicit extra dep by custody
   * contract (never on `IRouteDeps`, see `activity-conversations.ts`).
   */
  conversations: ActivityConversationStore;
  /**
   * Session journal (see `activity-journal.ts`). Fed at THIS
   * post-resolution seam only, and only with the wire-shaped payloads:
   * the pre-stats `node.activity` data and the metadata-only spawn
   * projection before `pairCount` attaches, so the boot-scoped derived
   * fields (and any content) can never reach disk. Fire-and-forget
   * inside; a journal failure never fails ingest.
   */
  journal: ActivityJournalService;
}

export function registerActivityRoute(app: Hono, deps: IActivityRouteDeps): void {
  app.post('/api/activity', async (c) => {
    assertTokenLogged(c.req.raw.headers.get(INGEST_TOKEN_HEADER), deps.activityToken);
    const body = await parseBody(c.req.raw);

    // Wiring self-test (spec §Wiring self-test): recorded and answered
    // BEFORE any mapping, so a probe can never light a node, count as
    // an execution, or broadcast a frame. The token gate above already
    // ran, which is the point: the self-test covers that path too.
    if (recordProbe(deps.probes, body)) return c.json({ ok: true, probe: true }, 202);

    const resolution = await resolveActivityEvent({
      providers: deps.providers,
      dbPath: deps.options.dbPath,
      providerId: body.provider,
      raw: body.event,
      owners: deps.owners,
    });
    logActivityIngest(body.provider, body.event, resolution);
    const { activity, spawns, reports } = resolution;
    broadcastActivity(deps, activity, body.provider);
    broadcastSpawns(deps, spawns, body.provider);
    // End-of-context reports (the async response source) go ONLY to
    // the gated store; like the spawn halves they never broadcast.
    for (const report of reports) {
      deps.conversations.attachReport(report.owner, report.report);
    }

    return c.json({ ok: true, resolved: activity.length, spawns: spawns.length }, 202);
  });
}

/**
 * Feed each resolved signal to the stats accumulator, journal the
 * PRE-enrichment payload (the journal strips `stats` by contract, so it
 * receives the data before the accumulator snapshot attaches), and
 * broadcast one `node.activity` frame per signal (stats-enriched when
 * the start counted).
 */
function broadcastActivity(
  deps: IActivityRouteDeps,
  activity: readonly INodeActivityEventData[],
  provider: string,
): void {
  for (const data of activity) {
    deps.journal.recordActivity(provider, data);
    const stats = deps.stats.record(data);
    const payload: INodeActivityEventData = stats ? { ...data, stats } : data;
    deps.broadcaster.broadcast(buildNodeActivityEvent(payload));
  }
}

/**
 * Per resolved spawn: record it in the consent-gated conversation store
 * (a no-op while the gate is off), count the pair, attribute any
 * execution totals to the child, journal the metadata-only projection
 * (BEFORE `pairCount` attaches, so the boot-scoped counter never lands
 * on disk), and broadcast the METADATA-ONLY frame.
 */
function broadcastSpawns(
  deps: IActivityRouteDeps,
  spawns: readonly IResolvedSpawn[],
  provider: string,
): void {
  for (const spawn of spawns) {
    deps.conversations.record(spawn);
    const pairCount = deps.stats.recordSpawn(spawn);
    if (spawn.execution !== undefined && spawn.childNodePath !== undefined) {
      deps.stats.recordExecution(spawn.childNodePath, spawn.execution);
    }
    const data = toSpawnEventData(spawn);
    deps.journal.recordSpawn(provider, data);
    if (pairCount !== null) data.pairCount = pairCount;
    deps.broadcaster.broadcast(buildAgentSpawnEvent(data));
  }
}

/**
 * Record a wiring-self-test probe and report whether the body WAS one
 * (in which case the caller must answer without mapping anything). One
 * INFO line so an operator watching `sm serve --log-level info` sees the
 * self-test land; the nonce is skill-map's own value, never user content.
 */
function recordProbe(probes: ActivityProbeStore, body: IActivityBody): boolean {
  const nonce = probeNonceOf(body.event);
  if (nonce === null) return false;
  probes.record(nonce);
  log.info(`activity: ${sanitizeForTerminal(body.provider)} <- wiring self-test probe`);
  return true;
}

/**
 * Project the internal resolved spawn onto the wire event shape by
 * EXPLICIT field picks. `prompt` / `response` have no counterpart on
 * `IAgentSpawnEventData`, so content cannot leak onto the WS through
 * this seam even if `IResolvedSpawn` grows new fields.
 */
function toSpawnEventData(spawn: IResolvedSpawn): IAgentSpawnEventData {
  const data: IAgentSpawnEventData = {
    spawnId: spawn.spawnId,
    phase: spawn.phase,
    parentOwner: spawn.parentOwner,
  };
  if (spawn.parentNodePath !== undefined) data.parentNodePath = spawn.parentNodePath;
  if (spawn.childKind !== undefined) data.childKind = spawn.childKind;
  if (spawn.childName !== undefined) data.childName = spawn.childName;
  if (spawn.childNodePath !== undefined) data.childNodePath = spawn.childNodePath;
  if (spawn.childOwner !== undefined) data.childOwner = spawn.childOwner;
  return data;
}

/**
 * Emit ONE observability line per ingested activity event so an operator
 * debugging a Provider's live-activity wiring (`sm serve --log-level
 * info`) can see whether a hook fired and where it ended up, instead of
 * the four silent 202 short-circuits. Hard drops (`no-provider`: the
 * untrusted / disabled / unknown case) log at WARN so they surface at the
 * default level; the soft outcomes log at INFO.
 *
 * Privacy (spec/provider-activity.md): only the Provider id, a sanitized
 * hook-type discriminator, and signal / payload COUNTS are logged, never
 * any field of the event body beyond that single discriminator.
 */
function logActivityIngest(
  providerId: string,
  rawEvent: unknown,
  r: IActivityResolution,
): void {
  const hook = extractHookLabel(rawEvent);
  const tag = hook ? `${providerId} ${hook}` : providerId;
  switch (r.outcome) {
    case 'resolved':
      log.info(`activity: ${tag} -> ${r.activity.length} activity, ${r.spawns.length} spawn(s)`);
      return;
    case 'no-signals':
      log.info(`activity: ${tag} -> 0 signals (provider mapped nothing)`);
      return;
    case 'no-nodes':
      log.info(`activity: ${tag} -> dropped (no scanned nodes yet; run a scan)`);
      return;
    case 'unresolved':
      log.info(`activity: ${tag} -> dropped (${r.signalCount} signal(s), none matched a node)`);
      return;
    case 'no-provider':
      log.warn(`activity: ${tag} -> dropped: provider not loaded (untrusted / disabled) or has no activity adapter`);
  }
}

/**
 * Assert the ingest token (shared constant-time gate,
 * `util/ingest-token.ts`), logging a WARN on mismatch (an otherwise
 * silent 403 that blinds an operator to a mis-wired bridge) before
 * rethrowing. No token or body content is logged.
 */
function assertTokenLogged(presented: string | null, expected: string): void {
  try {
    assertIngestToken(presented, expected);
  } catch (err) {
    log.warn('activity: ingest rejected (token mismatch)');
    throw err;
  }
}

/**
 * Known top-level hook-type discriminator keys across Providers
 * (`hook_event_name`: claude / codex; `hook`: opencode). A fixed vendor
 * event name, NOT user content, so it is safe to log, but the payload is
 * external so the value is sanitized and length-capped defensively.
 */
const HOOK_LABEL_KEYS = ['hook_event_name', 'hook', 'type'] as const;
const HOOK_LABEL_MAX = 40;

function extractHookLabel(rawEvent: unknown): string | null {
  if (typeof rawEvent !== 'object' || rawEvent === null) return null;
  const rec = rawEvent as Record<string, unknown>;
  for (const key of HOOK_LABEL_KEYS) {
    const value = rec[key];
    if (typeof value === 'string' && value.length > 0) {
      const clean = sanitizeForTerminal(value).slice(0, HOOK_LABEL_MAX);
      if (clean.length > 0) return clean;
    }
  }
  return null;
}
