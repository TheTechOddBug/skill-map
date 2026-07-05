/**
 * Spawn-thread grouping (spec/provider-activity.md §Conversation
 * capture). A parent agent that converses with a child over N turns
 * produces N independent spawn records, one per Task call; these
 * helpers fuse them into ONE chat-style thread per parent-child pair
 * so the dialog can render the exchange chronologically.
 *
 * Pure module: no Angular imports, unit-tested in isolation. The wire
 * shapes are FINAL, grouping is a pure client-side presentation
 * concern.
 */

import type { IActivitySpawnRecordApi } from '../../../models/api';

/** One parent-child conversation: every turn of the pair, in order. */
export interface ISpawnThread {
  /** Grouping key, see `threadKeyOf`. */
  key: string;
  parentOwner: string;
  /** Absent when the spawner is a session (the main context). */
  parentNodePath?: string;
  childName?: string;
  childNodePath?: string;
  /** The turns of the conversation, ASC by `startedAt`. */
  records: IActivitySpawnRecordApi[];
}

/**
 * Grouping key of a record: the parent context plus the most stable
 * child identity available. `childNodePath` first (scanned nodes are
 * canonical), then `childName` (named but unscanned children), then
 * the `spawnId` itself, an anonymous child never merges with anything.
 */
export function threadKeyOf(record: IActivitySpawnRecordApi): string {
  return `${record.parentOwner}>>${record.childNodePath ?? record.childName ?? record.spawnId}`;
}

/**
 * Fuses spawn records into threads: records sharing a `threadKeyOf`
 * key merge, sorted ASC by `startedAt` inside the thread (turn order);
 * threads sort DESC by their latest `startedAt` (most recent
 * conversation first). The thread's descriptive fields come from its
 * records, with later turns overriding earlier ones when defined (the
 * freshest naming wins).
 */
export function groupSpawnThreads(records: readonly IActivitySpawnRecordApi[]): ISpawnThread[] {
  const byKey = new Map<string, IActivitySpawnRecordApi[]>();
  for (const record of records) {
    const key = threadKeyOf(record);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(record);
    else byKey.set(key, [record]);
  }
  const threads: ISpawnThread[] = [];
  for (const [key, bucket] of byKey) {
    const sorted = [...bucket].sort((a, b) => a.startedAt - b.startedAt);
    const thread: ISpawnThread = { key, parentOwner: sorted[0]!.parentOwner, records: sorted };
    for (const record of sorted) {
      if (record.parentNodePath !== undefined) thread.parentNodePath = record.parentNodePath;
      if (record.childName !== undefined) thread.childName = record.childName;
      if (record.childNodePath !== undefined) thread.childNodePath = record.childNodePath;
    }
    threads.push(thread);
  }
  return threads.sort((a, b) => latestStartOf(b) - latestStartOf(a));
}

/** Records are ASC by `startedAt`, so the latest turn is the last one. */
function latestStartOf(thread: ISpawnThread): number {
  return thread.records[thread.records.length - 1]!.startedAt;
}
