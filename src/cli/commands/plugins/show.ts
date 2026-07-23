/**
 * `sm plugins show <plugin>/<ext>`, render one extension's detail.
 *
 * `show` is extension-only: it accepts a qualified `<plugin>/<ext>` id
 * and renders a single-extension detail block (header + Kind / Version /
 * Stability / Description / Preconditions / Entry). A bare plugin id is
 * the wrong granularity and is rejected with a redirect to
 * `sm plugins list <id>`, which renders the whole plugin and its
 * extensions.
 *
 * The qualified id shape is the same one `sm plugins enable|disable`
 * accept; validation is shared via `parseQualifiedExtensionId`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { Command, Option } from 'clipanion';

import { builtInPlugins } from '../../../plugins/built-ins.js';
import type {
  IDiscoveredPlugin,
  ILoadedExtension,
} from '../../../kernel/types/plugin.js';
import { sanitizeForTerminal } from '../../../kernel/util/safe-text.js';
import { tx } from '../../../kernel/util/tx.js';
import { PLUGINS_TEXTS } from '../../i18n/plugins.texts.js';
import type { IAnsi } from '../../util/ansi.js';
import { ExitCode } from '../../util/exit-codes.js';
import { SmCommand } from '../../util/sm-command.js';
import {
  builtInRows,
  buildResolver,
  loadAll,
  omitModule,
  parseQualifiedExtensionId,
  pluginCatalogue,
  renderQualifiedIdError,
  type IBuiltInPluginRow,
} from './shared.js';

export class PluginsShowCommand extends SmCommand {
  static override paths = [['plugins', 'show']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Show a single extension\'s detail.',
    details: `
      Accepts a qualified extension id (\`core/<ext-id>\`,
      \`<plugin>/<ext-id>\`) and renders a single-extension detail block
      (Kind / Version / Stability / Description / Preconditions / Entry).
      A bare plugin id is rejected with a redirect to
      \`sm plugins list <id>\`, which renders the whole plugin. The same
      qualified id shape \`sm plugins enable\` and \`sm plugins disable\`
      accept resolves cleanly here too.
    `,
  });

  id = Option.String({ required: true });
  pluginDir = Option.String('--plugin-dir', { required: false });

  protected async run(): Promise<number> {
    const plugins = await loadAll({ pluginDir: this.pluginDir });
    const resolveEnabled = await buildResolver();
    const builtIns = builtInRows(resolveEnabled);
    const stderrAnsi = this.ansiFor('stderr');

    // `show` renders one extension. A bare plugin id is the wrong
    // granularity, redirect to `sm plugins list <id>` (the whole-plugin
    // view). The id shape alone decides; this holds whether or not the
    // plugin exists.
    if (!this.id.includes('/')) {
      this.printer!.error(
        tx(PLUGINS_TEXTS.showBareId, {
          glyph: stderrAnsi.red(PLUGINS_TEXTS.rowGlyphOff),
          id: sanitizeForTerminal(this.id),
          hint: stderrAnsi.dim(
            tx(PLUGINS_TEXTS.showBareIdHint, { id: sanitizeForTerminal(this.id) }),
          ),
        }),
      );
      return ExitCode.Error;
    }

    // Validate the qualified id against the catalogue (built-ins + user
    // plugins), same parser `enable` / `disable` use.
    const parsed = parseQualifiedExtensionId(this.id, pluginCatalogue(plugins));
    if (!parsed.ok) {
      this.printer!.error(renderQualifiedIdError(parsed, this.id, stderrAnsi));
      return ExitCode.NotFound;
    }
    const { pluginId, extId } = parsed;

    const builtIn = builtIns.find((b) => b.id === pluginId);
    const match = plugins.find((p) => p.id === pluginId);
    return this.renderExtensionDetail({ extId, pluginId, builtIn, match });
  }

  /**
   * Render the single-extension detail block. `--json` emits the single
   * extension row (no surrounding plugin envelope) so tooling can pipe
   * straight into `jq`; human mode renders a focused header plus a
   * Kind / Version / Stability / Description / Preconditions / Entry
   * field block.
   */
  private renderExtensionDetail(args: {
    extId: string;
    pluginId: string;
    builtIn: IBuiltInPluginRow | undefined;
    match: IDiscoveredPlugin | undefined;
  }): number {
    const { extId, pluginId, builtIn, match } = args;
    if (builtIn) return this.renderBuiltInDetail(pluginId, extId, builtIn);
    return this.renderUserDetail(pluginId, extId, match);
  }

  /** Built-in half of the detail render (contract from the live manifest). */
  private renderBuiltInDetail(
    pluginId: string,
    extId: string,
    builtIn: IBuiltInPluginRow,
  ): number {
    const ext = builtIn.extensions.find((e) => e.id === extId);
    if (!ext) return ExitCode.NotFound; // parseQualifiedExtensionId already validated; defensive.
    const contract = builtInContract(pluginId, extId);
    if (this.json) {
      // The contract fields ride RAW on the machine surface (the JSON
      // consumer round-trips them; sanitization is a render concern).
      this.printer!.data(
        JSON.stringify({ pluginId, ...ext, ...(contract ?? {}) }, omitModule, 2) + '\n',
      );
      return ExitCode.Ok;
    }
    this.printer!.data(
      renderBuiltInExtensionDetail(pluginId, ext, this.ansiFor('stdout')) +
        renderContractSections(contract),
    );
    return ExitCode.Ok;
  }

  /** User-plugin half of the detail render (contract resolved from disk). */
  private renderUserDetail(
    pluginId: string,
    extId: string,
    match: IDiscoveredPlugin | undefined,
  ): number {
    const userExt = match?.extensions?.find((e) => e.id === extId);
    if (!userExt) return ExitCode.NotFound;
    const contract = userContract(userExt);
    if (this.json) {
      this.printer!.data(
        JSON.stringify({ ...userExt, ...(contract ?? {}) }, omitModule, 2) + '\n',
      );
      return ExitCode.Ok;
    }
    this.printer!.data(
      renderUserExtensionDetail(pluginId, userExt, this.ansiFor('stdout')) +
        renderContractSections(contract),
    );
    return ExitCode.Ok;
  }
}

// --- probabilistic contract sections (Prompt / Report schema) --------------

/**
 * The two contract files a PROBABILISTIC extension (Action or finder
 * Analyzer) carries by convention, surfaced by `sm plugins show` so the
 * operator can inspect what a queued job will embed BEFORE submitting
 * (`spec/cli-contract.md`, the `sm plugins show` row; the post-render
 * counterpart is `sm jobs preview`). `null` for deterministic extensions,
 * whose output stays byte-identical to the pre-feature shape.
 */
interface IProbabilisticContract {
  promptTemplate: string;
  reportSchema: Record<string, unknown>;
}

/**
 * Contract of a built-in extension: the codegen-inlined `promptTemplate`
 * / `reportSchema` on the live manifest (`plugins/built-ins.ts`). The
 * synthesised row projection (`IBuiltInPluginRow`) deliberately omits
 * them (list surfaces stay lean), so the live instance is consulted here.
 */
function builtInContract(pluginId: string, extId: string): IProbabilisticContract | null {
  const live = builtInPlugins
    .find((p) => p.id === pluginId)
    ?.extensions.find((e) => e.id === extId);
  if (!live) return null;
  const manifest = live as {
    mode?: string;
    promptTemplate?: string;
    reportSchema?: Record<string, unknown>;
  };
  if (manifest.mode !== 'probabilistic') return null;
  if (typeof manifest.promptTemplate !== 'string') return null;
  if (manifest.reportSchema === undefined || typeof manifest.reportSchema !== 'object') return null;
  return { promptTemplate: manifest.promptTemplate, reportSchema: manifest.reportSchema };
}

/**
 * Contract of a user-plugin extension: resolved from disk next to the
 * entry file (`prompt.md` / `report.schema.json`, the structure-as-truth
 * convention the loader already validated at discovery). A read failure
 * (deleted between load and render) degrades to the base detail rather
 * than crashing the verb.
 */
function userContract(ext: ILoadedExtension): IProbabilisticContract | null {
  const instance = ext.instance as Record<string, unknown> | undefined;
  if (!instance || instance['mode'] !== 'probabilistic') return null;
  const dir = dirname(ext.entryPath);
  try {
    const promptTemplate = readFileSync(join(dir, 'prompt.md'), 'utf8');
    const reportSchema = JSON.parse(
      readFileSync(join(dir, 'report.schema.json'), 'utf8'),
    ) as Record<string, unknown>;
    return { promptTemplate, reportSchema };
  } catch {
    return null;
  }
}

/**
 * Render the `Prompt` + `Report schema` sections (§3.3 sectioned block:
 * heading at indent 2, content lines at indent 4). Both bodies are
 * plugin-authored, so the whole text runs through `sanitizeForTerminal`
 * before the line split (defence in depth; the `--json` path stays raw).
 * Empty string for deterministic extensions: no sections, unchanged
 * output.
 */
function renderContractSections(contract: IProbabilisticContract | null): string {
  if (contract === null) return '';
  const lines: string[] = [PLUGINS_TEXTS.detailSectionPrompt];
  for (const line of splitSanitized(contract.promptTemplate)) {
    lines.push(tx(PLUGINS_TEXTS.detailSectionLine, { line }));
  }
  lines.push(PLUGINS_TEXTS.detailSectionReportSchema);
  for (const line of splitSanitized(JSON.stringify(contract.reportSchema, null, 2))) {
    lines.push(tx(PLUGINS_TEXTS.detailSectionLine, { line }));
  }
  return lines.join('');
}

/** Sanitize once, then split into render lines (trailing newline dropped). */
function splitSanitized(text: string): string[] {
  return sanitizeForTerminal(text).replace(/\n$/, '').split('\n');
}

/**
 * Single-extension detail for a built-in extension. Header is the
 * qualified id with the same enabled/disabled glyph the plugin row
 * uses, followed by a field block (Kind / Version / Stability /
 * Description / Preconditions / Entry). Optional fields the manifest
 * does not declare are dropped from the block, the row is not rendered
 * as "(none)" so the output stays compact and a missing description
 * never looks like a placeholder bug.
 */
function renderBuiltInExtensionDetail(
  pluginId: string,
  ext: IBuiltInPluginRow['extensions'][number],
  ansi: IAnsi,
): string {
  const glyph = ext.enabled
    ? ansi.green(PLUGINS_TEXTS.rowGlyphOk)
    : ansi.red(PLUGINS_TEXTS.rowGlyphOff);
  const header = tx(PLUGINS_TEXTS.detailHeaderExtensionBuiltIn, {
    glyph,
    qualifiedId: sanitizeForTerminal(`${pluginId}/${ext.id}`),
    source: ansi.dim(PLUGINS_TEXTS.sourceBuiltIn),
  });
  // Built-in extensions inherit the CLI version, the Version field is
  // intentionally omitted from human output (see also `renderBuiltInDetail`
  // in list.ts). Stability surfaces only when non-default (`stable` == no row).
  const meta: IExtensionFieldInput = { kind: ext.kind };
  if (ext.stability && ext.stability !== 'stable') meta.stability = ext.stability;
  if (ext.description) meta.description = ext.description;
  if (ext.entry !== undefined) meta.entry = ext.entry;
  return header + '\n' + renderExtensionFields(meta);
}

/**
 * Single-extension detail for a user-plugin extension. Mirrors the
 * built-in variant; reads the per-extension metadata off
 * `ILoadedExtension.instance` (the loader-cloned runtime instance,
 * spec-guaranteed to carry `IExtensionBase` fields). Disabled or
 * error-state plugins never reach this code path because the
 * qualified-id parser only matches extensions discovered under
 * `status === 'enabled'`.
 */
function renderUserExtensionDetail(
  pluginId: string,
  ext: ILoadedExtension,
  ansi: IAnsi,
): string {
  const glyph = ansi.green(PLUGINS_TEXTS.rowGlyphOk);
  const header = tx(PLUGINS_TEXTS.detailHeaderExtensionUser, {
    glyph,
    qualifiedId: sanitizeForTerminal(`${pluginId}/${ext.id}`),
    source: ansi.dim(PLUGINS_TEXTS.sourceUser),
  });
  const meta = readInstanceMeta(ext.instance);
  const input: IExtensionFieldInput = {
    kind: ext.kind,
    version: ext.version,
    entry: ext.entryPath,
  };
  // `stability` is loader-stamped (typed) on `ILoadedExtension`, no
  // instance shape-check needed. Non-default values only (`stable`,
  // declared or defaulted, renders no row).
  if (ext.stability && ext.stability !== 'stable') input.stability = ext.stability;
  if (meta.description !== undefined) input.description = meta.description;
  if (meta.preconditions !== undefined) input.preconditions = meta.preconditions;
  return header + '\n' + renderExtensionFields(input);
}

interface IExtensionMeta {
  description?: string;
  preconditions?: ReadonlyArray<string>;
}

interface IExtensionFieldInput {
  kind: string;
  /**
   * Optional. Present for user-plugin extensions, omitted for
   * built-in extensions (which inherit the CLI version and do not
   * declare per-extension semver).
   */
  version?: string;
  stability?: string;
  description?: string;
  preconditions?: ReadonlyArray<string>;
  entry?: string;
}

function readInstanceMeta(instance: unknown): IExtensionMeta {
  if (instance === null || typeof instance !== 'object') return {};
  const obj = instance as Record<string, unknown>;
  const out: IExtensionMeta = {};
  if (typeof obj['description'] === 'string') out.description = obj['description'];
  if (Array.isArray(obj['preconditions'])) {
    out.preconditions = (obj['preconditions'] as unknown[]).filter(
      (p): p is string => typeof p === 'string',
    );
  }
  return out;
}

function renderExtensionFields(meta: IExtensionFieldInput): string {
  const fields: Array<{ label: string; value: string }> = [];
  fields.push({ label: PLUGINS_TEXTS.detailFieldKind, value: sanitizeForTerminal(meta.kind) });
  if (meta.version) {
    fields.push({
      label: PLUGINS_TEXTS.detailFieldVersion,
      value: sanitizeForTerminal(meta.version),
    });
  }
  if (meta.stability) {
    fields.push({
      label: PLUGINS_TEXTS.detailFieldStability,
      value: sanitizeForTerminal(meta.stability),
    });
  }
  if (meta.description) {
    fields.push({
      label: PLUGINS_TEXTS.detailFieldDescription,
      value: sanitizeForTerminal(meta.description),
    });
  }
  if (meta.preconditions && meta.preconditions.length > 0) {
    fields.push({
      label: PLUGINS_TEXTS.detailFieldPreconditions,
      value: meta.preconditions.map(sanitizeForTerminal).join(', '),
    });
  }
  if (meta.entry) {
    fields.push({ label: PLUGINS_TEXTS.detailFieldEntry, value: sanitizeForTerminal(meta.entry) });
  }
  const labelWidth = Math.max(...fields.map((f) => f.label.length));
  return fields
    .map((f) =>
      tx(PLUGINS_TEXTS.detailFieldRow, {
        label: f.label.padEnd(labelWidth),
        value: f.value,
      }),
    )
    .join('');
}
