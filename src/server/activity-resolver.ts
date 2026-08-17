/**
 * Live-activity signal resolution (see `spec/provider-activity.md`).
 *
 * The ingest route (`routes/activity.ts`) receives ONE raw provider hook
 * payload per request. This module owns the two-step mapping that turns
 * it into broadcastable `node.activity` payloads plus resolved spawn
 * relations:
 *
 *   1. The Provider's `activity.mapEvent(raw)` names the invoked units
 *      (`{ kind, name, phase, owner? }`). Payload knowledge lives with
 *      the Provider and nowhere else; a missing / throwing / disclaiming
 *      `mapEvent` yields zero signals (activity is best-effort).
 *   2. Each signal resolves `(kind, name)` against the PERSISTED scanned
 *      node set through the same `kinds[*].identifiers` contract link
 *      resolution uses (`deriveNodeIdentifiers` + `normalizeTrigger`).
 *      Signals that resolve to no scanned node are DROPPED, a phantom
 *      node is never lit. A signal's `spawn` block becomes one
 *      `IResolvedSpawn`: the carrying signal's resolved node is the
 *      `parentNodePath`, the child resolves through the same
 *      identifiers contract, and the RELATION-ONLY form (spawn with no
 *      kind/name/path, e.g. main-context spawns) yields a spawn record
 *      with no `node.activity` payload and no `parentNodePath`.
 *
 * The node set is read per request via the same `tryWithSqlite` +
 * `scans.load()` path `routes/node-loader.ts` uses. Activity events are
 * low-frequency (unit invocations, not per-tool-call), so the per-request
 * read matches the BFF's per-request DB discipline; a cache is premature.
 *
 * Privacy invariant: the raw event never leaves this module's call
 * frame. The activity payloads carry only the minimal resolved shape;
 * `IResolvedSpawn` DOES carry the conversation halves (`prompt` /
 * `response`) INTERNALLY so the route can feed the consent-gated store,
 * but the route strips them before any broadcast and they are never
 * logged, thrown, or persisted.
 */

import { tryWithSqlite } from '../core/sqlite/with-sqlite.js';
import { bffReadVersionCheck } from './util/db-read-check.js';
import type {
  IActivitySignal,
  IActivitySpawnExecution,
  IActivitySpawnRelation,
  IProvider,
} from '../kernel/extensions/index.js';
import { deriveNodeIdentifiers } from '../kernel/orchestrator/node-identifiers.js';
import { normalizeTrigger } from '../kernel/trigger-normalize.js';
import type { Node } from '../kernel/types.js';
import type { ActivityOwnerIndex } from './activity-owner-index.js';
import type { INodeActivityEventData } from './events.js';

/**
 * One resolved spawn relation, the SERVER-INTERNAL sibling of the wire
 * `IAgentSpawnEventData`. Unlike the wire shape it carries the
 * conversation halves, so it must never be broadcast or serialised
 * as-is: the ingest route projects the metadata subset for the WS frame
 * and hands the full record only to the consent-gated conversation
 * store.
 */
export interface IResolvedSpawn {
  spawnId: string;
  phase: 'start' | 'handoff' | 'end';
  parentOwner: string;
  /** Resolved parent node; absent when the spawner is a session. */
  parentNodePath?: string;
  childKind?: string;
  childName?: string;
  /** Present when the child name resolved against the scanned set. */
  childNodePath?: string;
  childOwner?: string;
  /** Conversation halves, capture-gate custody only. Never broadcast. */
  prompt?: string;
  response?: string;
  /** Aggregate execution summary (metadata, gate-independent). */
  execution?: IActivitySpawnExecution;
}

/**
 * One end-of-context report (`IActivitySignal.report`): the ending
 * owner's final message. CONTENT under the same custody as the spawn
 * halves: never broadcast, handed only to the consent-gated store,
 * where it completes async spawn records by `childOwner` match.
 */
export interface IResolvedReport {
  owner: string;
  report: string;
}

/** The resolver's result; every half empty on every short-circuit. */
export interface IResolvedActivity {
  activity: INodeActivityEventData[];
  spawns: IResolvedSpawn[];
  reports: IResolvedReport[];
}

/**
 * Coarse ingest outcome, drives the `POST /api/activity` observability
 * log so an operator debugging a Provider's live-activity wiring can see
 * WHY an event produced nothing (all four short-circuits are otherwise
 * silent 202s). Carries no payload content, only the discriminator and
 * the signal count.
 *
 *   - `no-provider`  : no registered Provider with that id AND an
 *                      `activity` adapter (untrusted / disabled / unknown).
 *   - `no-signals`   : the Provider's `mapEvent` disclaimed (0 signals).
 *   - `no-nodes`     : no scanned nodes persisted yet (run a scan first).
 *   - `unresolved`   : signals were produced but none matched a node.
 *   - `resolved`     : at least one activity / spawn / report was emitted.
 */
export type TActivityOutcome =
  | 'no-provider'
  | 'no-signals'
  | 'no-nodes'
  | 'unresolved'
  | 'resolved';

/**
 * `resolveActivityEvent`'s result: the resolved payloads plus a coarse
 * `outcome` + `signalCount` diagnostic for the ingest log. Extends
 * `IResolvedActivity` so the route can keep destructuring the payload
 * halves unchanged.
 */
export interface IActivityResolution extends IResolvedActivity {
  outcome: TActivityOutcome;
  /** Signals returned by `mapEvent` (pre node-resolution); 0 for early exits. */
  signalCount: number;
}

/**
 * Map + resolve one raw provider event into broadcastable payloads.
 * Returns the empty pair for every non-happy path (unknown provider,
 * provider without `activity`, disclaiming / throwing `mapEvent`,
 * missing DB, nothing resolved): the ingest route answers 202
 * regardless, per the bridge's fire-and-forget contract.
 */
export async function resolveActivityEvent(opts: {
  providers: readonly IProvider[];
  dbPath: string;
  providerId: string;
  raw: unknown;
  /**
   * Boot-scoped `owner -> agent node` index. Optional so unit tests and
   * any future caller can resolve without one; absent, a spawn that
   * names no parent stays relation-only (the session-capsule fallback).
   */
  owners?: ActivityOwnerIndex;
}): Promise<IActivityResolution> {
  const provider = opts.providers.find((p) => p.id === opts.providerId && p.activity !== undefined);
  if (!provider) return withOutcome(emptyResolution(), 'no-provider', 0);

  const signals = mapEventSafely(provider, opts.raw);
  if (signals.length === 0) return withOutcome(emptyResolution(), 'no-signals', 0);

  const nodes = await loadPersistedNodes(opts.dbPath);
  if (nodes.length === 0) return withOutcome(emptyResolution(), 'no-nodes', signals.length);

  const resolved = resolveSignalsAgainstNodes(signals, provider, nodes, opts.owners);
  const produced = resolved.activity.length + resolved.spawns.length + resolved.reports.length;
  return withOutcome(resolved, produced > 0 ? 'resolved' : 'unresolved', signals.length);
}

/** Tag a resolved payload with the ingest-log diagnostic. */
function withOutcome(
  resolved: IResolvedActivity,
  outcome: TActivityOutcome,
  signalCount: number,
): IActivityResolution {
  return { ...resolved, outcome, signalCount };
}

/** Fresh empty result per call site; the arrays are mutable by design. */
function emptyResolution(): IResolvedActivity {
  return { activity: [], spawns: [], reports: [] };
}

/**
 * Call the Provider's `mapEvent` defensively. The payload arrives from
 * an external process verbatim, and a plugin-authored mapper may throw
 * on shapes it never anticipated; a throw is a disclaim, never a 500.
 */
function mapEventSafely(provider: IProvider, raw: unknown): IActivitySignal[] {
  try {
    return provider.activity?.mapEvent(raw) ?? [];
  } catch {
    return [];
  }
}

async function loadPersistedNodes(dbPath: string): Promise<readonly Node[]> {
  const persisted = await tryWithSqlite(
    { databasePath: dbPath, autoBackup: false, versionCheck: bffReadVersionCheck() },
    async (adapter) => adapter.scans.load(),
  );
  return persisted?.nodes ?? [];
}

/**
 * Pure resolution half, exported for unit tests. Two node-signal forms
 * (see `IActivitySignal`): a PATH signal matches the node with that
 * exact `path`, across providers and kinds (the path already identifies
 * one node unambiguously); a NAME signal matches the first node (stable
 * scan order) classified by THIS provider under the signal's kind whose
 * derived identifiers contain the normalised name. Unresolved signals
 * are dropped either way, and a spawn block riding an UNRESOLVED node
 * signal drops with it: emitting it without `parentNodePath` would
 * fabricate the session-parent discriminator on a phantom parent.
 *
 * Stateful only through the optional `owners` index, which turns the
 * OTHER anchoring case around: a spawn that names no parent (OpenCode's
 * `task`, which reports only the spawning session) is stamped with the
 * agent node that owner is known to be running, so the edge hangs off
 * the real agent instead of a synthetic session capsule. The capsule
 * survives as the fallback for an owner running no scanned node.
 */
export function resolveSignalsAgainstNodes(
  signals: readonly IActivitySignal[],
  provider: IProvider,
  nodes: readonly Node[],
  owners?: ActivityOwnerIndex,
): IResolvedActivity {
  const out = emptyResolution();
  for (const signal of signals) {
    const report = reportOf(signal);
    if (report) out.reports.push(report);
    if (resolveNodelessSignal(signal, provider, nodes, owners, out)) continue;
    resolveNodeSignal(signal, provider, nodes, owners, out);
  }
  return out;
}

/**
 * The three NODE-LESS signal forms, each self-identifying by shape. Returns
 * `true` when the signal was one of them (and handled), `false` to let the
 * caller resolve it against the node set.
 */
function resolveNodelessSignal(
  signal: IActivitySignal,
  provider: IProvider,
  nodes: readonly Node[],
  owners: ActivityOwnerIndex | undefined,
  out: IResolvedActivity,
): boolean {
  if (isRelationOnly(signal)) {
    // Spawn with no parent node signal of its own: anchor it on the
    // agent node its owner is running, when we know one. Absent that,
    // `parentNodePath` stays undefined, the structural session-parent
    // discriminator the client renders as a capsule.
    const relation = signal.spawn!;
    out.spawns.push(
      buildResolvedSpawn(relation, provider, nodes, owners?.nodeFor(relation.parentOwner), owners),
    );
    return true;
  }
  if (isOwnerRelease(signal)) {
    out.activity.push(buildOwnerRelease(signal, provider, owners));
    return true;
  }
  if (isSessionRelease(signal)) {
    // Node-less session release (a runtime's turn ended, e.g. Codex's
    // main-context Stop): nothing to resolve, forward as-is so the UI
    // releases every owner grouped under the session (the safety net
    // for a subagent whose own ownerScope end the runtime dropped).
    out.activity.push({ phase: 'end', session: signal.session!, sessionScope: true });
    return true;
  }
  if (isTurnEnd(signal)) {
    // Node-less turn end (a napping runtime's main context completed
    // its turn, e.g. Claude's main Stop): nothing to resolve, forward
    // as-is so the UI sweeps the owner's sync spawn relations whose
    // completion never arrived (interrupted / failed spawn calls).
    // Deliberately narrower than the owner release: node claims and
    // async relations stay untouched (spec §WS event: node.activity).
    out.activity.push({ phase: 'end', owner: signal.owner!, turnEnd: true });
    return true;
  }
  return false;
}

/**
 * Node-less owner release (a whole execution context ended, e.g.
 * Antigravity's Stop): nothing to resolve, forwarded as-is so the UI
 * releases everything that owner holds. On a `blocking` runtime the
 * parent cannot be idle while a child runs, so the end is TERMINAL and
 * also releases the spawns it PARENTS, the only thing that clears a
 * relation whose completion never arrives.
 */
function buildOwnerRelease(
  signal: IActivitySignal,
  provider: IProvider,
  owners: ActivityOwnerIndex | undefined,
): INodeActivityEventData {
  const end: INodeActivityEventData = { phase: 'end', owner: signal.owner!, ownerScope: true };
  if (provider.activity?.spawnCustody === 'blocking') {
    end.terminal = true;
    // Drop the anchor only on a TERMINAL end. On a napping runtime the
    // same frame may be a pause, and forgetting there would lose the
    // parent's identity exactly while it awaits its own child; those
    // owners age out through the index cap instead.
    owners?.forget(signal.owner!);
  }
  return end;
}

/** A signal that targets a node: resolve it, then its spawn block and anchor. */
function resolveNodeSignal(
  signal: IActivitySignal,
  provider: IProvider,
  nodes: readonly Node[],
  owners: ActivityOwnerIndex | undefined,
  out: IResolvedActivity,
): void {
  const node = findNodeForSignal(nodes, provider, signal);
  if (!node) return;
  out.activity.push(buildResolvedData(signal, node.path));
  if (isAgentClaim(signal, node)) owners?.note(signal.owner!, node.path);
  if (signal.spawn !== undefined) {
    out.spawns.push(buildResolvedSpawn(signal.spawn, provider, nodes, node.path, owners));
  }
}

/**
 * Whether this resolution proves "owner X is running agent node P": a
 * NAME signal (a unit's own execution, never a resource access) for an
 * `agent`-kind node carrying an owner. `agent` is the cross-provider
 * vocabulary the spawn contract already speaks (`childKind: 'agent'`),
 * and narrowing to it matters: a skill loaded later under the same
 * owner must not steal the anchor from the agent that loaded it.
 */
function isAgentClaim(signal: IActivitySignal, node: Node): boolean {
  return (
    signal.phase === 'start' &&
    signal.owner !== undefined &&
    signal.path === undefined &&
    node.kind === 'agent'
  );
}

/**
 * End-of-context report extraction. Rides OUTSIDE node resolution on
 * purpose: the report completes a spawn record by `childOwner` match
 * even when the stopping agent itself is not a scanned node.
 */
function reportOf(signal: IActivitySignal): IResolvedReport | null {
  if (signal.phase !== 'end' || signal.owner === undefined || signal.report === undefined) {
    return null;
  }
  return { owner: signal.owner, report: signal.report };
}

/** The relation-only signal form: a spawn block with no node target. */
function isRelationOnly(signal: IActivitySignal): boolean {
  return (
    signal.spawn !== undefined &&
    signal.path === undefined &&
    signal.kind === undefined &&
    signal.name === undefined
  );
}

/** The owner-release signal form: an ownerScope end with no node target. */
function isOwnerRelease(signal: IActivitySignal): boolean {
  return (
    signal.phase === 'end' &&
    signal.ownerScope === true &&
    signal.owner !== undefined &&
    signal.path === undefined &&
    signal.kind === undefined &&
    signal.name === undefined
  );
}

/** The turn-end signal form: a turnEnd end with an owner and no node target. */
function isTurnEnd(signal: IActivitySignal): boolean {
  return (
    signal.phase === 'end' &&
    signal.turnEnd === true &&
    signal.owner !== undefined &&
    signal.path === undefined &&
    signal.kind === undefined &&
    signal.name === undefined
  );
}

/** The session-release signal form: a sessionScope end with no node target. */
function isSessionRelease(signal: IActivitySignal): boolean {
  return (
    signal.phase === 'end' &&
    signal.sessionScope === true &&
    signal.session !== undefined &&
    signal.path === undefined &&
    signal.kind === undefined &&
    signal.name === undefined
  );
}

/**
 * Project one resolved signal onto the wire shape. The phase-gated
 * flags are normalised here so consumers never see contradictory
 * combinations (`ownerScope` only on OWNED ends, `sticky` / `keepAlive`
 * only on starts).
 */
function buildResolvedData(signal: IActivitySignal, nodePath: string): INodeActivityEventData {
  const resolved: INodeActivityEventData = { nodePath, phase: signal.phase };
  if (signal.owner !== undefined) resolved.owner = signal.owner;
  // Carry the session so the UI can group this owner under it (a later
  // sessionScope end releases every owner of the session together).
  if (signal.session !== undefined) resolved.session = signal.session;
  applyPhaseFlags(resolved, signal);
  if (signal.detail !== undefined) resolved.detail = signal.detail;
  // A PATH signal is a resource access (the runtime touched a file or an mcp
  // tool); a NAME signal is a unit's own execution. This split, not the node
  // kind, drives caller attribution (a unit reading another unit's file is
  // still a read, not an execution of it). The read-vs-write split is the
  // ADAPTER's (spec field list: vendor write tools stamp `access: 'write'`);
  // anything unstamped and non-mcp defaults to a read.
  if (signal.path !== undefined) {
    resolved.access = signal.path.startsWith('mcp://')
      ? 'mcp'
      : (signal.access ?? 'read');
  }
  return resolved;
}

/** Normalise the phase-specific flags onto the resolved event (start vs owned end). */
function applyPhaseFlags(resolved: INodeActivityEventData, signal: IActivitySignal): void {
  if (signal.phase === 'end' && signal.ownerScope === true && signal.owner !== undefined) {
    resolved.ownerScope = true;
  }
  if (signal.phase === 'start') {
    if (signal.sticky === true) resolved.sticky = true;
    if (signal.keepAlive === true) resolved.keepAlive = true;
  }
}

/**
 * Project one spawn relation onto the internal resolved shape,
 * resolving the child through the SAME identifiers contract name
 * signals use. Content fields copy through untouched; custody over
 * them belongs to the route + conversation store.
 */
function buildResolvedSpawn(
  relation: IActivitySpawnRelation,
  provider: IProvider,
  nodes: readonly Node[],
  parentNodePath: string | undefined,
  owners?: ActivityOwnerIndex,
): IResolvedSpawn {
  const out: IResolvedSpawn = {
    spawnId: relation.spawnId,
    phase: relation.phase,
    parentOwner: relation.parentOwner,
  };
  if (parentNodePath !== undefined) out.parentNodePath = parentNodePath;
  copyRelationExtras(relation, out);
  const childNodePath = resolveChildPath(relation, provider, nodes);
  if (childNodePath !== undefined) out.childNodePath = childNodePath;
  // A completed spawn names the child's own owner and the node it ran:
  // the second source of truth for the index, and the only one on a
  // runtime whose children report no claim of their own.
  if (out.childOwner !== undefined && childNodePath !== undefined) {
    owners?.note(out.childOwner, childNodePath);
  }
  return out;
}

/** Optional relation passthrough (child identity, halves, summary). */
function copyRelationExtras(relation: IActivitySpawnRelation, out: IResolvedSpawn): void {
  if (relation.childKind !== undefined) out.childKind = relation.childKind;
  if (relation.childName !== undefined) out.childName = relation.childName;
  if (relation.childOwner !== undefined) out.childOwner = relation.childOwner;
  if (relation.prompt !== undefined) out.prompt = relation.prompt;
  if (relation.response !== undefined) out.response = relation.response;
  if (relation.execution !== undefined) out.execution = { ...relation.execution };
}

/** The child's scanned node path, when `(childKind, childName)` resolves. */
function resolveChildPath(
  relation: IActivitySpawnRelation,
  provider: IProvider,
  nodes: readonly Node[],
): string | undefined {
  if (relation.childKind === undefined || relation.childName === undefined) return undefined;
  const node = findNodeForSignal(nodes, provider, {
    kind: relation.childKind,
    name: relation.childName,
    phase: 'start',
  });
  return node?.path;
}

function findNodeForSignal(
  nodes: readonly Node[],
  provider: IProvider,
  signal: IActivitySignal,
): Node | undefined {
  if (signal.path !== undefined) {
    return signal.path.length > 0 ? nodes.find((node) => node.path === signal.path) : undefined;
  }
  if (signal.kind === undefined || signal.name === undefined) return undefined;
  const wanted = normalizeTrigger(signal.name);
  if (!wanted) return undefined;
  const descriptor = provider.kinds[signal.kind];
  return nodes.find(
    (node) =>
      node.provider === provider.id &&
      node.kind === signal.kind &&
      deriveNodeIdentifiers(node, descriptor).includes(wanted),
  );
}
