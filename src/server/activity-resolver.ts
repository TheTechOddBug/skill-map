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
import type {
  IActivitySignal,
  IActivitySpawnRelation,
  IProvider,
} from '../kernel/extensions/index.js';
import { deriveNodeIdentifiers } from '../kernel/orchestrator/node-identifiers.js';
import { normalizeTrigger } from '../kernel/trigger-normalize.js';
import type { Node } from '../kernel/types.js';
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
}): Promise<IResolvedActivity> {
  const provider = opts.providers.find((p) => p.id === opts.providerId && p.activity !== undefined);
  if (!provider) return emptyResolution();

  const signals = mapEventSafely(provider, opts.raw);
  if (signals.length === 0) return emptyResolution();

  const nodes = await loadPersistedNodes(opts.dbPath);
  if (nodes.length === 0) return emptyResolution();

  return resolveSignalsAgainstNodes(signals, provider, nodes);
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
    { databasePath: dbPath, autoBackup: false },
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
 */
export function resolveSignalsAgainstNodes(
  signals: readonly IActivitySignal[],
  provider: IProvider,
  nodes: readonly Node[],
): IResolvedActivity {
  const out = emptyResolution();
  for (const signal of signals) {
    const report = reportOf(signal);
    if (report) out.reports.push(report);
    if (isRelationOnly(signal)) {
      // Relation-only spawn (a session-context spawn): no parent node
      // to claim, so no activity payload; the record's parentNodePath
      // stays absent (the structural session-parent discriminator).
      out.spawns.push(buildResolvedSpawn(signal.spawn!, provider, nodes, undefined));
      continue;
    }
    if (isOwnerRelease(signal)) {
      // Node-less owner release (a whole execution context ended, e.g.
      // Antigravity's Stop): nothing to resolve, forward as-is so the
      // UI releases everything that owner holds.
      out.activity.push({ phase: 'end', owner: signal.owner!, ownerScope: true });
      continue;
    }
    const node = findNodeForSignal(nodes, provider, signal);
    if (!node) continue;
    out.activity.push(buildResolvedData(signal, node.path));
    if (signal.spawn !== undefined) {
      out.spawns.push(buildResolvedSpawn(signal.spawn, provider, nodes, node.path));
    }
  }
  return out;
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

/**
 * Project one resolved signal onto the wire shape. The phase-gated
 * flags are normalised here so consumers never see contradictory
 * combinations (`ownerScope` only on OWNED ends, `sticky` / `keepAlive`
 * only on starts).
 */
function buildResolvedData(signal: IActivitySignal, nodePath: string): INodeActivityEventData {
  const resolved: INodeActivityEventData = { nodePath, phase: signal.phase };
  if (signal.owner !== undefined) resolved.owner = signal.owner;
  if (signal.phase === 'end' && signal.ownerScope === true && signal.owner !== undefined) {
    resolved.ownerScope = true;
  }
  if (signal.phase === 'start') {
    if (signal.sticky === true) resolved.sticky = true;
    if (signal.keepAlive === true) resolved.keepAlive = true;
  }
  return resolved;
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
): IResolvedSpawn {
  const out: IResolvedSpawn = {
    spawnId: relation.spawnId,
    phase: relation.phase,
    parentOwner: relation.parentOwner,
  };
  if (parentNodePath !== undefined) out.parentNodePath = parentNodePath;
  if (relation.childKind !== undefined) out.childKind = relation.childKind;
  if (relation.childName !== undefined) out.childName = relation.childName;
  if (relation.childOwner !== undefined) out.childOwner = relation.childOwner;
  if (relation.prompt !== undefined) out.prompt = relation.prompt;
  if (relation.response !== undefined) out.response = relation.response;
  const childNodePath = resolveChildPath(relation, provider, nodes);
  if (childNodePath !== undefined) out.childNodePath = childNodePath;
  return out;
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
