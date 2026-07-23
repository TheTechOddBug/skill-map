/**
 * Operations log writer (`spec/cli-contract.md` §Operations log): the
 * single module every mutating verb appends its one JSONL line through.
 * A BASIC log by design (user decision 2026-07-21): each line carries
 * only what the verb already held in hand, nothing derived, nothing
 * newly captured.
 *
 * Contract highlights the implementation must keep:
 *
 *   - FIRE-AND-FORGET: a log failure never fails or delays the
 *     operation. Every filesystem error is swallowed; there is no
 *     return value to check.
 *   - NO PROJECT, NO LOG: when `<cwd>/.skill-map/` does not exist the
 *     append is skipped silently (the log never creates the project
 *     directory as a side effect).
 *   - RETENTION: single-generation size rotation. When the file
 *     exceeds `OPERATIONS_LOG_MAX_BYTES` it is renamed to
 *     `operations.log.1` (replacing any prior generation) and a fresh
 *     file starts with the incoming line.
 *
 * The write is synchronous (one `appendFileSync` of one short line):
 * mutating verbs are already filesystem-bound at their call sites, and
 * a sync append cannot be torn by a concurrent writer mid-line for
 * lines under the pipe-buffer size.
 */

import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

import { defaultProjectOperationsLogPath } from './paths/db-path.js';

/** Rotation cap (`spec/cli-contract.md` §Operations log: 1 MiB). */
export const OPERATIONS_LOG_MAX_BYTES = 1024 * 1024;

/** Which surface drove the operation. */
export type TOperationChannel = 'cli' | 'ui' | 'watcher' | 'hook' | 'mcp';

/** One log line (`spec/cli-contract.md` §Operations log for field semantics). */
export interface IOperationEntry {
  /** Dotted `family.action` slug, e.g. `jobs.submit`, `findings.clear`. */
  op: string;
  /** Node path, or `*` for project-wide operations. */
  target: string;
  channel: TOperationChannel;
  /** Result word: `ok`, `queued`, `completed`, `failed`, `cancelled`, ... */
  outcome: string;
  /** Qualified extension id, when the operation has one. */
  extension?: string;
  /** The operation's own handle (e.g. the job id), when it has one. */
  id?: string;
  /** Short free-form note the verb already had (e.g. `deleted=16`). */
  detail?: string;
}

/**
 * Append one operation line to `<cwd>/.skill-map/operations.log`.
 * Silent no-op when the project directory does not exist; silent on
 * every error (fire-and-forget by contract).
 */
export function appendOperation(cwd: string, entry: IOperationEntry): void {
  try {
    const logPath = defaultProjectOperationsLogPath({ cwd });
    if (!existsSync(dirname(logPath))) return;
    rotateIfOversized(logPath);
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
    appendFileSync(logPath, `${line}\n`, 'utf8');
  } catch {
    // Fire-and-forget: the operation must never pay for its log line.
  }
}

/** Single-generation rotation: `operations.log` -> `operations.log.1`. */
function rotateIfOversized(logPath: string): void {
  try {
    if (statSync(logPath).size <= OPERATIONS_LOG_MAX_BYTES) return;
  } catch {
    return; // no file yet, nothing to rotate
  }
  try {
    renameSync(logPath, `${logPath}.1`);
  } catch {
    // Rotation is best-effort too; worst case the file keeps growing.
  }
}
