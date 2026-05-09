/**
 * `sm plugins` — discover, inspect, and toggle plugins.
 *
 *   sm plugins list      tabulate discovered plugins with status (and DB / settings overrides)
 *   sm plugins show X    dump one plugin's manifest + loaded extensions
 *   sm plugins doctor    full load pass + summary by failure mode
 *   sm plugins enable  <id> | --all   write `enabled: true` to config_plugins
 *   sm plugins disable <id> | --all   write `enabled: false` to config_plugins
 *
 * Step 6.6 wires the enable/disable verbs and respects the resolution
 * order spec'd in `kernel/config/plugin-resolver.ts`:
 *
 *   DB override (config_plugins) > settings.json (#/plugins/<id>/enabled) > installed default (true)
 *
 * Spec § A.7 — granularity. Each plugin / built-in bundle declares a
 * granularity (`bundle` or `extension`). The CLI surfaces both kinds:
 *
 *   - bundle granularity ('claude', and most user plugins by default):
 *     the bundle id is the only toggle-able key. `sm plugins disable
 *     claude` works; `sm plugins disable claude/claude` is rejected as
 *     a misuse.
 *   - extension granularity ('core', plus user plugins that opt in):
 *     the bundle id alone is NOT toggle-able. `sm plugins disable core`
 *     is rejected; `sm plugins disable core/superseded` works.
 *
 * `--all` operates only on top-level plugin / bundle ids (never expands
 * to qualified `<bundle>/<ext>` keys); the user loses no expressivity
 * because granularity=extension bundles surface every extension in
 * `--all` only via their bundle id, which is rejected with directed
 * guidance — the right tool for the "disable every core extension"
 * intent is `--no-built-ins` on `sm scan`.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import { builtInBundles } from '../../built-in-plugins/built-ins.js';
import type {
  IProvider,
  IExtractor,
} from '../../kernel/extensions/index.js';
import type { ILoadedExtension } from '../../kernel/types/plugin.js';
import {
  createPluginLoader,
  installedSpecVersion,
  type IPluginLoaderOptions,
} from '../../kernel/adapters/plugin-loader.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { isPluginLocked } from '../../kernel/config/locked-plugins.js';
import { makeEnabledResolver } from '../../kernel/config/plugin-resolver.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import type {
  IDiscoveredPlugin,
  TGranularity,
} from '../../kernel/types/plugin.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { PLUGINS_TEXTS } from '../i18n/plugins.texts.js';
import { ansiFor, type IAnsi } from '../util/ansi.js';
import {
  defaultProjectPluginsDir,
  defaultUserPluginsDir,
  resolveDbPath,
} from '../util/db-path.js';
import { ExitCode } from '../util/exit-codes.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { tryWithSqlite, withSqlite } from '../util/with-sqlite.js';

interface IScopeOptions {
  global: boolean;
  pluginDir: string | undefined;
}

function resolveSearchPaths(opts: IScopeOptions, cwd: string, homedir: string): string[] {
  if (opts.pluginDir) return [resolve(opts.pluginDir)];
  const ctx = { cwd, homedir };
  const project = defaultProjectPluginsDir(ctx);
  const user = defaultUserPluginsDir(ctx);
  return opts.global ? [user] : [project, user];
}

/**
 * Build a resolver from the layered config (settings.json) + the DB
 * overrides (config_plugins). Either layer may be absent (no
 * settings.json, no DB) — both fall through gracefully.
 */
async function buildResolver(global: boolean): Promise<(id: string) => boolean> {
  const ctx = defaultRuntimeContext();
  const { effective: cfg } = loadConfig({
    scope: global ? 'global' : 'project',
    cwd: ctx.cwd,
    homedir: ctx.homedir,
  });
  const dbPath = resolveDbPath({ global, db: undefined, cwd: ctx.cwd, homedir: ctx.homedir });
  const dbOverrides =
    (await tryWithSqlite(
      { databasePath: dbPath, autoBackup: false },
      (adapter) => adapter.pluginConfig.loadOverrideMap(),
    )) ?? new Map<string, boolean>();
  return makeEnabledResolver(cfg, dbOverrides);
}

async function loadAll(opts: IScopeOptions): Promise<IDiscoveredPlugin[]> {
  const ctx = defaultRuntimeContext();
  const validators = loadSchemaValidators();
  const loaderOpts: IPluginLoaderOptions = {
    searchPaths: resolveSearchPaths(opts, ctx.cwd, ctx.homedir),
    validators,
    specVersion: installedSpecVersion(),
    resolveEnabled: await buildResolver(opts.global),
  };
  const loader = createPluginLoader(loaderOpts);
  return loader.discoverAndLoadAll();
}

// --- built-in bundle synthesis -------------------------------------------

interface IBuiltInBundleRow {
  id: string;
  granularity: TGranularity;
  enabled: boolean;
  extensions: ReadonlyArray<{
    id: string;
    kind: string;
    version: string;
    enabled: boolean;
  }>;
  /** Per-extension version+kind catalogue, used by `sm plugins show`. */
  manifestSummary: string;
}

/**
 * Build a synthesised view over the two built-in bundles, with the
 * resolved enabled-state for the bundle (granularity=bundle) or each
 * extension (granularity=extension). This lets the CLI list / show /
 * doctor / enable / disable verbs treat built-ins as first-class
 * citizens of the plugin surface — the spec promise that "no extension
 * is privileged, removable" only holds if the user can see and toggle
 * them through the same commands as their own plugins.
 */
function builtInRows(resolveEnabled: (id: string) => boolean): IBuiltInBundleRow[] {
  return builtInBundles.map((bundle) => {
    const bundleEnabled = resolveEnabled(bundle.id);
    const extensions = bundle.extensions.map((ext) => ({
      id: ext.id,
      kind: ext.kind,
      version: ext.version,
      enabled:
        bundle.granularity === 'bundle'
          ? bundleEnabled
          : resolveEnabled(qualifiedExtensionId(bundle.id, ext.id)),
    }));
    const manifestSummary = bundle.extensions
      .map((ext) => `${ext.kind}:${qualifiedExtensionId(bundle.id, ext.id)}@${ext.version}`)
      .join(', ');
    return {
      id: bundle.id,
      granularity: bundle.granularity,
      enabled: bundleEnabled,
      extensions,
      manifestSummary,
    };
  });
}

// --- list -----------------------------------------------------------------

export class PluginsListCommand extends SmCommand {
  static override paths = [['plugins', 'list']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'List discovered plugins and their load status.',
    details: 'Scans <scope>/.skill-map/plugins and ~/.skill-map/plugins (or --plugin-dir <path>). Built-in bundles (claude, core) are listed alongside user plugins.',
  });

  pluginDir = Option.String('--plugin-dir', { required: false });

  protected async run(): Promise<number> {
    const plugins = await loadAll({ global: this.global, pluginDir: this.pluginDir });
    const resolveEnabled = await buildResolver(this.global);
    const builtIns = builtInRows(resolveEnabled);

    if (this.json) {
      this.printer!.data(
        JSON.stringify({ builtIns, plugins }, omitModule, 2) + '\n',
      );
      return ExitCode.Ok;
    }

    if (plugins.length === 0 && builtIns.length === 0) {
      this.printer!.data(PLUGINS_TEXTS.listEmpty);
      return ExitCode.Ok;
    }

    const stdout = this.context.stdout as NodeJS.WriteStream;
    const ansi = ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: this.noColor });
    this.printer!.data(renderListHuman(builtIns, plugins, ansi));
    return ExitCode.Ok;
  }
}

// --- list renderer --------------------------------------------------------

interface IListRow {
  /** Bundle / plugin id (raw, sanitized for user plugins). */
  id: string;
  /** Resolved enabled-state of the row. Drives ✓ / ✕ glyph + color. */
  enabled: boolean;
  /** Source label (`built-in` / `user`). */
  source: string;
  /** Bare extension names (no kind: prefix, no @version). */
  names: string[];
  /** Optional reason line shown when the row failed to load. */
  reason?: string | undefined;
}

/**
 * Render the human-mode body of `sm plugins list`.
 *
 * Layout per row:
 *
 *   ✓  <id padded>  <count> ext   <source>
 *        name-a, name-b, name-c
 *
 * Names wrap to a soft 76-col limit, broken on commas, indented to line
 * up under the names start column. Padding is computed once across the
 * whole table so columns align regardless of id length.
 */
function renderListHuman(
  builtIns: IBuiltInBundleRow[],
  plugins: IDiscoveredPlugin[],
  ansi: IAnsi,
): string {
  const rows: IListRow[] = [
    ...builtIns.map(builtInToListRow),
    ...plugins.map(pluginToListRow),
  ];

  const idWidth = Math.max(...rows.map((r) => r.id.length));
  const countWidth = Math.max(
    ...rows.map((r) => String(r.names.length).length),
  );

  const lines: string[] = [];
  for (const row of rows) {
    const glyph = row.enabled
      ? ansi.green(PLUGINS_TEXTS.rowGlyphOk)
      : ansi.red(PLUGINS_TEXTS.rowGlyphOff);
    const idCol = row.id.padEnd(idWidth);
    const countCol = String(row.names.length).padStart(countWidth);
    lines.push(
      tx(PLUGINS_TEXTS.bundleRow, {
        glyph,
        id: idCol,
        count: ` ${countCol}`,
        source: ansi.dim(row.source),
      }),
    );
    const indent = PLUGINS_TEXTS.bundleSubIndent;
    if (row.reason) {
      lines.push(`${indent}${ansi.dim(row.reason)}`);
    } else if (row.names.length > 0) {
      for (const wrapped of wrapNames(row.names, indent, 76)) {
        lines.push(`${indent}${ansi.dim(wrapped)}`);
      }
    }
  }
  return lines.join('\n') + '\n' + PLUGINS_TEXTS.listTipShow;
}

function builtInToListRow(b: IBuiltInBundleRow): IListRow {
  // Built-in ids and extension names are static / trusted (compiled in
  // from `built-in-plugins/built-ins.ts`); no sanitisation needed.
  return {
    id: b.id,
    enabled: b.enabled,
    source: PLUGINS_TEXTS.sourceBuiltIn,
    names: b.extensions.map((e) => e.id),
  };
}

function pluginToListRow(p: IDiscoveredPlugin): IListRow {
  // Every field that originates from the plugin manifest (`id`, per-ext
  // ids, `reason`) is user-controlled and runs through `sanitizeForTerminal`
  // before it lands in the rendered output.
  const enabled = p.status === 'enabled';
  const names =
    p.extensions?.map((e) => sanitizeForTerminal(e.id)) ?? [];
  const reason =
    p.status === 'enabled'
      ? undefined
      : sanitizeForTerminal(p.reason ?? '') || undefined;
  return {
    id: sanitizeForTerminal(p.id),
    enabled,
    source: PLUGINS_TEXTS.sourceUser,
    names,
    reason,
  };
}

/**
 * Generic greedy word-wrap to a soft visible width. Splits on whitespace
 * runs and never breaks mid-word. Returns raw lines (no indent, no
 * color); the caller prepends indent and applies styling so wrap math
 * stays honest under color codes.
 */
function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (candidate.length > maxWidth && current !== '') {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

/**
 * Greedy wrap of a comma-separated list to a soft visible width.
 * Returns the raw (uncoloured, un-indented) chunks; the caller prepends
 * indent + applies color so wrap math stays honest under color codes.
 */
function wrapNames(names: string[], indent: string, maxWidth: number): string[] {
  const out: string[] = [];
  const sep = ', ';
  let current = '';
  for (const name of names) {
    const candidate = current === '' ? name : `${current}${sep}${name}`;
    if (indent.length + candidate.length > maxWidth && current !== '') {
      out.push(`${current},`);
      current = name;
    } else {
      current = candidate;
    }
  }
  if (current !== '') out.push(current);
  return out;
}

// --- show -----------------------------------------------------------------

export class PluginsShowCommand extends SmCommand {
  static override paths = [['plugins', 'show']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Show a single plugin\'s manifest + loaded extensions.',
  });

  id = Option.String({ required: true });
  pluginDir = Option.String('--plugin-dir', { required: false });

  protected async run(): Promise<number> {
    const plugins = await loadAll({ global: this.global, pluginDir: this.pluginDir });
    const resolveEnabled = await buildResolver(this.global);
    const builtIns = builtInRows(resolveEnabled);
    const builtIn = builtIns.find((b) => b.id === this.id);
    const match = plugins.find((p) => p.id === this.id);

    if (!builtIn && !match) {
      const stderr = this.context.stderr as NodeJS.WriteStream;
      const ansi = ansiFor({ isTTY: stderr.isTTY === true, noColorFlag: this.noColor });
      this.printer!.error(
        tx(PLUGINS_TEXTS.pluginNotFound, {
          glyph: ansi.red('✕'),
          id: sanitizeForTerminal(this.id),
          hint: ansi.dim(PLUGINS_TEXTS.pluginNotFoundHint),
        }),
      );
      return ExitCode.NotFound;
    }

    if (this.json) {
      const payload = builtIn ?? match;
      this.printer!.data(JSON.stringify(payload, omitModule, 2) + '\n');
      return ExitCode.Ok;
    }

    const stdout = this.context.stdout as NodeJS.WriteStream;
    const ansi = ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: this.noColor });
    const text = builtIn
      ? renderBuiltInDetail(builtIn, ansi)
      : renderPluginDetail(match!, ansi);
    this.printer!.data(text);
    return ExitCode.Ok;
  }
}

// --- show renderer --------------------------------------------------------

interface IExtensionListItem {
  glyph: string | null; // null when granularity=bundle (no per-ext toggle)
  kind: string;
  name: string;
  version: string;
}

/**
 * Detail rendering for one built-in bundle:
 *
 *   ✓  core   built-in   15 extensions
 *
 *       ✓  provider   markdown               1.0.0
 *       ✓  extractor  external-url-counter   1.0.0
 *       ...
 *
 * Per-extension glyphs only appear when `granularity=extension` (each
 * extension is independently toggle-able). For `granularity=bundle`, the
 * glyph slot stays empty — the bundle is the only toggle, so individual
 * states are implicit.
 */
function renderBuiltInDetail(b: IBuiltInBundleRow, ansi: IAnsi): string {
  const enabled = b.enabled;
  const glyph = enabled
    ? ansi.green(PLUGINS_TEXTS.rowGlyphOk)
    : ansi.red(PLUGINS_TEXTS.rowGlyphOff);
  const count = b.extensions.length;
  // Qualify the extension name with `<bundleId>/` ONLY when
  // granularity=extension — those ids are the toggle-able handles the
  // user types into `sm plugins enable|disable`. For granularity=bundle
  // the per-extension names are informational (the bundle is the only
  // toggle-able key), so we leave them bare.
  const qualify = b.granularity === 'extension';
  const items: IExtensionListItem[] = b.extensions.map((ext) => ({
    glyph:
      b.granularity === 'extension'
        ? ext.enabled
          ? ansi.green(PLUGINS_TEXTS.rowGlyphOk)
          : ansi.red(PLUGINS_TEXTS.rowGlyphOff)
        : null,
    kind: ext.kind,
    name: qualify ? `${b.id}/${ext.id}` : ext.id,
    version: ext.version,
  }));
  return (
    tx(PLUGINS_TEXTS.detailHeaderBuiltIn, {
      glyph,
      id: b.id,
      source: ansi.dim(PLUGINS_TEXTS.sourceBuiltIn),
      count,
      plural: count === 1 ? '' : 's',
    }) +
    PLUGINS_TEXTS.detailExtensionsBlock +
    renderExtensionItems(items, ansi)
  );
}

/**
 * Detail rendering for one user plugin:
 *
 *   ✓  my-plugin   v0.3.0   user   2 extensions
 *
 *     Path     /…/.skill-map/plugins/my-plugin/
 *     Compat   ^0.18.0
 *     Summary  My description.
 *
 *       extractor  thing-1   0.3.0
 *       rule       thing-2   0.3.0
 *
 * Disabled / errored plugins keep the field block (`Path`, `Reason`) and
 * skip the extensions section. The `user` source label stays the same
 * regardless of state — the glyph (✕) signals "off".
 */
// Optional manifest fields (`version`, `specCompat`, `description`,
// `reason`) each fall back via `??` — every coalesce is one cyclomatic
// branch, none is a real control-flow decision. Defence in depth: every
// manifest-sourced field is sanitized before rendering. `path` is
// composed from safe constants via `path.join` and stays bare.
// eslint-disable-next-line complexity
function renderPluginDetail(match: IDiscoveredPlugin, ansi: IAnsi): string {
  const enabled = match.status === 'enabled';
  const glyph = enabled
    ? ansi.green(PLUGINS_TEXTS.rowGlyphOk)
    : ansi.red(PLUGINS_TEXTS.rowGlyphOff);
  const version = sanitizeForTerminal(
    match.manifest?.version ?? PLUGINS_TEXTS.detailVersionUnknown,
  );
  const compat = sanitizeForTerminal(
    match.manifest?.specCompat ?? PLUGINS_TEXTS.detailCompatUnknown,
  );
  // Qualified-name rule: granularity=extension surfaces the toggle-able
  // `<bundleId>/<extId>` handle; granularity=bundle keeps the bare id
  // (informational, not user-tippable on its own).
  const qualify = match.granularity === 'extension';
  const safeBundleId = sanitizeForTerminal(match.id);
  const items: IExtensionListItem[] =
    enabled && match.extensions
      ? match.extensions.map((ext) => {
          const safeExtId = sanitizeForTerminal(ext.id);
          return {
            glyph:
              match.granularity === 'extension'
                ? ansi.green(PLUGINS_TEXTS.rowGlyphOk)
                : null,
            kind: sanitizeForTerminal(ext.kind),
            name: qualify ? `${safeBundleId}/${safeExtId}` : safeExtId,
            version: sanitizeForTerminal(ext.version),
          };
        })
      : [];
  const extCount = items.length;
  const out: string[] = [];
  out.push(
    tx(PLUGINS_TEXTS.detailHeaderUser, {
      glyph,
      id: sanitizeForTerminal(match.id),
      version,
      source: ansi.dim(PLUGINS_TEXTS.sourceUser),
      extCount: extCount > 0
        ? `   ${extCount} extension${extCount === 1 ? '' : 's'}`
        : '',
    }),
  );
  // Field block — Path / Compat / Summary / Reason. Compact label width
  // computed across the rows we'll actually emit so labels align.
  const fields: Array<{ label: string; value: string }> = [];
  fields.push({ label: PLUGINS_TEXTS.detailFieldPath, value: match.path });
  if (match.manifest?.specCompat) {
    fields.push({ label: PLUGINS_TEXTS.detailFieldCompat, value: compat });
  }
  if (match.manifest?.description) {
    fields.push({
      label: PLUGINS_TEXTS.detailFieldSummary,
      value: sanitizeForTerminal(match.manifest.description),
    });
  }
  if (match.reason) {
    fields.push({
      label: PLUGINS_TEXTS.detailFieldReason,
      value: sanitizeForTerminal(match.reason),
    });
  }
  const labelWidth = Math.max(...fields.map((f) => f.label.length));
  out.push('\n');
  for (const f of fields) {
    out.push(
      tx(PLUGINS_TEXTS.detailFieldRow, {
        label: f.label.padEnd(labelWidth),
        value: f.value,
      }),
    );
  }
  if (items.length > 0) {
    out.push(PLUGINS_TEXTS.detailExtensionsBlock);
    out.push(renderExtensionItems(items, ansi));
  }
  return out.join('');
}

/**
 * Render an aligned block of extension rows. {{kind}} and {{name}}
 * columns are padded to the longest in the block so everything lines
 * up. `glyph === null` means granularity=bundle (no per-extension
 * toggle); the row template skips the glyph column for symmetry.
 */
function renderExtensionItems(items: IExtensionListItem[], _ansi: IAnsi): string {
  if (items.length === 0) return '';
  const kindWidth = Math.max(...items.map((i) => i.kind.length));
  const nameWidth = Math.max(...items.map((i) => i.name.length));
  const out: string[] = [];
  for (const item of items) {
    const kind = item.kind.padEnd(kindWidth);
    const name = item.name.padEnd(nameWidth);
    if (item.glyph !== null) {
      out.push(
        tx(PLUGINS_TEXTS.detailExtensionRowGlyph, {
          glyph: item.glyph,
          kind,
          name,
          version: item.version,
        }),
      );
    } else {
      out.push(
        tx(PLUGINS_TEXTS.detailExtensionRowBare, {
          kind,
          name,
          version: item.version,
        }),
      );
    }
  }
  return out.join('');
}

// --- applicableKinds doctor warnings (Spec § A.10) -----------------------

/**
 * One unknown-kind warning. Produced when an Extractor declares
 * `applicableKinds` including a kind that no installed Provider (built-in
 * or user plugin) emits. The extractor itself stays `loaded` — the
 * Provider may arrive later — but `sm plugins doctor` surfaces the
 * mismatch so authors catch typos and missing-dependency cases early.
 */
interface IApplicableKindWarning {
  extractorQualifiedId: string;
  unknownKind: string;
}

/**
 * Pull the runtime instance an `ILoadedExtension` points at. The loader
 * stores the imported ESM namespace verbatim in `.module`; the
 * extension's runtime export lives at `module.default` (or, for a CJS
 * fallback, on the namespace itself). Returns `null` when the shape is
 * not recognisable — the caller treats that as "no applicableKinds to
 * inspect" and moves on.
 */
function extensionInstance(ext: ILoadedExtension): Record<string, unknown> | null {
  const mod = ext.module;
  if (mod === null || typeof mod !== 'object') return null;
  const candidate = (mod as { default?: unknown }).default ?? mod;
  if (candidate === null || typeof candidate !== 'object') return null;
  return candidate as Record<string, unknown>;
}

/**
 * Collect the set of `node.kind` values every installed Provider
 * (built-in + user plugin) declares it can emit. The truth source is
 * `IProvider.kinds` — every kind the Provider emits MUST appear there
 * per `architecture.md` §`Provider`. The union of those keys is the
 * kernel's "known kinds" surface for unknown-kind detection.
 *
 * Phase 3 (spec 0.8.0): the source-of-truth migrated from a flat
 * `defaultRefreshAction` map to the `kinds` map (which subsumes both
 * the per-kind schema and the refresh action). The set of keys is the
 * same — only the field name changed.
 */
function collectKnownKinds(plugins: IDiscoveredPlugin[]): Set<string> {
  const known = new Set<string>();
  forEachProviderInstance(plugins, ({ instance }) => {
    const map = instance['kinds'];
    if (map === null || typeof map !== 'object') return;
    for (const k of Object.keys(map)) known.add(k);
  });
  return known;
}

/**
 * Iterate every Provider instance reachable from this run — built-in
 * bundles first, then user plugins (enabled only). Centralises the
 * "if (ext.kind !== 'provider') continue; cast/extract instance"
 * guard so doctor-style helpers (collect known kinds, collect missing
 * exploration dirs, …) can stay focused on per-Provider logic.
 *
 * The `instance` field uses `Record<string, unknown>` so user-plugin
 * Providers (whose runtime shape is not type-checked) and built-in
 * Providers share the same callback signature.
 */
// Two parallel iteration sources (built-in bundles + user plugins),
// each with a kind/instance guard. Centralised here so doctor helpers
// stay focused on per-Provider logic.
// eslint-disable-next-line complexity
function forEachProviderInstance(
  plugins: IDiscoveredPlugin[],
  callback: (entry: { id: string; pluginId: string; instance: Record<string, unknown> }) => void,
): void {
  for (const bundle of builtInBundles) {
    for (const ext of bundle.extensions) {
      if (ext.kind !== 'provider') continue;
      const provider = ext as IProvider;
      callback({
        id: provider.id,
        pluginId: bundle.id,
        instance: provider as unknown as Record<string, unknown>,
      });
    }
  }
  for (const p of plugins) {
    if (p.status !== 'enabled' || !p.extensions) continue;
    for (const ext of p.extensions) {
      if (ext.kind !== 'provider') continue;
      const inst = extensionInstance(ext);
      if (!inst) continue;
      callback({ id: ext.id, pluginId: ext.pluginId, instance: inst });
    }
  }
}

/**
 * Walk every loaded Extractor (built-in + user plugin) and produce one
 * warning per unknown kind referenced via `applicableKinds`. An extractor
 * with no `applicableKinds` field is silent (default = applies to all
 * kinds). Iteration order is deterministic so the rendered doctor output
 * stays stable across runs.
 */
// Two parallel iteration sources (built-in extractors + user plugin
// extractors) with kind/applicableKinds guards. The shared inner loop
// is `appendUnknownKindWarnings`.
// eslint-disable-next-line complexity
function collectApplicableKindWarnings(
  plugins: IDiscoveredPlugin[],
  knownKinds: Set<string>,
): IApplicableKindWarning[] {
  const out: IApplicableKindWarning[] = [];

  // Built-in extractors (typed).
  for (const bundle of builtInBundles) {
    for (const ext of bundle.extensions) {
      if (ext.kind !== 'extractor') continue;
      const extractor = ext as IExtractor;
      if (!extractor.applicableKinds) continue;
      appendUnknownKindWarnings(
        out,
        qualifiedExtensionId(bundle.id, extractor.id),
        extractor.applicableKinds,
        knownKinds,
      );
    }
  }

  // User-plugin extractors (untyped — applicableKinds may be any value).
  for (const p of plugins) {
    if (p.status !== 'enabled' || !p.extensions) continue;
    for (const ext of p.extensions) {
      if (ext.kind !== 'extractor') continue;
      const inst = extensionInstance(ext);
      if (!inst) continue;
      const ak = inst['applicableKinds'];
      if (!Array.isArray(ak)) continue;
      appendUnknownKindWarnings(
        out,
        qualifiedExtensionId(ext.pluginId, ext.id),
        ak,
        knownKinds,
      );
    }
  }
  return out;
}

/**
 * Push one warning for every kind in `applicableKinds` that the
 * Provider catalog does not recognise. Tolerates `unknown[]` so the
 * user-plugin path (where the array shape is not type-checked) can
 * filter non-string entries silently.
 */
function appendUnknownKindWarnings(
  out: IApplicableKindWarning[],
  extractorQualifiedId: string,
  applicableKinds: readonly unknown[],
  knownKinds: Set<string>,
): void {
  for (const k of applicableKinds) {
    if (typeof k !== 'string') continue;
    if (!knownKinds.has(k)) out.push({ extractorQualifiedId, unknownKind: k });
  }
}

// --- explorationDir doctor warnings (Provider §) -------------------------

/**
 * One missing-explorationDir warning. Produced when a Provider declares an
 * `explorationDir` that does not exist on the filesystem after `~`
 * expansion. Non-blocking — the user may legitimately have not installed
 * that platform yet — so the warning is informational and does NOT promote
 * the exit code.
 */
interface IProviderExplorationDirWarning {
  providerQualifiedId: string;
  explorationDir: string;
  resolvedPath: string;
}

/**
 * Resolve `~` and `~user` prefixes against the supplied home dir.
 * Mirrors the canonical shell convention so the doctor's existence check
 * matches what the Provider's `walk()` would actually traverse at scan
 * time. Returns the input verbatim when no `~` prefix is present.
 */
function expandHome(p: string, homedir: string): string {
  if (p === '~') return homedir;
  if (p.startsWith('~/')) return join(homedir, p.slice(2));
  return p;
}

/**
 * Walk every loaded Provider (built-in + user plugin) and emit one warning
 * per declared `explorationDir` that does not exist on disk. The lookup
 * resolves `~` against the supplied home dir; relative paths fall back
 * to the cwd.
 */
function collectExplorationDirWarnings(
  plugins: IDiscoveredPlugin[],
  homedir: string,
): IProviderExplorationDirWarning[] {
  const out: IProviderExplorationDirWarning[] = [];
  forEachProviderInstance(plugins, ({ id, pluginId, instance }) => {
    const dir = instance['explorationDir'];
    if (typeof dir !== 'string' || dir.length === 0) return;
    const resolved = expandHome(dir, homedir);
    if (!existsSync(resolved)) {
      out.push({
        providerQualifiedId: qualifiedExtensionId(pluginId, id),
        explorationDir: dir,
        resolvedPath: resolved,
      });
    }
  });
  return out;
}

// --- doctor ---------------------------------------------------------------

export class PluginsDoctorCommand extends SmCommand {
  static override paths = [['plugins', 'doctor']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Run the full load pass and summarise by failure mode.',
    details: 'Exit code 0 when every plugin loads or is intentionally disabled; 1 when any plugin is in an error / incompat state.',
  });

  pluginDir = Option.String('--plugin-dir', { required: false });

  // Doctor verb: counts by status + applicableKinds warnings +
  // explorationDir warnings + bad-plugins issues, each with its own
  // gated render. Branching is intrinsic to the multi-section diagnostic
  // output; the per-section helpers (`collectKnownKinds`,
  // `collectApplicableKindWarnings`, `collectExplorationDirWarnings`)
  // already encapsulate the data gathering.
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    const plugins = await loadAll({ global: this.global, pluginDir: this.pluginDir });
    const resolveEnabled = await buildResolver(this.global);
    const builtIns = builtInRows(resolveEnabled);
    const counts: Record<IDiscoveredPlugin['status'], number> = {
      enabled: 0,
      disabled: 0,
      'incompatible-spec': 0,
      'incompatible-catalog': 0,
      'invalid-manifest': 0,
      'load-error': 0,
      'id-collision': 0,
    };
    // Explicit ordering for the doctor table so the user-facing output
    // does not depend on JS object insertion order. Mirrors the
    // initialiser above; keep both lists aligned when adding a status.
    const STATUS_ORDER: ReadonlyArray<IDiscoveredPlugin['status']> = [
      'enabled',
      'disabled',
      'incompatible-spec',
      'incompatible-catalog',
      'invalid-manifest',
      'load-error',
      'id-collision',
    ];
    // Built-ins contribute to enabled / disabled counts so the doctor
    // summary reflects the full surface, not just user plugins.
    for (const b of builtIns) {
      if (b.granularity === 'bundle') {
        counts[b.enabled ? 'enabled' : 'disabled']++;
      } else {
        for (const ext of b.extensions) {
          counts[ext.enabled ? 'enabled' : 'disabled']++;
        }
      }
    }
    for (const p of plugins) counts[p.status]++;

    // Spec § A.10 — applicableKinds: surface unknown-kind warnings as
    // informational diagnostics. They do NOT promote the exit code (the
    // Provider that declares the kind may legitimately arrive later);
    // they only tell the author "your extractor will never fire on the
    // kind you typed".
    const knownKinds = collectKnownKinds(plugins);
    const applicableKindWarnings = collectApplicableKindWarnings(plugins, knownKinds);
    // Provider explorationDir validation. Non-blocking — the user may not
    // have installed that platform yet, so missing dir is informational.
    const explorationDirWarnings = collectExplorationDirWarnings(plugins, defaultRuntimeContext().homedir);

    // Errors gate the exit code; `disabled` is intentional and never an issue.
    const bad = plugins.filter(
      (p) => p.status !== 'enabled' && p.status !== 'disabled',
    );

    const stdout = this.context.stdout as NodeJS.WriteStream;
    const ansi = ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: this.noColor });
    const totalWarnings = applicableKindWarnings.length + explorationDirWarnings.length;

    // Summary header — single dense line that the user reads first.
    this.printer!.data(
      tx(PLUGINS_TEXTS.doctorSummary, {
        enabled: counts.enabled,
        issues: bad.length,
        issuesPlural: bad.length === 1 ? '' : 's',
        warnings: totalWarnings,
        warningsPlural: totalWarnings === 1 ? '' : 's',
      }),
    );

    // Source breakdown — built-in vs user.
    const sourceLabelWidth = Math.max(
      PLUGINS_TEXTS.sourceBuiltIn.length,
      PLUGINS_TEXTS.sourceUser.length,
    );
    this.printer!.data(PLUGINS_TEXTS.doctorSourceHeader);
    this.printer!.data(
      tx(PLUGINS_TEXTS.doctorSourceRow, {
        label: PLUGINS_TEXTS.sourceBuiltIn.padEnd(sourceLabelWidth),
        count: builtIns.length,
      }),
    );
    this.printer!.data(
      tx(PLUGINS_TEXTS.doctorSourceRow, {
        label: PLUGINS_TEXTS.sourceUser.padEnd(sourceLabelWidth),
        count: plugins.length,
      }),
    );

    // Status breakdown — same statuses as before, just framed and aligned.
    const statusLabelWidth = Math.max(...STATUS_ORDER.map((s) => s.length));
    this.printer!.data(PLUGINS_TEXTS.doctorStatusHeader);
    for (const status of STATUS_ORDER) {
      const count = counts[status];
      const isProblem = status !== 'enabled' && status !== 'disabled' && count > 0;
      const label = status.padEnd(statusLabelWidth);
      const formattedCount = isProblem ? ansi.red(String(count)) : String(count);
      this.printer!.data(
        tx(PLUGINS_TEXTS.doctorStatusRow, {
          label: isProblem ? ansi.red(label) : label,
          count: formattedCount,
        }),
      );
    }

    if (totalWarnings > 0) {
      this.printer!.data(
        tx(PLUGINS_TEXTS.doctorWarningsHeader, { count: totalWarnings }),
      );
      const warnGlyph = ansi.yellow('⚠');
      for (const w of applicableKindWarnings) {
        const id = sanitizeForTerminal(w.extractorQualifiedId);
        const message = tx(PLUGINS_TEXTS.doctorApplicableKindUnknown, {
          unknownKind: sanitizeForTerminal(w.unknownKind),
        });
        this.printer!.data(
          tx(PLUGINS_TEXTS.doctorWarningEntry, { glyph: warnGlyph, id }),
        );
        for (const line of wrapText(message, 64)) {
          this.printer!.data(
            tx(PLUGINS_TEXTS.doctorWarningBody, { line: ansi.dim(line) }),
          );
        }
      }
      for (const w of explorationDirWarnings) {
        const id = sanitizeForTerminal(w.providerQualifiedId);
        const message = tx(PLUGINS_TEXTS.doctorProviderExplorationDirMissing, {
          explorationDir: sanitizeForTerminal(w.explorationDir),
          resolvedPath: sanitizeForTerminal(w.resolvedPath),
        });
        this.printer!.data(
          tx(PLUGINS_TEXTS.doctorWarningEntry, { glyph: warnGlyph, id }),
        );
        for (const line of wrapText(message, 64)) {
          this.printer!.data(
            tx(PLUGINS_TEXTS.doctorWarningBody, { line: ansi.dim(line) }),
          );
        }
      }
    }

    if (bad.length > 0) {
      this.printer!.data(
        tx(PLUGINS_TEXTS.doctorIssuesHeader, { count: bad.length }),
      );
      const issueGlyph = ansi.red(PLUGINS_TEXTS.rowGlyphOff);
      for (const p of bad) {
        const id = sanitizeForTerminal(p.id);
        const reason = sanitizeForTerminal(p.reason ?? '');
        this.printer!.data(
          tx(PLUGINS_TEXTS.doctorIssueEntry, {
            glyph: issueGlyph,
            id,
            status: ansi.red(p.status),
          }),
        );
        if (reason) {
          for (const line of wrapText(reason, 64)) {
            this.printer!.data(
              tx(PLUGINS_TEXTS.doctorIssueBody, { line: ansi.dim(line) }),
            );
          }
        }
      }
      return ExitCode.Issues;
    }
    return ExitCode.Ok;
  }
}

// --- enable / disable -----------------------------------------------------

interface IBundleSlim {
  id: string;
  granularity: TGranularity;
  extensionIds: string[];
}

/**
 * Build the canonical bundle catalogue: built-ins first, then any
 * loaded user plugins. Used by the toggle verbs to validate `<id>`
 * against the granularity declared on the owning bundle.
 *
 * Plugins whose manifest never validated (`invalid-manifest` /
 * `load-error` without a manifest) are still listed so the user can
 * disable a buggy plugin to silence its load error — but their
 * `granularity` falls back to `'bundle'` (the safe default that the
 * loader would inject if the manifest were repaired).
 */
function bundleCatalogue(plugins: IDiscoveredPlugin[]): IBundleSlim[] {
  const out: IBundleSlim[] = [];
  for (const bundle of builtInBundles) {
    out.push({
      id: bundle.id,
      granularity: bundle.granularity,
      extensionIds: bundle.extensions.map((e) => e.id),
    });
  }
  for (const p of plugins) {
    out.push({
      id: p.id,
      granularity: p.granularity ?? 'bundle',
      extensionIds: p.extensions?.map((e) => e.id) ?? [],
    });
  }
  return out;
}

interface IResolvedTarget {
  /**
   * The key written to `config_plugins.plugin_id`. For bundle granularity
   * this is the bundle id; for extension granularity it's the qualified
   * id `<bundle>/<ext>`.
   */
  key: string;
}

/**
 * Resolve a user-supplied `<id>` (either a plugin id or a qualified
 * extension id) against the catalogue. Returns either a usable
 * `key` to persist, or a directed error message that explains why the
 * id was rejected (granularity mismatch, unknown bundle, unknown
 * extension under a known bundle).
 */
// User-supplied `id` is interpolated into stderr error messages; lookup
// against the catalogue stays on the raw value (so a malformed input
// fails to resolve), but every interpolation goes through
// `sanitizeForTerminal` so a planted ANSI escape can't reach the
// terminal.
// eslint-disable-next-line complexity
function resolveToggleTarget(
  id: string,
  catalogue: IBundleSlim[],
  verb: 'enable' | 'disable',
  ansi: IAnsi,
): IResolvedTarget | { error: string } {
  const errGlyph = ansi.red('✕');
  if (id.includes('/')) {
    const [bundleId, extId, ...rest] = id.split('/');
    if (!bundleId || !extId || rest.length > 0) {
      return {
        error: tx(PLUGINS_TEXTS.qualifiedIdUnknownBundle, {
          glyph: errGlyph,
          bundleId: sanitizeForTerminal(id),
          hint: ansi.dim(PLUGINS_TEXTS.qualifiedIdUnknownBundleHint),
        }),
      };
    }
    const bundle = catalogue.find((b) => b.id === bundleId);
    if (!bundle) {
      return {
        error: tx(PLUGINS_TEXTS.qualifiedIdUnknownBundle, {
          glyph: errGlyph,
          bundleId: sanitizeForTerminal(bundleId),
          hint: ansi.dim(PLUGINS_TEXTS.qualifiedIdUnknownBundleHint),
        }),
      };
    }
    if (bundle.granularity === 'bundle') {
      return {
        error: tx(PLUGINS_TEXTS.granularityBundleRejectsQualified, {
          glyph: errGlyph,
          bundleId: sanitizeForTerminal(bundleId),
          extId: sanitizeForTerminal(extId),
          verb,
          hint: ansi.dim(PLUGINS_TEXTS.granularityBundleRejectsQualifiedHint),
        }),
      };
    }
    if (!bundle.extensionIds.includes(extId)) {
      return {
        error: tx(PLUGINS_TEXTS.qualifiedIdNotFound, {
          glyph: errGlyph,
          id: sanitizeForTerminal(id),
          bundleId: sanitizeForTerminal(bundleId),
          extId: sanitizeForTerminal(extId),
          hint: ansi.dim(PLUGINS_TEXTS.qualifiedIdNotFoundHint),
        }),
      };
    }
    return { key: qualifiedExtensionId(bundleId, extId) };
  }

  const bundle = catalogue.find((b) => b.id === id);
  if (!bundle) {
    return {
      error: tx(PLUGINS_TEXTS.pluginNotFound, {
        glyph: errGlyph,
        id: sanitizeForTerminal(id),
        hint: ansi.dim(PLUGINS_TEXTS.pluginNotFoundHint),
      }),
    };
  }
  if (bundle.granularity === 'extension') {
    return {
      error: tx(PLUGINS_TEXTS.granularityExtensionRejectsBundleId, {
        glyph: errGlyph,
        bundleId: sanitizeForTerminal(id),
        verb,
        hint: ansi.dim(PLUGINS_TEXTS.granularityExtensionRejectsBundleIdHint),
      }),
    };
  }
  return { key: bundle.id };
}

abstract class TogglePluginsBase extends SmCommand {
  all = Option.Boolean('--all', false);
  id = Option.String({ required: false });

  // eslint-disable-next-line complexity
  protected async toggle(enabled: boolean): Promise<number> {
    const verb = enabled ? 'enable' : 'disable';
    const stderr = this.context.stderr as NodeJS.WriteStream;
    const stderrAnsi = ansiFor({ isTTY: stderr.isTTY === true, noColorFlag: this.noColor });
    const errGlyph = stderrAnsi.red('✕');
    if (this.all && this.id) {
      this.printer!.error(tx(PLUGINS_TEXTS.toggleBothIdAndAll, { glyph: errGlyph }));
      return ExitCode.Error;
    }
    if (!this.all && !this.id) {
      this.printer!.error(tx(PLUGINS_TEXTS.toggleNeitherIdNorAll, { glyph: errGlyph }));
      return ExitCode.Error;
    }

    // Resolve discovery so `<id>` is validated and `--all` knows the set.
    const plugins = await loadAll({
      global: this.global,
      pluginDir: undefined,
    });
    const catalogue = bundleCatalogue(plugins);

    let targets: string[];
    if (this.all) {
      // `--all` is a macro on bundle ids: every plugin / bundle the user
      // can see. We deliberately do NOT expand to qualified
      // <bundle>/<ext> keys — that would silently flip a granularity
      // policy. For granularity=extension bundles the user already
      // hits the directed error message ("use bundle/<ext>") if they
      // try the bundle id directly, so `--all` skips them here too
      // and the real "disable every core extension" intent is served
      // by `--no-built-ins` on `sm scan`.
      targets = catalogue
        .filter((b) => b.granularity === 'bundle')
        .map((b) => b.id);
    } else {
      const stderr = this.context.stderr as NodeJS.WriteStream;
      const ansi = ansiFor({ isTTY: stderr.isTTY === true, noColorFlag: this.noColor });
      const resolved = resolveToggleTarget(this.id!, catalogue, verb, ansi);
      if ('error' in resolved) {
        this.printer!.error(tx(PLUGINS_TEXTS.toggleResolveError, { error: resolved.error }));
        // Granularity errors and unknown ids are both user input
        // problems — exit 5 (NotFound) keeps the existing contract
        // for "you asked me to act on something I cannot resolve".
        return ExitCode.NotFound;
      }
      targets = [resolved.key];
    }

    // Host lock — see `src/kernel/config/locked-plugins.ts`. Rejected
    // here so the user gets a directed exit-5 message instead of a
    // silent write that the resolver would later override anyway.
    // `--all` is forgiving: it skips locked targets so the user can
    // still toggle the rest, mirroring how it already skips
    // granularity=extension bundles.
    if (this.all) {
      targets = targets.filter((id) => !isPluginLocked(id));
    } else {
      const lockedHit = targets.find((id) => isPluginLocked(id));
      if (lockedHit) {
        this.printer!.error(
          tx(PLUGINS_TEXTS.pluginLocked, {
            glyph: errGlyph,
            id: sanitizeForTerminal(lockedHit),
            hint: stderrAnsi.dim(PLUGINS_TEXTS.pluginLockedHint),
          }),
        );
        return ExitCode.NotFound;
      }
    }

    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ global: this.global, db: undefined, cwd: ctx.cwd, homedir: ctx.homedir });
    await withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      for (const id of targets) {
        await adapter.pluginConfig.set(id, enabled);
      }
    });

    const verbPast = enabled ? 'enabled' : 'disabled';
    if (targets.length === 1) {
      this.printer!.data(tx(PLUGINS_TEXTS.toggleAppliedSingle, { verbPast, id: targets[0]! }));
    } else {
      this.printer!.data(
        tx(PLUGINS_TEXTS.toggleAppliedManyHeader, { verbPast, count: targets.length }),
      );
      for (const id of targets) {
        this.printer!.data(tx(PLUGINS_TEXTS.toggleAppliedManyRow, { id }));
      }
    }
    return ExitCode.Ok;
  }
}

export class PluginsEnableCommand extends TogglePluginsBase {
  static override paths = [['plugins', 'enable']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Enable a plugin (or --all). Persists in config_plugins.',
    details: `
      Writes a row to config_plugins with enabled=1. Takes precedence
      over the team-shared baseline at settings.json#/plugins/<id>/enabled.
      Use sm plugins disable to flip; sm config reset plugins.<id>.enabled
      drops the settings.json baseline.

      Granularity: a bundle-granularity plugin (default for user plugins,
      and the built-in 'claude' bundle) accepts only the bundle id. An
      extension-granularity plugin (the built-in 'core' bundle) accepts
      only qualified ids '<bundle>/<ext-id>'. Mismatches are rejected
      with directed guidance.
    `,
  });

  protected async run(): Promise<number> {
    return this.toggle(true);
  }
}

export class PluginsDisableCommand extends TogglePluginsBase {
  static override paths = [['plugins', 'disable']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Disable a plugin (or --all). Persists in config_plugins; does not delete files.',
    details: `
      Writes a row to config_plugins with enabled=0. Discovery still
      surfaces the plugin in sm plugins list, but with status=disabled
      — its extensions are not imported and the kernel will not run
      them.

      Granularity: a bundle-granularity plugin (default for user plugins,
      and the built-in 'claude' bundle) accepts only the bundle id. An
      extension-granularity plugin (the built-in 'core' bundle) accepts
      only qualified ids '<bundle>/<ext-id>'. Mismatches are rejected
      with directed guidance.
    `,
  });

  protected async run(): Promise<number> {
    return this.toggle(false);
  }
}

/* `port.pluginConfig.delete` is on the StoragePort surface, kept
 * available for `sm config reset` once that verb lands. */

/**
 * JSON-serializer replacer: the ILoadedExtension.module field is a live
 * ESM namespace with circular references — omit it from output.
 *
 * We identify the namespace by its `[Symbol.toStringTag] === 'Module'`
 * marker (the standard tag Node sets on ESM module records), so a
 * plugin manifest that legitimately ships an unrelated `module` key
 * (e.g. a string property in `metadata`) is preserved. The earlier
 * implementation dropped EVERY `module` key in the tree, which silently
 * lost data on first sight.
 */
function omitModule(key: string, value: unknown): unknown {
  if (key !== 'module') return value;
  if (value === null || typeof value !== 'object') return value;
  const tag = (value as { [Symbol.toStringTag]?: unknown })[Symbol.toStringTag];
  return tag === 'Module' ? undefined : value;
}

// --- Phase 5 / view contribution system verbs ----------------------------

import { mkdirSync, writeFileSync } from 'node:fs';

const VIEW_CONTRACTS_CATALOG = [
  { id: 'node-counter', summary: 'Single integer per node — chip + header badge.' },
  { id: 'node-tag', summary: 'Single qualitative tag per node — chip + header badge.' },
  { id: 'node-breakdown', summary: 'Top-N labeled values per node — inspector chart.' },
  { id: 'node-records', summary: 'Tabular data per node — inspector table.' },
  { id: 'node-tree', summary: 'Hierarchy per node — inspector tree.' },
  { id: 'node-key-values', summary: 'Flat key/value record per node — inspector list.' },
  { id: 'node-link-list', summary: 'List of node paths per node — inspector clickable list.' },
  { id: 'node-markdown', summary: 'Sanitized markdown text per node — inspector body.' },
  { id: 'node-alert', summary: 'Decoration on graph node — corner badge.' },
  { id: 'node-icon', summary: 'Single icon next to the card title — small marker.' },
  { id: 'scope-stat', summary: 'Single value across the whole scope — topbar indicator.' },
] as const;

const INPUT_TYPES_CATALOG = [
  { id: 'string-list', summary: 'Array of free-form strings.' },
  { id: 'single-string', summary: 'Single text input.' },
  { id: 'boolean-flag', summary: 'On/off toggle.' },
  { id: 'integer', summary: 'Integer with optional bounds.' },
  { id: 'enum-pick', summary: 'Pick one from a closed set.' },
  { id: 'enum-multipick', summary: 'Pick zero or more from a closed set.' },
  { id: 'path-glob', summary: 'Glob pattern (single or multiple).' },
  { id: 'regex', summary: 'ECMAScript regex pattern body.' },
  { id: 'secret', summary: 'Sensitive string (encrypted at rest).' },
  { id: 'key-value-list', summary: 'Editable mapping of strings to strings.' },
] as const;

/**
 * `sm plugins create <plugin-id>` — scaffold a new plugin directory.
 *
 * Non-interactive Phase 5 minimum: emit a complete `plugin.json` with
 * a placeholder extractor that declares one view contribution
 * (`node-counter`) and one setting (`string-list`), plus a stub
 * `extensions/extractor.js` and a `README.md`. The author edits to
 * taste. A future iteration adds an interactive prompter walking
 * the closed catalogs (Inquirer-style); the file structure stays
 * stable so the upgrade path is additive.
 *
 * Lands the plugin under `<scope>/.skill-map/plugins/<plugin-id>/`
 * (per `AGENTS.md` line 41 — "Plugins are scaffolded, not
 * hand-written" — the canonical drop-in location). Use `--at <path>`
 * to override.
 */
export class PluginsCreateCommand extends SmCommand {
  static override paths = [['plugins', 'create']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Scaffold a new plugin directory.',
    details:
      'Emits plugin.json + extension stub + README. Pre-filled with one view contribution (node-counter) and one setting (string-list); edit to taste. Use `sm plugins contracts list` to see other options.',
  });

  pluginId = Option.String({ required: true, name: 'plugin-id' });
  at = Option.String('--at', { required: false });
  force = Option.Boolean('--force', false);

  protected async run(): Promise<number> {
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(this.pluginId)) {
      this.printer!.error(
        `Plugin id must be kebab-case lowercase (got: ${sanitizeForTerminal(this.pluginId)})\n`,
      );
      return ExitCode.Error;
    }
    const targetDir = this.at
      ? resolve(this.at)
      : resolve(process.cwd(), '.skill-map', 'plugins', this.pluginId);
    if (existsSync(targetDir) && !this.force) {
      this.printer!.error(
        `Refusing to overwrite ${sanitizeForTerminal(targetDir)}. Pass --force to overwrite.\n`,
      );
      return ExitCode.Error;
    }
    mkdirSync(join(targetDir, 'extensions'), { recursive: true });

    const specVersion = installedSpecVersion();
    const manifest = {
      id: this.pluginId,
      version: '0.1.0',
      specCompat: `^${specVersion}`,
      catalogCompat: '^1.0.0',
      extensions: ['./extensions/extractor.js'],
      description: 'Generated by `sm plugins create`. Edit to taste.',
      settings: {
        keywords: {
          type: 'string-list',
          label: 'Keywords to track',
          description: 'Words counted across each scanned node body.',
          default: ['TODO', 'FIXME'],
          min: 1,
        },
      },
    };
    writeFileSync(
      join(targetDir, 'plugin.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );

    const extractorStub = scaffolderExtractorStub(this.pluginId);
    writeFileSync(join(targetDir, 'extensions', 'extractor.js'), extractorStub);

    const readme = scaffolderReadme(this.pluginId);
    writeFileSync(join(targetDir, 'README.md'), readme);

    this.printer!.data(
      `Created ${sanitizeForTerminal(targetDir)}\n` +
        `Next:\n` +
        `  - Edit ${this.pluginId}/extensions/extractor.js (the extract() body)\n` +
        `  - Run sm scan to see the contribution surface\n` +
        `  - sm plugins contracts list — browse other contracts\n`,
    );
    return ExitCode.Ok;
  }
}

function scaffolderExtractorStub(pluginId: string): string {
  return `/**
 * Generated by \`sm plugins create\`. Edit the extract() body.
 *
 * Loader contract: the plugin loader resolves the extension via the
 * MODULE'S DEFAULT EXPORT (\`export default { ... }\`). Renaming or
 * splitting into a named export will surface as \`load-error: default
 * export missing a string \\\`kind\\\` field\`.
 *
 * Declared view contributions (in plugin.json):
 *   - 'count' → node-counter (renders as a chip on cards + inspector header)
 *
 * Declared settings:
 *   - 'keywords' (string-list) → exposed as ctx.settings.keywords
 *
 * See: spec/plugin-author-guide.md §View contributions
 *      spec/view-contracts.md
 */
export default {
  id: '${pluginId}-extractor',
  pluginId: '${pluginId}',
  kind: 'extractor',
  version: '0.1.0',
  description: 'Counts configured keywords per node.',
  stability: 'experimental',
  mode: 'deterministic',
  emitsLinkKinds: [],
  defaultConfidence: 'high',
  scope: 'body',

  viewContributions: {
    count: {
      contract: 'node-counter',
      icon: '🔍',
      label: 'kw',
      emitWhenEmpty: false,
    },
  },

  extract(ctx) {
    const keywords = (ctx.settings && ctx.settings.keywords) || ['TODO', 'FIXME'];
    let total = 0;
    for (const kw of keywords) {
      const re = new RegExp('\\\\b' + kw.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '\\\\b', 'gi');
      total += (ctx.body.match(re) || []).length;
    }
    if (total > 0) {
      ctx.emitContribution('count', { value: total });
    }
  },
};
`;
}

function scaffolderReadme(pluginId: string): string {
  return `# ${pluginId}

Generated by \`sm plugins create\`. Edit \`extensions/extractor.js\` to taste.

## Verbs

- \`sm plugins show ${pluginId}\` — manifest + load status
- \`sm plugins doctor\` — full plugin diagnostic
- \`sm scan\` — re-emit contributions

## Resources

- \`spec/plugin-author-guide.md\` §View contributions
- \`spec/view-contracts.md\` — the closed catalog of contracts
- \`spec/input-types.md\` — the closed catalog of input-types for settings
- \`sm plugins contracts list\` — browse the catalog from the CLI
`;
}

/**
 * `sm plugins contracts list` — print the closed catalogs of view
 * contracts + input-types. Read-only browser the user invokes when
 * scaffolding a plugin manually or evaluating which contract fits a
 * use case.
 */
export class PluginsContractsListCommand extends SmCommand {
  static override paths = [['plugins', 'contracts', 'list']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Print the closed catalogs of view contracts and input-types.',
    details: 'Read-only. Use this when picking a contract / input-type for a new plugin.',
  });

  protected async run(): Promise<number> {
    if (this.json) {
      this.printer!.data(
        JSON.stringify(
          { viewContracts: VIEW_CONTRACTS_CATALOG, inputTypes: INPUT_TYPES_CATALOG },
          null,
          2,
        ) + '\n',
      );
      return ExitCode.Ok;
    }
    const stdout = this.context.stdout as NodeJS.WriteStream;
    const ansi = ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: this.noColor });
    const idWidth = Math.max(
      ...VIEW_CONTRACTS_CATALOG.map((c) => c.id.length),
      ...INPUT_TYPES_CATALOG.map((t) => t.id.length),
    );
    this.printer!.data(`  View contracts (${VIEW_CONTRACTS_CATALOG.length})\n`);
    for (const c of VIEW_CONTRACTS_CATALOG) {
      this.printer!.data(
        `    ${c.id.padEnd(idWidth)}  ${ansi.dim(c.summary)}\n`,
      );
    }
    this.printer!.data(`\n  Input types (${INPUT_TYPES_CATALOG.length})\n`);
    for (const t of INPUT_TYPES_CATALOG) {
      this.printer!.data(
        `    ${t.id.padEnd(idWidth)}  ${ansi.dim(t.summary)}\n`,
      );
    }
    this.printer!.data(
      `\n${ansi.dim('Tip: full spec at spec/view-contracts.md and spec/input-types.md.')}\n`,
    );
    return ExitCode.Ok;
  }
}

/**
 * `sm plugins upgrade [<plugin-id>]` — apply registered catalog
 * migrations to one (or every) plugin manifest. Empty migration
 * registry today (Phase 5 / catalog v1.0.0); the verb structure
 * exists so future renames / deprecations land without spec churn.
 */
export class PluginsUpgradeCommand extends SmCommand {
  static override paths = [['plugins', 'upgrade']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Apply catalog migrations to plugin manifests.',
    details:
      'No migrations registered against catalog v1.0.0 yet — this verb is a no-op today. The structure exists so future contract renames / deprecations land without spec churn.',
  });

  pluginId = Option.String({ required: false, name: 'plugin-id' });

  protected async run(): Promise<number> {
    this.printer!.data(
      'sm plugins upgrade — no migrations registered for catalog v1.0.0.\n' +
        '  All loaded plugins are catalog-current.\n' +
        '  Run `sm plugins doctor` to surface any incompatible-catalog status.\n',
    );
    return ExitCode.Ok;
  }
}

export const PLUGIN_COMMANDS = [
  PluginsListCommand,
  PluginsShowCommand,
  PluginsDoctorCommand,
  PluginsEnableCommand,
  PluginsDisableCommand,
  PluginsCreateCommand,
  PluginsContractsListCommand,
  PluginsUpgradeCommand,
];
