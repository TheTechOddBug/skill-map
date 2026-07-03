/**
 * Live-activity signal resolution (see `spec/provider-activity.md`).
 *
 * The ingest route (`routes/activity.ts`) receives ONE raw provider hook
 * payload per request. This module owns the two-step mapping that turns
 * it into broadcastable `node.activity` payloads:
 *
 *   1. The Provider's `activity.mapEvent(raw)` names the invoked units
 *      (`{ kind, name, phase, owner? }`). Payload knowledge lives with
 *      the Provider and nowhere else; a missing / throwing / disclaiming
 *      `mapEvent` yields zero signals (activity is best-effort).
 *   2. Each signal resolves `(kind, name)` against the PERSISTED scanned
 *      node set through the same `kinds[*].identifiers` contract link
 *      resolution uses (`deriveNodeIdentifiers` + `normalizeTrigger`).
 *      Signals that resolve to no scanned node are DROPPED, a phantom
 *      node is never lit.
 *
 * The node set is read per request via the same `tryWithSqlite` +
 * `scans.load()` path `routes/node-loader.ts` uses. Activity events are
 * low-frequency (unit invocations, not per-tool-call), so the per-request
 * read matches the BFF's per-request DB discipline; a cache is premature.
 *
 * Privacy invariant: the raw event never leaves this module's call
 * frame. Only the minimal resolved shape (`nodePath`, `phase`, `owner`)
 * flows onward; the raw is never logged, thrown, or persisted.
 */

import { tryWithSqlite } from '../core/sqlite/with-sqlite.js';
import type { IActivitySignal, IProvider } from '../kernel/extensions/index.js';
import { deriveNodeIdentifiers } from '../kernel/orchestrator/node-identifiers.js';
import { normalizeTrigger } from '../kernel/trigger-normalize.js';
import type { Node } from '../kernel/types.js';
import type { INodeActivityEventData } from './events.js';

/**
 * Map + resolve one raw provider event into broadcastable payloads.
 * Returns `[]` for every non-happy path (unknown provider, provider
 * without `activity`, disclaiming / throwing `mapEvent`, missing DB,
 * nothing resolved): the ingest route answers 202 regardless, per the
 * bridge's fire-and-forget contract.
 */
export async function resolveActivityEvent(opts: {
  providers: readonly IProvider[];
  dbPath: string;
  providerId: string;
  raw: unknown;
}): Promise<INodeActivityEventData[]> {
  const provider = opts.providers.find((p) => p.id === opts.providerId && p.activity !== undefined);
  if (!provider) return [];

  const signals = mapEventSafely(provider, opts.raw);
  if (signals.length === 0) return [];

  const nodes = await loadPersistedNodes(opts.dbPath);
  if (nodes.length === 0) return [];

  return resolveSignalsAgainstNodes(signals, provider, nodes);
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
 * Pure resolution half, exported for unit tests. Two signal forms (see
 * `IActivitySignal`): a PATH signal matches the node with that exact
 * `path`, across providers and kinds (the path already identifies one
 * node unambiguously); a NAME signal matches the first node (stable
 * scan order) classified by THIS provider under the signal's kind whose
 * derived identifiers contain the normalised name. Unresolved signals
 * are dropped either way.
 */
export function resolveSignalsAgainstNodes(
  signals: readonly IActivitySignal[],
  provider: IProvider,
  nodes: readonly Node[],
): INodeActivityEventData[] {
  const out: INodeActivityEventData[] = [];
  for (const signal of signals) {
    const node = findNodeForSignal(nodes, provider, signal);
    if (!node) continue;
    const resolved: INodeActivityEventData = { nodePath: node.path, phase: signal.phase };
    if (signal.owner !== undefined) resolved.owner = signal.owner;
    out.push(resolved);
  }
  return out;
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
