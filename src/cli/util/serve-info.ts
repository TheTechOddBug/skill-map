/**
 * `serve.json` lifecycle helpers for the `sm serve` verb (see
 * `spec/provider-activity.md` §serve.json and
 * `spec/schemas/serve-info.schema.json`).
 *
 * The discovery file publishes the RESOLVED listening address plus the
 * per-session ingest token so short-lived co-located processes (the
 * activity bridge) can find and authenticate against the project's
 * running server. Lifecycle is owned by the VERB, not the BFF: written
 * right after the listener binds, removed in the verb's shutdown
 * `finally`. The write is atomic (`writeJsonAtomic`, temp + rename) so
 * a reader never observes a half-written document; a pre-existing stale
 * copy (a previous hard-killed server) is simply overwritten, the new
 * server is authoritative.
 *
 * Both helpers are best-effort by design: activity discovery must never
 * take the server down. `writeServeInfo` returns `false` on failure
 * (the verb prints a one-line warning and keeps serving);
 * `removeServeInfo` swallows everything (nothing actionable at
 * shutdown).
 */

import { rmSync } from 'node:fs';

import { writeJsonAtomic } from '../../kernel/util/atomic-write.js';

/** Shape of `serve.json`, mirror of `spec/schemas/serve-info.schema.json`. */
export interface IServeInfo {
  schemaVersion: 1;
  host: string;
  port: number;
  pid: number;
  scopeRoot: string;
  startedAt: string;
  smVersion: string;
  token: string;
}

export interface IServeInfoInput {
  host: string;
  port: number;
  pid: number;
  scopeRoot: string;
  smVersion: string;
  token: string;
  /** Injected clock so tests can pin the timestamp. Defaults to `new Date()`. */
  now?: () => Date;
}

/** Assemble the on-disk shape from the verb's resolved runtime values. */
export function buildServeInfo(input: IServeInfoInput): IServeInfo {
  const now = input.now ?? ((): Date => new Date());
  return {
    schemaVersion: 1,
    host: input.host,
    port: input.port,
    pid: input.pid,
    scopeRoot: input.scopeRoot,
    startedAt: now().toISOString(),
    smVersion: input.smVersion,
    token: input.token,
  };
}

/**
 * Atomically write `serve.json` at `path`. Returns `true` on success,
 * `false` on any filesystem failure (read-only scope, missing parent,
 * permission), the caller warns and keeps serving.
 */
export function writeServeInfo(path: string, info: IServeInfo): boolean {
  try {
    writeJsonAtomic(path, info as unknown as Record<string, unknown>);
    return true;
  } catch {
    return false;
  }
}

/** Remove `serve.json`. Idempotent, never throws. */
export function removeServeInfo(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Nothing actionable at shutdown; a stale file fails open by contract.
  }
}
