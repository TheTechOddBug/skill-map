/**
 * `sm config list/get/set/reset/show`, read + mutate `.skill-map/settings.json`.
 *
 *   sm config list  [--json] [--strict]
 *   sm config get   <key.dot.path> [--json] [--strict]
 *   sm config set   <key> <value>            , writes to project (or project-local for PROJECT_LOCAL_ONLY keys)
 *   sm config reset <key>                    , removes the key from the same target
 *   sm config show  <key> [--source] [--json] [--strict]
 *
 * `--strict` (here and on `sm scan` / `sm init`) escalates every layered-
 * loader warning (malformed JSON, schema violation, unknown key) into a
 * fatal error, the verb exits 2 with a clean stderr line instead of
 * skipping the offending value. Same flag, same semantics across verbs.
 *
 * Read verbs (`list / get / show`) are exempt from elapsed-time per
 * `spec/cli-contract.md` §Elapsed time. Write verbs (`set / reset`) emit
 * `done in <…>` to stderr like every other in-scope verb.
 *
 * Scope is always project-local: every layered config read walks
 * `<cwd>/.skill-map/settings{.local}.json` only. Writes target
 * `project` (committed) or `project-local` (gitignored, for
 * `PROJECT_LOCAL_ONLY_KEYS`). The historical `-g/--global` switch and
 * `user` / `user-local` targets were removed; see
 * `spec/cli-contract.md` §Scope is always project-local.
 *
 * Value coercion in `set`: the raw CLI string is JSON-parsed first so the
 * user can pass `true`, `42`, `null`, arrays, and objects naturally;
 * unparseable input falls through as a plain string. The merged file is
 * then re-validated against `project-config.schema.json`, invalid values
 * are rejected (exit 2) without touching the file.
 */

import { existsSync } from 'node:fs';

import { Command, Option } from 'clipanion';

import {
  loadConfig,
  type IEffectiveConfig,
  type ILoadConfigOptions,
  type ILoadedConfig,
  type TConfigLayer,
} from '../../kernel/config/loader.js';
import {
  ForbiddenSegmentError,
  enumerateConfigPaths,
  getAtPath,
} from '../../core/config/dot-path.js';
import {
  ConfigValidationError,
  PRIVACY_SENSITIVE_KEYS,
  PROJECT_LOCAL_ONLY_KEYS,
  ProjectLocalOnlyKeyError,
  projectPathExposure,
  removeConfigValue,
  writeConfigValue,
} from '../../core/config/helper.js';
import { resolveActiveProvider } from '../../core/config/active-provider.js';
import { builtIns } from '../../plugins/built-ins.js';
import { ansiFor, type IAnsi } from '../util/ansi.js';
import { closestMatches } from '../util/edit-distance.js';
import { defaultLocalSettingsPath, defaultSettingsPath, resolveDbPath } from '../util/db-path.js';
import { relativeIfBelow } from '../util/path-display.js';
import { dropScanZone } from '../util/scan-zone-drop.js';
import { ExitCode } from '../util/exit-codes.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { CONFIG_TEXTS } from '../i18n/config.texts.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';

// -----------------------------------------------------------------------------
// shared helpers
// -----------------------------------------------------------------------------

type TWriteTarget = 'project' | 'project-local';

function targetSettingsPath(target: TWriteTarget, cwd: string): string {
  return target === 'project-local'
    ? defaultLocalSettingsPath(cwd)
    : defaultSettingsPath(cwd);
}

/**
 * Pick the right write target for `key`. PROJECT_LOCAL_ONLY keys route
 * to `project-local` (gitignored); everything else writes to the
 * committed `project` file. The helper's `writeConfigValue` enforces
 * the same rule, this function just front-runs it so the CLI never
 * asks for a write the helper would reject. Per
 * `spec/cli-contract.md` §Scope is always project-local, there is no
 * `user` / `user-local` target.
 */
function resolveWriteTarget(key: string): TWriteTarget {
  if (PROJECT_LOCAL_ONLY_KEYS.has(key)) return 'project-local';
  return 'project';
}

/**
 * Format a "Did you mean?" line for an unknown config key. Returns
 * `null` when no candidate is close enough, in that case the caller
 * surfaces only the bare unknown-key error and moves on.
 *
 * Distance cap is intentionally tight (3 edits) so suggestions stay
 * relevant. With dot-paths, a single typo in any segment is usually
 * within 1-2 edits.
 */
function suggestConfigKey(effective: unknown, typed: string, ansi: IAnsi): string | null {
  const candidates = enumerateConfigPaths(effective);
  const matches = closestMatches(typed, candidates, { topN: 3, maxDistance: 3 });
  if (matches.length === 0) return null;
  const formatted = matches.map((m) => `'${m}'`).join(', ');
  return tx(CONFIG_TEXTS.unknownKeySuggestion, {
    hint: ansi.dim(tx(CONFIG_TEXTS.unknownKeySuggestionHint, { suggestions: formatted })),
  });
}

/**
 * Schema-declared optional keys whose runtime value is computed (not
 * stored in settings.json). When `sm config get <key>` finds them
 * absent from the merged config, instead of "Unknown config key" we
 * call their resolver and surface the runtime value. Keeps the get/set
 * pair honest: `set` writes the value, `get` reads what the runtime
 * would actually see. Today the only entry is `activeProvider`
 * (filesystem auto-detect via `resolveActiveProvider`); future
 * additions land here as the auto-detect surface grows.
 */
const KNOWN_DEFAULTLESS_KEY_RESOLVERS: Record<string, (cwd: string) => unknown> = {
  activeProvider: (cwd) => resolveActiveProvider(cwd, builtIns().providers).resolved,
};

function parseCliValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
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
    const stderrTty = stderr as NodeJS.WriteStream & { isTTY?: boolean };
    const ansi = ansiFor({ isTTY: stderrTty.isTTY === true, noColorFlag: false });
    stderr.write(tx(CONFIG_TEXTS.loadFailure, { glyph: ansi.red('✕'), message }));
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
      const stderrTty = stderr as NodeJS.WriteStream & { isTTY?: boolean };
      const ansi = ansiFor({ isTTY: stderrTty.isTTY === true, noColorFlag: false });
      stderr.write(
        tx(CONFIG_TEXTS.forbiddenKeySegment, {
          glyph: ansi.red('✕'),
          segment: err.segment,
          key: err.key,
          hint: ansi.dim(CONFIG_TEXTS.forbiddenKeySegmentHint),
        }),
      );
      return { ok: false, exitCode: ExitCode.Error };
    }
    throw err;
  }
}

// Recursive generator walks every leaf of an arbitrary JSON-shaped
// object, branching on primitive vs array vs nested object. The
// branches are the type discriminator; splitting would just rebuild
// it elsewhere. Per `context/lint.md` category 7 (recursive type-discriminator walkers).
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
      Walks defaults → project → project-local and prints the merged result.
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
      { strict: this.strict, ...defaultRuntimeContext() },
      this.context.stderr,
    );
    if (!result.ok) return result.exitCode;
    const { effective, warnings } = result.loaded;
    for (const w of warnings) this.printer!.info(w + '\n');
    if (this.json) {
      this.printer!.data(JSON.stringify(effective, null, 2) + '\n');
      return ExitCode.Ok;
    }
    const ansi = this.ansiFor('stdout');
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
 * `null`, empty array, or empty object, the three sentinels we want
 * to collapse to a dim em-dash in the sectioned list. Pulled out so
 * the renderer's branch count stays readable.
 */
function isEmptyConfigValue(value: unknown): boolean {
  if (value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).length === 0;
  }
  return false;
}

/**
 * Like `formatValueHuman` but collapses empty / null sentinels to a
 * dim em-dash so the section block visually skips defaults the user
 * has not overridden.
 */
function formatValueListHuman(value: unknown, ansi: IAnsi): string {
  if (isEmptyConfigValue(value)) return ansi.dim(CONFIG_TEXTS.listEmptyValue);
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return JSON.stringify(value);
  }
  return String(value);
}

/**
 * Resolve the final value for `sm config get`: prefer the layered
 * lookup result, fall back to a runtime resolver when the key is
 * known-but-defaultless (today only `activeProvider`, computed via
 * filesystem auto-detect). Returns `undefined` only when both paths
 * agree the key has no value, so the caller renders the unknown-key
 * error.
 */
function resolveConfigGetValue(
  lookupValue: unknown,
  key: string,
  cwd: string,
): unknown {
  if (lookupValue !== undefined) return lookupValue;
  const runtimeResolver = KNOWN_DEFAULTLESS_KEY_RESOLVERS[key];
  return runtimeResolver ? runtimeResolver(cwd) : undefined;
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
    const ctx = defaultRuntimeContext();
    const result = tryLoadConfig({ strict: this.strict, ...ctx }, this.context.stderr);
    if (!result.ok) return result.exitCode;
    const { effective, warnings } = result.loaded;
    for (const w of warnings) this.printer!.info(w + '\n');
    const lookup = safeGetAtPath(effective, this.key, this.context.stderr);
    if (!lookup.ok) return lookup.exitCode;
    const value = resolveConfigGetValue(lookup.value, this.key, ctx.cwd);
    if (value === undefined) {
      const ansi = this.ansiFor('stderr');
      this.printer!.info(
        tx(CONFIG_TEXTS.unknownKey, { glyph: ansi.red('✕'), key: this.key }),
      );
      const suggestion = suggestConfigKey(effective, this.key, ansi);
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
      (defaults / project / project-local / override).
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
    const ctx = defaultRuntimeContext();
    const result = tryLoadConfig({ strict: this.strict, ...ctx }, this.context.stderr);
    if (!result.ok) return result.exitCode;
    const { effective, sources, warnings } = result.loaded;
    for (const w of warnings) this.printer!.info(w + '\n');
    const ansiShow = this.ansiFor('stderr');
    const errGlyphShow = ansiShow.red('✕');
    let value: unknown;
    try {
      value = getAtPath(effective, this.key);
    } catch (err) {
      if (err instanceof ForbiddenSegmentError) {
        this.printer!.info(
          tx(CONFIG_TEXTS.forbiddenKeySegment, {
            glyph: errGlyphShow,
            segment: err.segment,
            key: err.key,
            hint: ansiShow.dim(CONFIG_TEXTS.forbiddenKeySegmentHint),
          }),
        );
        return ExitCode.Error;
      }
      throw err;
    }
    if (value === undefined) {
      // Same known-but-defaultless fallback as `ConfigGetCommand`:
      // schema-declared keys whose runtime value is computed (today
      // only `activeProvider`) get their resolver called so `show`
      // matches what the runtime would see.
      const runtimeResolver = KNOWN_DEFAULTLESS_KEY_RESOLVERS[this.key];
      if (runtimeResolver) {
        value = runtimeResolver(ctx.cwd);
      }
    }
    if (value === undefined) {
      this.printer!.info(tx(CONFIG_TEXTS.unknownKey, { glyph: errGlyphShow, key: this.key }));
      return ExitCode.NotFound;
    }
    const layer = resolveSource(this.key, value, sources);
    if (this.json) {
      const payload = this.source ? { value, source: layer } : value;
      this.printer!.data(JSON.stringify(payload) + '\n');
      return ExitCode.Ok;
    }
    if (this.source) {
      const ansi = this.ansiFor('stdout');
      this.printer!.data(
        tx(CONFIG_TEXTS.valueWithLayer, {
          value: formatValueHuman(value),
          layerTag: ansi.dim(tx(CONFIG_TEXTS.valueLayerTag, { layer })),
        }),
      );
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
  project: 1,
  'project-local': 2,
  override: 3,
};

export class ConfigSetCommand extends SmCommand {
  static override paths = [['config', 'set']];
  static override usage = Command.Usage({
    category: 'Config',
    description: 'Write a config key. Targets project (committed) or project-local (gitignored).',
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
  yes = Option.Boolean('--yes', false, {
    description: 'Confirm a privacy-sensitive write that opens disk access outside the project (scan.referencePaths).',
  });

  // CLI orchestrator: each branch is one validation gate (forbidden
  // segment / privacy guard / schema violation) or output dispatch.
  // Splitting per branch scatters the gate from the value it gates.
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const target: TWriteTarget = resolveWriteTarget(this.key);
    const path = targetSettingsPath(target, ctx.cwd);

    const stderrAnsi = this.ansiFor('stderr');
    const errGlyph = stderrAnsi.red('✕');

    const value = parseCliValue(this.value);

    // Privacy gate: writes that EXPAND the scan surface beyond the
    // project root require `--yes`. Writes that NARROW it (removing
    // paths) pass through without confirmation.
    if (PRIVACY_SENSITIVE_KEYS.has(this.key)) {
      const exposure = projectPathExposure({
        key: this.key,
        value,
        cwd: ctx.cwd,
      });
      if (exposure.expandsSurface && !this.yes) {
        this.printer!.info(
          tx(CONFIG_TEXTS.privacyGateRequired, {
            glyph: errGlyph,
            key: this.key,
            paths: exposure.exposedPaths.map((p) => `  - ${p}`).join('\n'),
            hint: stderrAnsi.dim(CONFIG_TEXTS.privacyGateRequiredHint),
          }),
        );
        return ExitCode.Error;
      }
      if (exposure.expandsSurface) {
        // `--yes` confirmed, print the same list as a receipt so the
        // operator sees on screen what they just opted into.
        this.printer!.info(
          tx(CONFIG_TEXTS.privacyGateConfirmed, {
            glyph: stderrAnsi.dim('ⓘ'),
            key: this.key,
            paths: exposure.exposedPaths.map((p) => `  - ${p}`).join('\n'),
          }),
        );
      }
    }

    // `activeProvider` rejects unknown ids at set time, the lens
    // switch + scan-table wipe is destructive (drops `scan_nodes`,
    // `scan_links`, …) and we do NOT want a typo (`clude` instead of
    // `claude`) silently switching to a non-existent lens and leaving
    // the operator with an empty graph. The catalogue is the same set
    // of provider ids `kernel.registry.all('provider')` ends up with;
    // we read it directly from `builtIns()` so the check survives
    // without loading the full plugin runtime.
    if (this.key === 'activeProvider' && typeof value === 'string') {
      const known = new Set(builtIns().providers.map((p) => p.id));
      if (!known.has(value)) {
        const allowed = [...known].sort().join(', ');
        this.printer!.info(
          tx(CONFIG_TEXTS.activeProviderUnknown, {
            glyph: errGlyph,
            value,
            hint: stderrAnsi.dim(
              tx(CONFIG_TEXTS.activeProviderUnknownHint, { allowed }),
            ),
          }),
        );
        return ExitCode.Error;
      }
    }

    try {
      writeConfigValue(this.key, value, {
        target,
        cwd: ctx.cwd,
      });
      // When the operator sets `activeProvider` explicitly, refresh
      // the `activeProviderMarkers` snapshot to match the current
      // filesystem state. Keeps the drift detector consistent: the
      // next scan diffs the freshly re-detected set against THIS
      // snapshot, so we don't warn about every marker that existed
      // before the set call. The two writes are not atomic at the FS
      // level (each is its own atomic-write), but the second write
      // re-runs AJV against the merged file (lens + markers), so a
      // failure here leaves a valid file with just the lens set,
      // identical to the pre-snapshot legacy state.
      if (this.key === 'activeProvider' && typeof value === 'string') {
        const detected = resolveActiveProvider(ctx.cwd, builtIns().providers).detected;
        writeConfigValue('activeProviderMarkers', [...detected], {
          target,
          cwd: ctx.cwd,
        });
      }
    } catch (err) {
      if (err instanceof ForbiddenSegmentError) {
        this.printer!.info(
          tx(CONFIG_TEXTS.forbiddenKeySegment, {
            glyph: errGlyph,
            segment: err.segment,
            key: err.key,
            hint: stderrAnsi.dim(CONFIG_TEXTS.forbiddenKeySegmentHint),
          }),
        );
        return ExitCode.Error;
      }
      if (err instanceof ProjectLocalOnlyKeyError) {
        this.printer!.info(
          tx(CONFIG_TEXTS.projectLocalOnlyKeyRejection, {
            glyph: errGlyph,
            key: err.key,
            hint: stderrAnsi.dim(CONFIG_TEXTS.projectLocalOnlyKeyRejectionHint),
          }),
        );
        return ExitCode.Error;
      }
      if (err instanceof ConfigValidationError) {
        this.printer!.info(
          tx(CONFIG_TEXTS.invalidAfterSet, { glyph: errGlyph, errors: err.errors }),
        );
        return ExitCode.Error;
      }
      throw err;
    }

    const ansi = this.ansiFor('stdout');
    this.printer!.data(
      tx(CONFIG_TEXTS.setWritten, {
        glyph: ansi.green('✓'),
        key: this.key,
        value: formatValueHuman(value),
        wroteTag: ansi.dim(
          tx(CONFIG_TEXTS.setWroteTag, {
            path: relativeIfBelow(path, ctx.cwd),
          }),
        ),
      }),
    );

    if (this.key === 'activeProvider') {
      this.announceLensSwitch(ctx.cwd, ansi);
    }

    return ExitCode.Ok;
  }

  /**
   * Side effect of `sm config set activeProvider <id>`, atomically
   * drops the `scan_*` zone so the persisted graph never reflects the
   * wrong lens (see `architecture.md` §Active Provider Lens). The drop
   * is non-destructive of `state_*` / `config_*` rows; the operator
   * runs `sm scan` next to repopulate.
   *
   * Silent when no DB file exists on disk yet (fresh project that has
   * never run `sm scan`), the lens just gets set and the next scan
   * uses it.
   */
  private announceLensSwitch(cwd: string, ansi: IAnsi): void {
    const dbPath = resolveDbPath({ db: undefined, cwd });
    const okGlyph = ansi.green('✓');
    if (!existsSync(dbPath)) {
      this.printer!.info(tx(CONFIG_TEXTS.lensSwitchedNoDb, { glyph: okGlyph }));
      return;
    }
    const result = dropScanZone(dbPath);
    const hint = ansi.dim(CONFIG_TEXTS.lensSwitchedClearedHint);
    if (result.tableCount === 0) {
      this.printer!.info(tx(CONFIG_TEXTS.lensSwitchedEmpty, { glyph: okGlyph, hint }));
      return;
    }
    this.printer!.info(
      tx(CONFIG_TEXTS.lensSwitchedCleared, {
        glyph: okGlyph,
        tableCount: result.tableCount,
        tableNames: result.droppedTables.join(', '),
        hint,
      }),
    );
  }
}

export class ConfigResetCommand extends SmCommand {
  static override paths = [['config', 'reset']];
  static override usage = Command.Usage({
    category: 'Config',
    description: 'Remove a config key from the target settings file.',
    details: `
      Strips the key from the target settings.json (lower layers still apply).
      Idempotent: running twice is safe; absent key prints an info note and exits 0.
    `,
  });

  key = Option.String({ required: true });

  // CLI orchestrator: each branch is one validation gate (forbidden
  // segment / absent file / no-op delete) or a post-success render.
  // Splitting per branch scatters the gates from the value they gate.
  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const target: TWriteTarget = resolveWriteTarget(this.key);
    const path = targetSettingsPath(target, ctx.cwd);

    const ansi = this.ansiFor('stdout');
    const okGlyph = ansi.green('✓');

    // The helper short-circuits on a missing file (readJsonObjectOrEmpty
    // returns `{}` and deleteAtPath returns `false`), but the verb
    // wants a richer no-override message that quotes the path the
    // user expected. Branch on existsSync first so the diagnostic is
    // accurate in both "file absent" and "key absent in present
    // file" shapes.
    if (!existsSync(path)) {
      this.printer!.data(
        tx(CONFIG_TEXTS.unsetNoOverride, {
          glyph: okGlyph,
          path: relativeIfBelow(path, ctx.cwd),
          key: this.key,
        }),
      );
      return ExitCode.Ok;
    }

    let removed: boolean;
    try {
      removed = removeConfigValue(this.key, {
        target,
        cwd: ctx.cwd,
      });
    } catch (err) {
      if (err instanceof ForbiddenSegmentError) {
        this.printer!.info(
          tx(CONFIG_TEXTS.forbiddenKeySegment, {
            glyph: ansi.red('✕'),
            segment: err.segment,
            key: err.key,
            hint: ansi.dim(CONFIG_TEXTS.forbiddenKeySegmentHint),
          }),
        );
        return ExitCode.Error;
      }
      if (err instanceof ProjectLocalOnlyKeyError) {
        this.printer!.info(
          tx(CONFIG_TEXTS.projectLocalOnlyKeyRejection, {
            glyph: ansi.red('✕'),
            key: err.key,
            hint: ansi.dim(CONFIG_TEXTS.projectLocalOnlyKeyRejectionHint),
          }),
        );
        return ExitCode.Error;
      }
      if (err instanceof ConfigValidationError) {
        this.printer!.info(
          tx(CONFIG_TEXTS.invalidAfterSet, { glyph: ansi.red('✕'), errors: err.errors }),
        );
        return ExitCode.Error;
      }
      throw err;
    }

    if (!removed) {
      this.printer!.data(
        tx(CONFIG_TEXTS.unsetNoOverride, {
          glyph: okGlyph,
          path: relativeIfBelow(path, ctx.cwd),
          key: this.key,
        }),
      );
      return ExitCode.Ok;
    }
    this.printer!.data(
      tx(CONFIG_TEXTS.unsetRemoved, {
        glyph: okGlyph,
        key: this.key,
        path: relativeIfBelow(path, ctx.cwd),
      }),
    );
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
