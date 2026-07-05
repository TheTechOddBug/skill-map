/**
 * Shared state machine behind `<sm-conversation-dialog>` mounts
 * (spec §Conversation capture). Owned here, next to the dialog and
 * the thread grouping helpers, because BOTH hosts drive the same
 * open / thread / close contract:
 *
 *   - The graph view opens from an EDGE CLICK and fetches on demand:
 *     `openSpawn` resolves a live spawn record by id then widens it to
 *     the full parent-child thread; `openHistorical` fetches the child
 *     node's activity detail and opens the pair's most recent thread.
 *   - The inspector already holds the full spawn records (its activity
 *     section fetched them), so `openThread` hands the clicked thread
 *     over directly, zero fetches.
 *
 * Supersession: `activeToken` guards every async open. A second click
 * (spawn or historical) racing an in-flight fetch supersedes it
 * cleanly, the stale resolve is dropped, never rendered. Live spawn
 * opens token by spawnId; historical opens token by `history:<pairKey>`
 * so the two flavours guard each other symmetrically.
 */

import { signal, type Signal } from '@angular/core';

import type { IActivitySpawnDetailApi } from '../../../models/api';
import type { IDataSourcePort } from '../../../services/data-source/data-source.port';
import { groupSpawnThreads, threadKeyOf, type ISpawnThread } from './spawn-thread';

export interface IConversationDialogConfig {
  dataSource: IDataSourcePort;
}

export interface IHistoricalPair {
  /** Node path of the spawning parent (the edge's `from`). */
  parentPath: string;
  /** Node path of the spawned child (the edge's `to`). */
  childPath: string;
  /** Directional pair key (the graph view computes it via `edgePairKey`). */
  pairKey: string;
}

export interface IConversationDialogHandle {
  /** Dialog visibility, bind to `[open]`. */
  readonly open: Signal<boolean>;
  /** Thread on display, bind to `[thread]`. */
  readonly thread: Signal<ISpawnThread | null>;
  /** Capture-gate state of the LAST fetched record / detail. Only
   *  meaningful for the fetching opens (`openSpawn` / `openHistorical`);
   *  the inspector binds its own activity detail instead. */
  readonly captureEnabled: Signal<boolean>;
  /** No-fetch open: the host already holds the thread (inspector rows). */
  openThread(thread: ISpawnThread): void;
  /** Live spawn-edge open: fetch the record by id, widen to the thread. */
  openSpawn(spawnId: string): Promise<void>;
  /** Historical edge open: fetch the child's detail, open the pair's
   *  most recent thread (or an empty-records placeholder thread). */
  openHistorical(pair: IHistoricalPair): Promise<void>;
  /** `(closed)` handler: hides the dialog and clears the guard token. */
  close(): void;
}

export function setupConversationDialog(
  config: IConversationDialogConfig,
): IConversationDialogHandle {
  const { dataSource } = config;

  const open = signal(false);
  const thread = signal<ISpawnThread | null>(null);
  const captureEnabled = signal(false);
  /** Supersession guard for the async opens (see module doc). */
  const activeToken = signal<string | null>(null);

  /**
   * Widen one spawn record to its whole conversation: the child node's
   * activity detail carries every spawn touching it, so the thread
   * holding this record's key is the full exchange. Best effort, any
   * failure falls back to the singleton thread.
   */
  async function buildThreadFor(record: IActivitySpawnDetailApi): Promise<ISpawnThread> {
    const singleton = groupSpawnThreads([record])[0]!;
    if (record.childNodePath === undefined) return singleton;
    try {
      const detail = await dataSource.getNodeActivity(record.childNodePath);
      if (detail === null) return singleton;
      const key = threadKeyOf(record);
      return groupSpawnThreads(detail.spawns).find((t) => t.key === key) ?? singleton;
    } catch {
      return singleton;
    }
  }

  return {
    open: open.asReadonly(),
    thread: thread.asReadonly(),
    captureEnabled: captureEnabled.asReadonly(),

    openThread(next: ISpawnThread): void {
      thread.set(next);
      open.set(true);
    },

    async openSpawn(spawnId: string): Promise<void> {
      activeToken.set(spawnId);
      try {
        const record = await dataSource.getSpawnRecord(spawnId);
        if (activeToken() !== spawnId) return; // superseded click
        if (record === null) {
          thread.set(null);
          open.set(false);
          return;
        }
        const full = await buildThreadFor(record);
        if (activeToken() !== spawnId) return; // superseded mid-widening
        thread.set(full);
        captureEnabled.set(record.captureEnabled);
        open.set(true);
      } catch {
        // Transport failure on an ephemeral record: nothing to show, the
        // edge itself already communicates the live relation.
      }
    },

    async openHistorical(pair: IHistoricalPair): Promise<void> {
      // Synthetic token: historical opens have no spawnId, but they
      // share the guard so a spawn-edge click racing this fetch
      // supersedes it cleanly (and vice versa).
      const token = `history:${pair.pairKey}`;
      activeToken.set(token);
      try {
        const detail = await dataSource.getNodeActivity(pair.childPath);
        if (activeToken() !== token) return; // superseded click
        const records = (detail?.spawns ?? []).filter(
          (r) => r.parentNodePath === pair.parentPath,
        );
        // When nothing comes back (capture gate off, or the server
        // restarted and dropped its ring), open on an EMPTY-RECORDS
        // thread carrying the pair naming so the dialog's capture-off
        // note explains the blank instead of the click dying silently
        // under a labelled edge.
        const next: ISpawnThread = groupSpawnThreads(records)[0] ?? {
          key: pair.pairKey,
          parentOwner: '',
          parentNodePath: pair.parentPath,
          childNodePath: pair.childPath,
          records: [],
        };
        thread.set(next);
        captureEnabled.set(detail?.captureEnabled ?? false);
        open.set(true);
      } catch {
        // Transport failure: nothing to show, mirroring the spawn path.
      }
    },

    close(): void {
      open.set(false);
      activeToken.set(null);
    },
  };
}
