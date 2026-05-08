/**
 * `sm config list/get/set/reset/show` — read + mutate `.skill-map/settings.json`.
 *
 *   sm config list  [--json] [-g] [--strict]
 *   sm config get   <key.dot.path> [--json] [-g] [--strict]
 *   sm config set   <key> <value> [-g]                — writes to project (default) or user (-g)
 *   sm config reset <key>          [-g]                — removes the key from the same target
 *   sm config show  <key> [--source] [--json] [-g] [--strict]
 *
 * `--strict` (here and on `sm scan` / `sm init`) escalates every layered-
 * loader warning (malformed JSON, schema violation, unknown key) into a
 * fatal error — the verb exits 2 with a clean stderr line instead of
 * skipping the offending value. Same flag, same semantics across verbs.
 *
 * Read verbs (`list / get / show`) are exempt from elapsed-time per
 * `spec/cli-contract.md` §Elapsed time. Write verbs (`set / reset`) emit
 * `done in <…>` to stderr like every other in-scope verb.
 *
 * `-g` semantics:
 *   - on read verbs:  loads with scope=global (skips project layers).
 *   - on write verbs: writes to `~/.skill-map/settings.json` instead of
 *                     `<cwd>/.skill-map/settings.json`.
 *
 * Value coercion in `set`: the raw CLI string is JSON-parsed first so the
 * user can pass `true`, `42`, `null`, arrays, and objects naturally;
 * unparseable input falls through as a plain string. The merged file is
 * then re-validated against `project-config.schema.json` — invalid values
 * are rejected (exit 2) without touching the file.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

import { Command, Option } from 'clipanion';

import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import {
  loadConfig,
  type IEffectiveConfig,
  type ILoadConfigOptions,
  type ILoadedConfig,
  type TConfigLayer,
} from '../../kernel/config/loader.js';
import { ansiFor, type IAnsi } from '../util/ansi.js';
import { closestMatches } from '../util/edit-distance.js';
import { defaultSettingsPath } from '../util/db-path.js';
import { ExitCode } from '../util/exit-codes.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { CONFIG_TEXTS } from '../i18n/config.texts.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';

// -----------------------------------------------------------------------------
// shared helpers
// -----------------------------------------------------------------------------

type TWriteTarget = 'project' | 'user';

function targetSettingsPath(target: TWriteTarget, cwd: string, home: string): string {
  const root = target === 'user' ? home : cwd;
  return defaultSettingsPath(root);
}

/**
 * Path segments that, if walked, would mutate the prototype chain of the
 * current process or the resulting object. Rejected uniformly across
 * `getAtPath` / `setAtPath` / `deleteAtPath` so `sm config <verb>` cannot
 * be coerced into prototype pollution via a hostile dot-path argument.
 */
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

class ForbiddenSegmentError extends Error {
  constructor(public readonly segment: string, public readonly key: string) {
    super(`forbidden config key segment "${segment}" in "${key}"`);
  }
}

function assertSafeSegments(segments: string[], key: string): void {
  for (const seg of segments) {
    if (FORBIDDEN_SEGMENTS.has(seg)) throw new ForbiddenSegmentError(seg, key);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Walk the merged config tree and collect every dot-path that resolves
 * to a leaf (anything that is not a plain object). Used to power
 * "Did you mean?" hints when `config get`/`set` receives an unknown
 * key — the catalog comes from the live merged config rather than the
 * JSON Schema, which keeps the suggestion list aligned with what
 * `sm config list` would print.
 */
function enumerateConfigPaths(obj: unknown, prefix = ''): string[] {
  if (!isPlainObject(obj)) return prefix ? [prefix] : [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      out.push(...enumerateConfigPaths(value, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

/**
 * Format a "Did you mean?" line for an unknown config key. Returns
 * `null` when no candidate is close enough — in that case the caller
 * surfaces only the bare unknown-key error and moves on.
 *
 * Distance cap is intentionally tight (3 edits) so suggestions stay
 * relevant. With dot-paths, a single typo in any segment is usually
 * within 1-2 edits.
 */
function suggestConfigKey(effective: unknown, typed: string): string | null {
  const candidates = enumerateConfigPaths(effective);
  const matches = closestMatches(typed, candidates, { topN: 3, maxDistance: 3 });
  if (matches.length === 0) return null;
  const formatted = matches.map((m) => `'${m}'`).join(', ');
  return tx(CONFIG_TEXTS.unknownKeySuggestion, { suggestions: formatted });
}

function getAtPath(obj: unknown, dotPath: string): unknown {
  const segments = dotPath.split('.').filter(Boolean);
  assertSafeSegments(segments, dotPath);
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[seg];
      continue;
    }
    return undefined;
  }
  return cur;
}

function setAtPath(
  obj: Record<string, unknown>,
  dotPath: string,
  value: unknown,
): void {
  const segments = dotPath.split('.').filter(Boolean);
  assertSafeSegments(segments, dotPath);
  if (segments.length === 0) return;
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    const next = cur[seg];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cur[seg] = {};
    }
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[segments[segments.length - 1]!] = value;
}

function deleteAtPath(obj: Record<string, unknown>, dotPath: string): boolean {
  const segments = dotPath.split('.').filter(Boolean);
  assertSafeSegments(segments, dotPath);
  if (segments.length === 0) return false;
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = cur[segments[i]!];
    if (!next || typeof next !== 'object' || Array.isArray(next)) return false;
    cur = next as Record<string, unknown>;
  }
  const last = segments[segments.length - 1]!;
  if (!(last in cur)) return false;
  delete cur[last];
  // Walk back up and prune now-empty parent objects so the file stays tidy.
  pruneEmptyAncestors(obj, segments.slice(0, -1));
  return true;
}

function pruneEmptyAncestors(root: Record<string, unknown>, parents: string[]): void {
  while (parents.length > 0) {
    let cur: Record<string, unknown> = root;
    for (let i = 0; i < parents.length - 1; i++) {
      cur = cur[parents[i]!] as Record<string, unknown>;
    }
    const tail = parents[parents.length - 1]!;
    const child = cur[tail];
    if (
      child
      && typeof child === 'object'
      && !Array.isArray(child)
      && Object.keys(child).length === 0
    ) {
      delete cur[tail];
      parents.pop();
    } else {
      break;
    }
  }
}

function parseCliValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function readJsonObjectOrEmpty(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
  } catch {
    /* fall through to {} */
  }
  return {};
}

/**
 * Write `content` to `path` atomically. The body is staged into a sibling
 * `<path>.tmp.<pid>` file (same directory so the rename never crosses
 * filesystems) and `renameSync`'d into place — POSIX guarantees rename
 * is atomic on the same fs, so a crash mid-write leaves the destination
 * either at its prior content or at the new content, never half-written.
 *
 * The pre-rename stage is owner-only (`writeFileSync` defaults to the
 * process umask; we do not chmod here because settings.json is not
 * security-critical, and tightening would diverge from `sm init`'s
 * behaviour).
 *
 * On failure the temp file is best-effort removed so we do not leak
 * `<path>.tmp.<pid>` siblings if e.g. the rename target is read-only.
 */
function writeJsonAtomic(path: string, content: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(content, null, 2) + '\n', 'utf8');
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // Best effort — the staged file may not exist (writeFileSync
      // could have failed before the inode was created).
    }
    throw err;
  }
}

/**
 * Load layered config catching `--strict` throws so the user sees a
 * clean stderr line + exit 2 instead of Clipanion's default "Internal
 * Error" stack trace. Used by every `sm config` read verb.
 */
function tryLoadConfig(
  opts: ILoadConfigOptions,
  stderr: NodeJS.WritableStream,
): { ok: true; loaded: ILoadedConfig } | { ok: false; exitCode: number } {
  try {
    return { ok: true, loaded: loadConfig(opts) };
  } catch (err) {
    const message = formatErrorMessage(err);
    stderr.write(tx(CONFIG_TEXTS.loadFailure, { message }));
    return { ok: false, exitCode: ExitCode.Error };
  }
}

/**
 * Walk `effective` to `key`, surfacing `ForbiddenSegmentError` as a
 * uniform error line + exit 2 so each read verb's `run()` doesn't
 * need to repeat the try/catch + instanceof shape.
 */
function safeGetAtPath(
  effective: unknown,
  key: string,
  stderr: NodeJS.WritableStream,
): { ok: true; value: unknown } | { ok: false; exitCode: number } {
  try {
    return { ok: true, value: getAtPath(effective, key) };
  } catch (err) {
    if (err instanceof ForbiddenSegmentError) {
      stderr.write(tx(CONFIG_TEXTS.forbiddenKeySegment, { segment: err.segment, key: err.key }));
      return { ok: false, exitCode: ExitCode.Error };
    }
    throw err;
  }
}

// eslint-disable-next-line complexity
function* iterDotPaths(
  obj: unknown,
  prefix = '',
): Generator<[string, unknown]> {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    if (prefix) yield [prefix, obj];
    return;
  }
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0 && prefix) {
    yield [prefix, obj];
    return;
  }
  for (const [k, v] of entries) {
    const next = prefix ? `${prefix}.${k}` : k;
    yield* iterDotPaths(v, next);
  }
}

function formatValueHuman(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v) || (typeof v === 'object' && v !== null)) return JSON.stringify(v);
  return String(v);
}

// -----------------------------------------------------------------------------
// commands
// -----------------------------------------------------------------------------

export class ConfigListCommand extends SmCommand {
  static override paths = [['config', 'list']];
  static override usage = Command.Usage({
    category: 'Config',
    description: 'Print the effective config after layered merge.',
    details: `
      Walks defaults → user → user-local → project → project-local and prints the merged result.
      With --json emits the JSON object; otherwise prints flat dot-path = value lines (sorted).
      Exempt from "done in <…>" per spec/cli-contract.md §Elapsed time.
    `,
  });

  strict = Option.Boolean('--strict', false);

  // Read-only config inspection: spec § Elapsed time exempts the
  // config family from the trailing "done in" line.
  protected override emitElapsed = false;

  protected async run(): Promise<number> {
    const result = tryLoadConfig(
      { scope: this.global ? 'global' : 'project', strict: this.strict, ...defaultRuntimeContext() },
      this.context.stderr,
    );
    if (!result.ok) return result.exitCode;
    const { effective, warnings } = result.loaded;
    for (const w of warnings) this.printer!.info(w + '\n');
    if (this.json) {
      this.printer!.data(JSON.stringify(effective, null, 2) + '\n');
      return ExitCode.Ok;
    }
    const stdout = this.context.stdout as NodeJS.WriteStream;
    const ansi = ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: this.noColor });
    this.printer!.data(renderConfigSections(Array.from(iterDotPaths(effective)), ansi));
    return ExitCode.Ok;
  }
}

// --- list-section renderer ------------------------------------------------

interface ISectionDef {
  title: string;
  /** Match top-level keys exactly. Mutually exclusive with `prefix`. */
  exactKeys?: string[];
  /** Match dot-paths whose root segment is `<prefix>` (`scan.`, `jobs.`, …). */
  prefix?: string;
  /** When true, strip the matched prefix from the displayed key. */
  stripPrefix?: boolean;
}

/**
 * Closed catalogue of config sections, in the order they print. Keys
 * not matched by any section fall under a synthesised `Other` section
 * (which never appears in steady-state runs but keeps forward-compat
 * with config keys we have not classified yet).
 */
const SECTION_DEFS: ISectionDef[] = [
  {
    title: CONFIG_TEXTS.listSectionGeneral,
    exactKeys: ['autoMigrate', 'schemaVersion', 'tokenizer', 'i18n.locale'],
  },
  { title: CONFIG_TEXTS.listSectionScan, prefix: 'scan.', stripPrefix: true },
  { title: CONFIG_TEXTS.listSectionJobs, prefix: 'jobs.', stripPrefix: true },
  {
    title: CONFIG_TEXTS.listSectionRootsAndPlugins,
    exactKeys: ['roots', 'providers', 'plugins', 'ignore'],
  },
  { title: CONFIG_TEXTS.listSectionHistory, prefix: 'history.', stripPrefix: true },
];

/**
 * Render the sectioned human view of the merged config. Empty values
 * (`null`, `[]`, `{}`) collapse to a dim em-dash so the eye skips them
 * and lands on populated overrides.
 */
function renderConfigSections(
  rows: Array<[string, unknown]>,
  ansi: IAnsi,
): string {
  const out: string[] = [];
  let unmatched = rows.slice();
  for (const def of SECTION_DEFS) {
    const matched: Array<{ key: string; value: unknown }> = [];
    const remaining: Array<[string, unknown]> = [];
    for (const [k, v] of unmatched) {
      if (matchesSection(def, k)) {
        matched.push({ key: stripSectionPrefix(def, k), value: v });
      } else {
        remaining.push([k, v]);
      }
    }
    unmatched = remaining;
    if (matched.length === 0) continue;
    out.push(renderSection(def.title, matched, ansi));
  }
  if (unmatched.length > 0) {
    out.push(
      renderSection(
        CONFIG_TEXTS.listSectionOther,
        unmatched.map(([k, v]) => ({ key: k, value: v })),
        ansi,
      ),
    );
  }
  return out.join('\n');
}

function matchesSection(def: ISectionDef, key: string): boolean {
  if (def.exactKeys) return def.exactKeys.includes(key);
  if (def.prefix) return key.startsWith(def.prefix);
  return false;
}

function stripSectionPrefix(def: ISectionDef, key: string): string {
  if (def.stripPrefix === true && def.prefix && key.startsWith(def.prefix)) {
    return key.slice(def.prefix.length);
  }
  return key;
}

function renderSection(
  title: string,
  rows: Array<{ key: string; value: unknown }>,
  ansi: IAnsi,
): string {
  rows.sort((a, b) => a.key.localeCompare(b.key));
  const keyWidth = Math.max(...rows.map((r) => r.key.length));
  const lines: string[] = [];
  lines.push(tx(CONFIG_TEXTS.listSectionHeader, { title }));
  for (const { key, value } of rows) {
    lines.push(
      tx(CONFIG_TEXTS.listRow, {
        key: key.padEnd(keyWidth),
        value: formatValueListHuman(value, ansi),
      }),
    );
  }
  return lines.join('');
}

/**
 * Like `formatValueHuman` but collapses empty / null sentinels to a
 * dim em-dash so the section block visually skips defaults the user
 * has not overridden.
 */
function formatValueListHuman(value: unknown, ansi: IAnsi): string {
  if (value === null) return ansi.dim(CONFIG_TEXTS.listEmptyValue);
  if (Array.isArray(value) && value.length === 0) return ansi.dim(CONFIG_TEXTS.listEmptyValue);
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    if (Object.keys(value as Record<string, unknown>).length === 0) {
      return ansi.dim(CONFIG_TEXTS.listEmptyValue);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

export class ConfigGetCommand extends SmCommand {
  static override paths = [['config', 'get']];
  static override usage = Command.Usage({
    category: 'Config',
    description: 'Read a single config value by dot-path key.',
    details: `
      Loads the layered config and prints the final value. Unknown key → exit 5.
      Exempt from "done in <…>".
    `,
  });

  key = Option.String({ required: true });
  strict = Option.Boolean('--strict', false);

  protected override emitElapsed = false;

  protected async run(): Promise<number> {
    const result = tryLoadConfig(
      { scope: this.global ? 'global' : 'project', strict: this.strict, ...defaultRuntimeContext() },
      this.context.stderr,
    );
    if (!result.ok) return result.exitCode;
    const { effective, warnings } = result.loaded;
    for (const w of warnings) this.printer!.info(w + '\n');
    const lookup = safeGetAtPath(effective, this.key, this.context.stderr);
    if (!lookup.ok) return lookup.exitCode;
    const { value } = lookup;
    if (value === undefined) {
      this.printer!.info(tx(CONFIG_TEXTS.unknownKey, { key: this.key }));
      const suggestion = suggestConfigKey(effective, this.key);
      if (suggestion !== null) this.printer!.info(suggestion);
      return ExitCode.NotFound;
    }
    if (this.json) {
      this.printer!.data(JSON.stringify(value) + '\n');
      return ExitCode.Ok;
    }
    this.printer!.data(formatValueHuman(value) + '\n');
    return ExitCode.Ok;
  }
}

export class ConfigShowCommand extends SmCommand {
  static override paths = [['config', 'show']];
  static override usage = Command.Usage({
    category: 'Config',
    description: 'Show a config value with the layer that set it (--source).',
    details: `
      Identical to "sm config get" plus optional --source which prefixes the layer
      (defaults / user / user-local / project / project-local / override).
      With --json emits { value, source } when --source is set.
      Exempt from "done in <…>".
    `,
  });

  key = Option.String({ required: true });
  source = Option.Boolean('--source', false);
  strict = Option.Boolean('--strict', false);

  protected override emitElapsed = false;

  // CLI orchestrator: each branch (load failure, forbidden segment,
  // unknown key, --json + --source 2x2 dispatch) is one validation gate
  // or output-format pick. Splitting per branch scatters the gate from
  // the value it gates.
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    const result = tryLoadConfig(
      { scope: this.global ? 'global' : 'project', strict: this.strict, ...defaultRuntimeContext() },
      this.context.stderr,
    );
    if (!result.ok) return result.exitCode;
    const { effective, sources, warnings } = result.loaded;
    for (const w of warnings) this.printer!.info(w + '\n');
    let value: unknown;
    try {
      value = getAtPath(effective, this.key);
    } catch (err) {
      if (err instanceof ForbiddenSegmentError) {
        this.printer!.info(tx(CONFIG_TEXTS.forbiddenKeySegment, { segment: err.segment, key: err.key }));
        return ExitCode.Error;
      }
      throw err;
    }
    if (value === undefined) {
      this.printer!.info(tx(CONFIG_TEXTS.unknownKey, { key: this.key }));
      return ExitCode.NotFound;
    }
    const layer = resolveSource(this.key, value, sources);
    if (this.json) {
      const payload = this.source ? { value, source: layer } : value;
      this.printer!.data(JSON.stringify(payload) + '\n');
      return ExitCode.Ok;
    }
    if (this.source) {
      this.printer!.data(tx(CONFIG_TEXTS.valueWithLayer, { value: formatValueHuman(value), layer }));
    } else {
      this.printer!.data(formatValueHuman(value) + '\n');
    }
    return ExitCode.Ok;
  }
}

/**
 * For nested objects (e.g. `scan`), the `sources` map only stores leaf
 * paths. When the user asks about an intermediate path, surface the most
 * "recent" layer that touched any descendant (highest precedence wins).
 */
function resolveSource(
  key: string,
  value: unknown,
  sources: Map<string, TConfigLayer>,
): TConfigLayer {
  const direct = sources.get(key);
  if (direct) return direct;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const prefix = key + '.';
    let best: TConfigLayer = 'defaults';
    let bestRank = LAYER_RANK.defaults;
    for (const [k, layer] of sources) {
      if (!k.startsWith(prefix)) continue;
      const rank = LAYER_RANK[layer];
      if (rank > bestRank) {
        bestRank = rank;
        best = layer;
      }
    }
    return best;
  }
  return 'defaults';
}

const LAYER_RANK: Record<TConfigLayer, number> = {
  defaults: 0,
  user: 1,
  'user-local': 2,
  project: 3,
  'project-local': 4,
  override: 5,
};

export class ConfigSetCommand extends SmCommand {
  static override paths = [['config', 'set']];
  static override usage = Command.Usage({
    category: 'Config',
    description: 'Write a config key. Project file by default; -g writes to user.',
    details: `
      Reads the target file (creating it if absent), sets the key at the dot-path,
      validates the result against project-config.schema.json, and writes back.
      Value coercion: JSON-parses the raw string first ("true" → true, "42" → 42,
      "null" → null, arrays / objects natural); unparseable falls through as string.
      Schema violation → exit 2, no write performed.
    `,
  });

  key = Option.String({ required: true });
  value = Option.String({ required: true });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const target: TWriteTarget = this.global ? 'user' : 'project';
    const path = targetSettingsPath(target, ctx.cwd, ctx.homedir);

    const current = readJsonObjectOrEmpty(path);
    const value = parseCliValue(this.value);
    try {
      setAtPath(current, this.key, value);
    } catch (err) {
      if (err instanceof ForbiddenSegmentError) {
        this.printer!.info(tx(CONFIG_TEXTS.forbiddenKeySegment, { segment: err.segment, key: err.key }));
        return ExitCode.Error;
      }
      throw err;
    }

    const validators = loadSchemaValidators();
    const result = validators.validate('project-config', current);
    if (!result.ok) {
      this.printer!.info(tx(CONFIG_TEXTS.invalidAfterSet, { errors: result.errors }));
      return ExitCode.Error;
    }

    writeJsonAtomic(path, current);
    this.printer!.data(tx(CONFIG_TEXTS.setWritten, { key: this.key, value: formatValueHuman(value), path }));
    return ExitCode.Ok;
  }
}

export class ConfigResetCommand extends SmCommand {
  static override paths = [['config', 'reset']];
  static override usage = Command.Usage({
    category: 'Config',
    description: 'Remove a config key from the target file (project default; -g for user).',
    details: `
      Strips the key from the target settings.json (lower layers still apply).
      Idempotent — running twice is safe; absent key prints an info note and exits 0.
    `,
  });

  key = Option.String({ required: true });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const target: TWriteTarget = this.global ? 'user' : 'project';
    const path = targetSettingsPath(target, ctx.cwd, ctx.homedir);

    if (!existsSync(path)) {
      this.printer!.data(tx(CONFIG_TEXTS.unsetNoOverride, { path, key: this.key }));
      return ExitCode.Ok;
    }
    const current = readJsonObjectOrEmpty(path);
    let removed: boolean;
    try {
      removed = deleteAtPath(current, this.key);
    } catch (err) {
      if (err instanceof ForbiddenSegmentError) {
        this.printer!.info(tx(CONFIG_TEXTS.forbiddenKeySegment, { segment: err.segment, key: err.key }));
        return ExitCode.Error;
      }
      throw err;
    }
    if (!removed) {
      this.printer!.data(tx(CONFIG_TEXTS.unsetNoOverride, { path, key: this.key }));
      return ExitCode.Ok;
    }

    writeJsonAtomic(path, current);
    this.printer!.data(tx(CONFIG_TEXTS.unsetRemoved, { key: this.key, path }));
    return ExitCode.Ok;
  }
}

export const CONFIG_COMMANDS = [
  ConfigListCommand,
  ConfigGetCommand,
  ConfigShowCommand,
  ConfigSetCommand,
  ConfigResetCommand,
];
