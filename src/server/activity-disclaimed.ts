/**
 * Boot-scoped digest of DISCLAIMED ingest shapes (see
 * `spec/provider-activity.md` §Mapper digest).
 *
 * The wiring self-test proves the transport half of the chain and, by
 * the short-circuit it depends on, cannot prove the mapping half: a
 * probe never reaches `mapEvent`, so an adapter that disclaims every
 * real payload passes it green. This store closes that gap from the
 * other side, by accumulating what the ingest already knows: the route
 * computes an outcome per event for its observability log, and here the
 * same discriminator is counted per Provider instead of dying with the
 * log line.
 *
 * **Privacy invariant (normative)**: the digest records SCHEMA, never
 * CONTENT. The only payload VALUES it may hold are the two vendor
 * discriminators the ingest log is already permitted to log (the hook
 * type and the tool name), sanitized and capped exactly as that log
 * caps them. Everything else is key NAMES: no value is read, arrays are
 * never descended into, and the key count plus each key's length are
 * capped so a payload keyed by user data cannot become a content
 * channel. Boot-scoped like the probe ring and the execution stats:
 * never persisted, never broadcast, readable only over the loopback
 * `GET /api/activity/disclaimed` route.
 */

import type { TActivityOutcome } from './activity-resolver.js';
import { sanitizeForTerminal } from '../kernel/util/safe-text.js';

/** Distinct shapes retained per server; oldest evicted past it. */
export const DISCLAIMED_RING_SIZE = 32;
/** Depth of the key walk. Two levels cover every shipped payload shape. */
const KEY_DEPTH = 2;
/** Caps that keep the digest a schema report and not a content channel. */
const MAX_KEYS = 24;
const MAX_KEYS_PER_OBJECT = 12;
const MAX_KEY_LEN = 40;
const MAX_LABEL_LEN = 40;

/**
 * Top-level discriminator keys, mirroring the ingest log's own list.
 * A fixed vendor event name, not user content.
 */
const HOOK_KEYS = ['hook_event_name', 'hook', 'type'] as const;
/**
 * Tool-name keys across the shipped dialects, searched at the top level
 * and one level in (`claude` / `codex` put it at `tool_name`, `opencode`
 * nests it at `input.tool`). An unknown dialect simply reports no tool
 * and leans on `keys` instead, which is the point: the digest must stay
 * useful for a vocabulary nobody has characterised yet.
 */
const TOOL_KEYS = ['tool_name', 'tool', 'toolName'] as const;

/** One collapsed shape entry as the readback route reports it. */
export interface IDisclaimedShape {
  outcome: TActivityOutcome;
  hook?: string;
  tool?: string;
  keys: string[];
  count: number;
  lastAt: number;
}

/** Per-Provider digest: the two totals plus the collapsed shapes. */
export interface IDisclaimedReport {
  id: string;
  received: number;
  resolved: number;
  shapes: IDisclaimedShape[];
}

interface IProviderDigest {
  received: number;
  resolved: number;
  /** Signature -> collapsed entry, insertion-ordered for eviction. */
  shapes: Map<string, IDisclaimedShape>;
}

export class ActivityDisclaimedStore {
  private readonly byProvider = new Map<string, IProviderDigest>();

  constructor(private readonly capacity: number = DISCLAIMED_RING_SIZE) {}

  /**
   * Record ONE ingest. Every event counts toward `received`; a
   * `resolved` outcome counts toward `resolved` and records no shape,
   * because a shape entry is only ever a question about why nothing
   * came out.
   */
  record(providerId: string, outcome: TActivityOutcome, raw: unknown): void {
    const digest = this.digestFor(providerId);
    digest.received += 1;
    if (outcome === 'resolved') {
      digest.resolved += 1;
      return;
    }
    const shape = describeShape(outcome, raw);
    const key = signatureOf(shape);
    const existing = digest.shapes.get(key);
    if (existing !== undefined) {
      existing.count += 1;
      existing.lastAt = Date.now();
      return;
    }
    if (digest.shapes.size >= this.capacity) {
      const oldest = digest.shapes.keys().next();
      if (!oldest.done) digest.shapes.delete(oldest.value);
    }
    digest.shapes.set(key, shape);
  }

  /**
   * The digest for one Provider, or for every Provider seen so far.
   * An id this server has received nothing for reports zeroed counters
   * rather than absent: "nothing arrived" is the answer the caller
   * asked for, and an empty report says it unambiguously.
   */
  report(providerId?: string): IDisclaimedReport[] {
    if (providerId !== undefined) return [this.reportOne(providerId)];
    return [...this.byProvider.keys()].map((id) => this.reportOne(id));
  }

  private reportOne(id: string): IDisclaimedReport {
    const digest = this.byProvider.get(id);
    if (digest === undefined) return { id, received: 0, resolved: 0, shapes: [] };
    // Loudest first: the operator wants the shape that is failing most.
    const shapes = [...digest.shapes.values()].sort((a, b) => b.count - a.count);
    return { id, received: digest.received, resolved: digest.resolved, shapes };
  }

  private digestFor(providerId: string): IProviderDigest {
    const existing = this.byProvider.get(providerId);
    if (existing !== undefined) return existing;
    const fresh: IProviderDigest = { received: 0, resolved: 0, shapes: new Map() };
    this.byProvider.set(providerId, fresh);
    return fresh;
  }
}

/** Collapse identical shapes; the counters are not part of the identity. */
function signatureOf(shape: IDisclaimedShape): string {
  return [shape.outcome, shape.hook ?? '', shape.tool ?? '', shape.keys.join(',')].join('|');
}

/**
 * The content-free description of one raw payload: the two vendor
 * discriminators (sanitized, capped) plus the key names reachable to
 * `KEY_DEPTH`. No value is read beyond those two labels.
 */
function describeShape(outcome: TActivityOutcome, raw: unknown): IDisclaimedShape {
  const shape: IDisclaimedShape = { outcome, keys: collectKeys(raw), count: 1, lastAt: Date.now() };
  const record = asRecord(raw);
  if (record === null) return shape;
  const hook = labelFrom(record, HOOK_KEYS);
  if (hook !== null) shape.hook = hook;
  const tool = labelFrom(record, TOOL_KEYS) ?? nestedLabel(record, TOOL_KEYS);
  if (tool !== null) shape.tool = tool;
  return shape;
}

/** First non-empty string value among `keys`, sanitized and capped. */
function labelFrom(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string' || value.length === 0) continue;
    const clean = sanitizeForTerminal(value).slice(0, MAX_LABEL_LEN);
    if (clean.length > 0) return clean;
  }
  return null;
}

/** The same lookup one level in, for dialects that nest the tool name. */
function nestedLabel(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const value of Object.values(record)) {
    const child = asRecord(value);
    if (child === null) continue;
    const label = labelFrom(child, keys);
    if (label !== null) return label;
  }
  return null;
}

/**
 * Key NAMES as dotted paths, to `KEY_DEPTH` levels. Arrays are skipped
 * entirely (an array index carries no schema and its elements may be
 * content), and both the per-object and total counts are capped.
 */
function collectKeys(raw: unknown): string[] {
  const out: string[] = [];
  walkKeys(raw, '', 1, out);
  return out;
}

function walkKeys(value: unknown, prefix: string, depth: number, out: string[]): void {
  const record = asRecord(value);
  if (record === null) return;
  let taken = 0;
  for (const [key, child] of Object.entries(record)) {
    if (out.length >= MAX_KEYS || taken >= MAX_KEYS_PER_OBJECT) return;
    const clean = sanitizeForTerminal(key).slice(0, MAX_KEY_LEN);
    if (clean.length === 0) continue;
    taken += 1;
    const path = prefix === '' ? clean : `${prefix}.${clean}`;
    out.push(path);
    if (depth < KEY_DEPTH) walkKeys(child, path, depth + 1, out);
  }
}

/** Plain objects only: arrays and null are not key-bearing shapes here. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
