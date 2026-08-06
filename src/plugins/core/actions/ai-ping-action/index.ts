/**
 * Built-in SYSTEM `core/ai-ping-action` Action, an INVISIBLE liveness probe.
 *
 * Not a user capability: it exists only so the Setup panel (and any
 * operator) can answer "is an agent actually attending the job queue?".
 * Submitting it enqueues a trivial job; if an external agent claims it
 * (`sm jobs claim`) and records it (`sm record`) within a few seconds, the
 * queue is being processed. The report carries nothing but the canonical
 * `confidence` + `safety` envelope (`report.schema.json` extends
 * `report-base` ONLY, not a `summaries/` or `findings/` schema), so record
 * writes through NOTHING, no summary, no finding.
 *
 * **System / hidden via `locked: true`.** Like the other locked built-ins
 * (`core/schema-violation`, `core-markdown`, `core/ascii`,
 * `agent-skills`), the lock flag makes this extension always-enabled (the
 * enabled-resolver short-circuits before any config layer), non-toggleable
 * (toggle surfaces 403 / exit 5), never trust-gated, and STRIPPED from the
 * Settings plugins listing. It carries NO `ui` / `project`, so it never
 * renders a node affordance, and MCP `list_extensions` skips locked ids so
 * an agent never sees it as a submittable capability. The only way to
 * enqueue it is by its explicit id.
 *
 * Probabilistic (so it produces a queue job) but carries NO in-process
 * `invoke`: execution runs OUTSIDE the process exactly like the summarizer.
 */

import type { IAction, IBuiltInManifest } from '../../../../kernel/extensions/index.js';
import { CORE_PLUGIN_ID as PLUGIN_ID } from '../../../ids.js';

const ID = 'ai-ping-action';

export const aiPingAction: IBuiltInManifest<IAction> = {
  id: ID,
  pluginId: PLUGIN_ID,
  kind: 'action',
  description:
    'Internal liveness probe: a system job an external agent claims + records to confirm the queue is being processed. Not user-invocable.',
  // System extension: always on, non-toggleable, stripped from every
  // discovery surface. See the file header.
  locked: true,
  mode: 'probabilistic',
  // NO node (`spec/job-lifecycle.md` §Submit · Nodeless submit). What this
  // probe measures is whether an AGENT is draining the queue, a fact about
  // the agent and not about any file, so it enqueues against the synthetic
  // `sm://core/ai-ping-action` target. Aiming it at "the first real node"
  // used to import that node's failure modes wholesale: the probe died with
  // a raw "cannot be read from disk" whenever the file had been deleted
  // since the last scan (a stale graph is normal, it is a cache), and it
  // could not run at all in a project with nothing scanned yet.
  probNodeless: true,
  // Advisory only (feeds `sm doctor` jobs-overdue). A ping is a one-line
  // acknowledgement, so a low bound is right; the panel's own liveness
  // timeout is separate and much shorter.
  probExpectedDurationSeconds: 30,
};
