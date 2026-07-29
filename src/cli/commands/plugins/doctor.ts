/**
 * `sm plugins doctor`, full load pass + structured summary.
 *
 * Three diagnostic sections, each gated on having content:
 *
 *   1. **Counts**, per-status row table (enabled / disabled /
 *      incompatible-* / invalid-manifest / load-error / id-collision)
 *      with built-ins folded in. Errors gate the exit code; `disabled`
 *      is intentional and never an issue.
 *   2. **Applicable-kind warnings**, Extractor declares
 *      `applicableKinds` referencing a `node.kind` no installed
 *      Provider emits (Spec § A.10). Informational, does NOT
 *      promote the exit code.
 *   3. **Unknown-slot warnings**. Any extension's
 *      `viewContributions[<id>].slot` references a slot name not in
 *      the kernel's closed catalog (`KNOWN_SLOT_NAMES`). AJV at
 *      manifest load already rejects unknown slots as
 *      `invalid-manifest`; this section is the defence-in-depth path
 *      for plugins authored against an older catalog whose
 *      `catalogCompat` happens to satisfy the current major
 *      syntactically (the slot disappeared on a rename / deprecation).
 *      Informational, does NOT promote the exit code.
 *
 * Exit code: 0 when every plugin is enabled or intentionally disabled;
 * 1 when any plugin is in an error / incompatible state.
 */

import { Command, Option } from 'clipanion';

import { builtInPlugins } from '../../../plugins/built-ins.js';
import type { IContributionErrorRecord } from '../../../kernel/adapters/sqlite/contributions.js';
import type {
  IExtractor,
  IProvider,
} from '../../../kernel/extensions/index.js';
import type {
  IDiscoveredPlugin,
  ILoadedExtension,
} from '../../../kernel/types/plugin.js';
import { qualifiedExtensionId } from '../../../kernel/registry.js';
import { KNOWN_SLOT_NAMES } from '../../../kernel/types/view-catalog.js';
import { sanitizeForTerminal } from '../../../kernel/util/safe-text.js';
import { tx } from '../../../kernel/util/tx.js';
import { PLUGINS_TEXTS } from '../../i18n/plugins.texts.js';
import type { IAnsi } from '../../util/ansi.js';
import { resolveDbPath } from '../../util/db-path.js';
import { ExitCode } from '../../util/exit-codes.js';
import { defaultRuntimeContext } from '../../../core/runtime/runtime-context.js';
import { SmCommand } from '../../util/sm-command.js';
import { tryWithSqlite } from '../../../core/sqlite/with-sqlite.js';
import {
  builtInRows,
  buildResolver,
  loadAll,
  wrapText,
  type IBuiltInPluginRow,
} from './shared.js';

interface IApplicableKindWarning {
  extractorQualifiedId: string;
  unknownKind: string;
}

interface IUnknownSlotWarning {
  extensionQualifiedId: string;
  contributionId: string;
  slot: string;
}

/**
 * `--json` envelope per `spec/schemas/plugins-doctor.schema.json`.
 * Mirrors the structured data the human renderer aggregates; the table
 * formatting is dropped, the issues / warnings lists are kept verbatim.
 */
interface IPluginsDoctorJsonEnvelope {
  ok: true;
  kind: 'plugins.doctor';
  counts: {
    enabled: number;
    disabled: number;
    loaded: number;
    incompatible: number;
    invalid: number;
    loadError: number;
    warnings: number;
  };
  issues: Array<{ id: string; status: string; reason: string }>;
  warnings: Array<{ id: string; kind: 'applicable-kind-unknown' | 'unknown-slot'; message: string }>;
  contributionErrors: Array<{
    pluginId: string;
    extensionId: string;
    nodePath: string;
    reason: string;
    message: string;
    contributionId?: string;
    slot?: string;
  }>;
  elapsedMs: number;
}

/** Per-plugin grouping of runtime contribution errors for the render pass. */
interface IContributionErrorGroup {
  pluginId: string;
  errors: IContributionErrorRecord[];
}

/**
 * Max sample lines rendered per plugin group in the human output. Doctor
 * is a triage surface, not a full log dump; the `--json` envelope carries
 * every error for tooling that needs the complete set.
 */
const CONTRIB_ERROR_SAMPLE_CAP = 3;

/** Explicit ordering for the doctor table so the user-facing output
 *  does not depend on JS object insertion order. Keep aligned with
 *  the `counts` initialiser inside the verb. */
const STATUS_ORDER: ReadonlyArray<IDiscoveredPlugin['status']> = [
  'enabled',
  'disabled',
  'incompatible-spec',
  'incompatible-catalog',
  'invalid-manifest',
  'load-error',
  'id-collision',
];

export class PluginsDoctorCommand extends SmCommand {
  static override paths = [['plugins', 'doctor']];
  static override usage = Command.Usage({
    category: 'Plugins',
    description: 'Run the full load pass and summarise by failure mode.',
    details: 'Exit code 0 when every plugin loads or is intentionally disabled; 1 when any plugin is in an error / incompat state.',
  });

  pluginDir = Option.String('--plugin-dir', { required: false });

  protected async run(): Promise<number> {
    const plugins = await loadAll({ pluginDir: this.pluginDir });
    const resolveEnabled = await buildResolver();
    const builtIns = builtInRows(resolveEnabled);

    const counts = countByStatus(builtIns, plugins);
    const knownKinds = collectKnownKinds(plugins);
    const applicableKindWarnings = collectApplicableKindWarnings(plugins, knownKinds);
    const unknownSlotWarnings = collectUnknownSlotWarnings(plugins, KNOWN_SLOT_NAMES);
    // "off-shape visible" follow-up. Read the last scan's persisted
    // contribution rejections. Best-effort: a fresh project (no DB / no
    // table yet) yields an empty list so doctor still runs cleanly.
    const contribErrors = await loadContributionErrors();
    const contribErrorGroups = groupContributionErrorsByPlugin(contribErrors);

    const bad = plugins.filter((p) => p.status !== 'enabled' && p.status !== 'disabled');
    const totalWarnings = applicableKindWarnings.length + unknownSlotWarnings.length;

    if (this.json) {
      const envelope = buildDoctorJsonEnvelope({
        counts,
        bad,
        applicableKindWarnings,
        unknownSlotWarnings,
        totalWarnings,
        contribErrors,
        elapsedMs: this.elapsed!.ms(),
      });
      this.printer!.data(JSON.stringify(envelope) + '\n');
      return bad.length > 0 || contribErrors.length > 0 ? ExitCode.Issues : ExitCode.Ok;
    }

    this.#renderHumanReport({
      counts,
      builtInCount: builtIns.length,
      userCount: plugins.length,
      applicableKindWarnings,
      unknownSlotWarnings,
      totalWarnings,
      bad,
      contribErrorGroups,
      contribErrorCount: contribErrors.length,
    });
    // Both the bad-plugin set AND any runtime contribution error gate
    // the exit code (the same posture as the load-error states above).
    return bad.length > 0 || contribErrors.length > 0 ? ExitCode.Issues : ExitCode.Ok;
  }

  /**
   * Render the full human-mode report in section order: summary header,
   * source + status tables, then the gated warnings / issues / runtime
   * contribution-error sections. Pulled out of `run` so the verb body
   * stays a linear pipeline (load → aggregate → render → exit code)
   * under the complexity cap.
   */
  #renderHumanReport(args: {
    counts: TStatusCounts;
    builtInCount: number;
    userCount: number;
    applicableKindWarnings: IApplicableKindWarning[];
    unknownSlotWarnings: IUnknownSlotWarning[];
    totalWarnings: number;
    bad: IDiscoveredPlugin[];
    contribErrorGroups: IContributionErrorGroup[];
    contribErrorCount: number;
  }): void {
    const ansi = this.ansiFor('stdout');
    this.#renderSummaryHeader(args.counts.enabled, args.bad.length, args.totalWarnings);
    this.#renderSourceBreakdown(args.builtInCount, args.userCount);
    this.#renderStatusBreakdown(args.counts, ansi);
    if (args.totalWarnings > 0) {
      this.#renderWarnings(
        args.applicableKindWarnings,
        args.unknownSlotWarnings,
        args.totalWarnings,
        ansi,
      );
    }
    if (args.bad.length > 0) {
      this.#renderIssues(args.bad, ansi);
    }
    if (args.contribErrorCount > 0) {
      this.#renderContributionErrors(args.contribErrorGroups, args.contribErrorCount, ansi);
    }
  }

  #renderSummaryHeader(
    enabled: number,
    badCount: number,
    warnings: number,
  ): void {
    this.printer!.data(
      tx(PLUGINS_TEXTS.doctorSummary, {
        enabled,
        enabledPlural: enabled === 1 ? '' : 's',
        issues: badCount,
        issuesPlural: badCount === 1 ? '' : 's',
        warnings,
        warningsPlural: warnings === 1 ? '' : 's',
      }),
    );
  }

  #renderSourceBreakdown(builtInCount: number, userCount: number): void {
    const labelWidth = Math.max(
      PLUGINS_TEXTS.sourceBuiltIn.length,
      PLUGINS_TEXTS.sourceUser.length,
    );
    this.printer!.data(PLUGINS_TEXTS.doctorSourceHeader);
    this.printer!.data(
      tx(PLUGINS_TEXTS.doctorSourceRow, {
        label: PLUGINS_TEXTS.sourceBuiltIn.padEnd(labelWidth),
        count: builtInCount,
      }),
    );
    this.printer!.data(
      tx(PLUGINS_TEXTS.doctorSourceRow, {
        label: PLUGINS_TEXTS.sourceUser.padEnd(labelWidth),
        count: userCount,
      }),
    );
  }

  #renderStatusBreakdown(counts: TStatusCounts, ansi: IAnsi): void {
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
  }

  #renderWarnings(
    applicableKindWarnings: IApplicableKindWarning[],
    unknownSlotWarnings: IUnknownSlotWarning[],
    totalWarnings: number,
    ansi: IAnsi,
  ): void {
    this.printer!.data(tx(PLUGINS_TEXTS.doctorWarningsHeader, { count: totalWarnings }));
    const warnGlyph = ansi.yellow('⚠');
    for (const w of applicableKindWarnings) {
      this.#emitWarningEntry(
        warnGlyph,
        sanitizeForTerminal(w.extractorQualifiedId),
        tx(PLUGINS_TEXTS.doctorApplicableKindUnknown, {
          unknownKind: sanitizeForTerminal(w.unknownKind),
        }),
        ansi,
      );
    }
    for (const w of unknownSlotWarnings) {
      // The qualified extension id (`<pluginId>/<extensionId>`) drives
      // the `sm plugins upgrade` hint inside the message body.
      const slash = w.extensionQualifiedId.indexOf('/');
      const pluginId = slash >= 0 ? w.extensionQualifiedId.slice(0, slash) : w.extensionQualifiedId;
      this.#emitWarningEntry(
        warnGlyph,
        sanitizeForTerminal(`${w.extensionQualifiedId}/${w.contributionId}`),
        tx(PLUGINS_TEXTS.doctorUnknownSlot, {
          contributionId: sanitizeForTerminal(w.contributionId),
          slot: sanitizeForTerminal(w.slot),
          pluginId: sanitizeForTerminal(pluginId),
        }),
        ansi,
      );
    }
  }

  #emitWarningEntry(glyph: string, id: string, message: string, ansi: IAnsi): void {
    this.printer!.data(tx(PLUGINS_TEXTS.doctorWarningEntry, { glyph, id }));
    for (const line of wrapText(message, 64)) {
      this.printer!.data(tx(PLUGINS_TEXTS.doctorWarningBody, { line: ansi.dim(line) }));
    }
  }

  #renderIssues(bad: IDiscoveredPlugin[], ansi: IAnsi): void {
    this.printer!.data(tx(PLUGINS_TEXTS.doctorIssuesHeader, { count: bad.length }));
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
          this.printer!.data(tx(PLUGINS_TEXTS.doctorIssueBody, { line: ansi.dim(line) }));
        }
      }
    }
  }

  /**
   * "off-shape visible" follow-up. Render the last scan's runtime
   * contribution rejections grouped by plugin: one red entry per plugin
   * (id + this plugin's error count), then up to
   * `CONTRIB_ERROR_SAMPLE_CAP` wrapped sample messages, then a dimmed
   * "... and N more" note when the group overflows the cap. The full
   * set is always available via `--json`.
   */
  #renderContributionErrors(
    groups: IContributionErrorGroup[],
    total: number,
    ansi: IAnsi,
  ): void {
    this.printer!.data(tx(PLUGINS_TEXTS.doctorContribErrorsHeader, { count: total }));
    const glyph = ansi.red(PLUGINS_TEXTS.rowGlyphOff);
    for (const group of groups) {
      this.printer!.data(
        tx(PLUGINS_TEXTS.doctorContribErrorEntry, {
          glyph,
          pluginId: sanitizeForTerminal(group.pluginId),
          count: group.errors.length,
        }),
      );
      for (const err of group.errors.slice(0, CONTRIB_ERROR_SAMPLE_CAP)) {
        for (const line of wrapText(sanitizeForTerminal(err.message), 64)) {
          this.printer!.data(
            tx(PLUGINS_TEXTS.doctorContribErrorBody, { line: ansi.dim(line) }),
          );
        }
      }
      const hidden = group.errors.length - CONTRIB_ERROR_SAMPLE_CAP;
      if (hidden > 0) {
        this.printer!.data(
          tx(PLUGINS_TEXTS.doctorContribErrorMore, {
            line: ansi.dim(tx(PLUGINS_TEXTS.doctorContribErrorMoreText, { count: hidden })),
          }),
        );
      }
    }
  }
}

type TStatusCounts = Record<IDiscoveredPlugin['status'], number>;

/**
 * Tally every extension by status. Every extension counts individually
 * (each is independently toggle-able by its qualified id). For loaded
 * user plugins, every child extension contributes (enabled / disabled
 * per the resolver). Failed plugins (invalid-manifest, load-error,
 * incompatible-*, id-collision, fully-disabled-at-boot) contribute one
 * unit at the plugin level because the per-extension axis is not
 * reachable.
 */
function countByStatus(
  builtIns: IBuiltInPluginRow[],
  plugins: IDiscoveredPlugin[],
): TStatusCounts {
  const counts: TStatusCounts = {
    enabled: 0,
    disabled: 0,
    'incompatible-spec': 0,
    'incompatible-catalog': 0,
    'invalid-manifest': 0,
    'load-error': 0,
    'id-collision': 0,
  };
  for (const b of builtIns) {
    for (const ext of b.extensions) {
      counts[ext.enabled ? 'enabled' : 'disabled']++;
    }
  }
  for (const p of plugins) {
    if (p.status !== 'enabled' || !p.extensions) {
      counts[p.status]++;
      continue;
    }
    // Imported means enabled: the loader now skips the import of a
    // disabled extension outright, so membership in `extensions` is the
    // answer rather than something to re-resolve. The ones it skipped
    // are still declared on disk and count as disabled.
    counts.enabled += p.extensions.length;
    counts.disabled += (p.unloadedExtensions ?? []).length;
  }
  return counts;
}

// --- Provider iteration --------------------------------------------------

/**
 * Iterate every Provider instance reachable from this run, built-in
 * plugins first, then user plugins (enabled only). Centralises the
 * "if (ext.kind !== 'provider') continue; cast/extract instance"
 * guard so doctor-style helpers can stay focused on per-Provider
 * logic.
 *
 * Split into two helpers per source so each loop body is trivially
 * small (lint-friendly) without duplicating the `forEach` signature.
 */
function forEachProviderInstance(
  plugins: IDiscoveredPlugin[],
  callback: (entry: { id: string; pluginId: string; instance: Record<string, unknown> }) => void,
): void {
  forEachBuiltInProvider(callback);
  forEachUserPluginProvider(plugins, callback);
}

function forEachBuiltInProvider(
  callback: (entry: { id: string; pluginId: string; instance: Record<string, unknown> }) => void,
): void {
  for (const plugin of builtInPlugins) {
    for (const ext of plugin.extensions) {
      if (ext.kind !== 'provider') continue;
      const provider = ext as IProvider;
      callback({
        id: provider.id,
        pluginId: plugin.id,
        instance: provider as unknown as Record<string, unknown>,
      });
    }
  }
}

function forEachUserPluginProvider(
  plugins: IDiscoveredPlugin[],
  callback: (entry: { id: string; pluginId: string; instance: Record<string, unknown> }) => void,
): void {
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
 * Pull the runtime instance an `ILoadedExtension` points at. The
 * loader stores the imported ESM namespace verbatim in `.module`; the
 * extension's runtime export lives at `module.default` (or, for a CJS
 * fallback, on the namespace itself). Returns `null` when the shape
 * is not recognisable, the caller treats that as "no
 * applicableKinds to inspect" and moves on.
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
 * declares it can emit. The truth source is `IProvider.kinds`, every
 * kind the Provider emits MUST appear there per `architecture.md`
 * §`Provider`. The union of those keys is the kernel's "known kinds"
 * surface for unknown-kind detection.
 *
 * Each kind is registered under BOTH forms: the bare key (`agent`) and
 * the qualified `<pluginId>/<kind>` form (`claude/agent`). The bare
 * form mirrors the kernel runtime's matcher (`matchesKindPrecondition`
 * strips the qualifier before comparing); the qualified form covers
 * extractors that declare `precondition.kind: ['claude/agent']`
 * verbatim. Without the qualified form the doctor produced false
 * positives for `claude/tools-counter` (whose precondition lists
 * `claude/agent`) even when the `claude` plugin was enabled.
 */
function collectKnownKinds(plugins: IDiscoveredPlugin[]): Set<string> {
  const known = new Set<string>();
  forEachProviderInstance(plugins, ({ pluginId, instance }) => {
    const map = instance['kinds'];
    if (map === null || typeof map !== 'object') return;
    for (const k of Object.keys(map)) {
      known.add(k);
      known.add(qualifiedExtensionId(pluginId, k));
    }
  });
  return known;
}

// --- applicableKinds collection -----------------------------------------

/**
 * Walk every loaded Extractor (built-in + user plugin) and produce
 * one warning per unknown kind referenced via `applicableKinds`. An
 * extractor with no `applicableKinds` field is silent (default =
 * applies to all kinds). Iteration order is deterministic so the
 * rendered doctor output stays stable across runs.
 *
 * Split into two helpers per source mirroring the Provider iteration
 * helpers, each loop stays trivially small.
 */
function collectApplicableKindWarnings(
  plugins: IDiscoveredPlugin[],
  knownKinds: Set<string>,
): IApplicableKindWarning[] {
  const out: IApplicableKindWarning[] = [];
  collectBuiltInApplicableKindWarnings(out, knownKinds);
  collectUserApplicableKindWarnings(out, plugins, knownKinds);
  return out;
}

function collectBuiltInApplicableKindWarnings(
  out: IApplicableKindWarning[],
  knownKinds: Set<string>,
): void {
  // Structure-as-truth: extractor / analyzer / action declare their kind
  // filter via `precondition.kind` (qualified `<pluginPlugin>/<kindName>`)
  // instead of the old `applicableKinds: string[]` list. The doctor now
  // checks the qualified ids against the registered kinds catalog.
  for (const plugin of builtInPlugins) {
    for (const ext of plugin.extensions) {
      if (ext.kind !== 'extractor') continue;
      const extractor = ext as IExtractor;
      const kinds = extractor.precondition?.kind;
      if (!kinds || kinds.length === 0) continue;
      appendUnknownKindWarnings(
        out,
        qualifiedExtensionId(plugin.id, extractor.id),
        kinds,
        knownKinds,
      );
    }
  }
}

function collectUserApplicableKindWarnings(
  out: IApplicableKindWarning[],
  plugins: IDiscoveredPlugin[],
  knownKinds: Set<string>,
): void {
  for (const p of plugins) {
    if (p.status !== 'enabled' || !p.extensions) continue;
    for (const ext of p.extensions) {
      collectKindsFromExtension(ext, knownKinds, out);
    }
  }
}

function collectKindsFromExtension(
  ext: ILoadedExtension,
  knownKinds: Set<string>,
  out: IApplicableKindWarning[],
): void {
  if (ext.kind !== 'extractor') return;
  const inst = extensionInstance(ext);
  if (!inst) return;
  const pre = inst['precondition'];
  if (!pre || typeof pre !== 'object') return;
  const kinds = (pre as { kind?: unknown }).kind;
  if (!Array.isArray(kinds)) return;
  appendUnknownKindWarnings(
    out,
    qualifiedExtensionId(ext.pluginId, ext.id),
    kinds,
    knownKinds,
  );
}

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

// --- unknown-slot collection --------------------------------------------

/**
 * Walk every loaded extension (built-in + user plugin, any kind) and
 * produce one warning per `viewContributions[<id>].slot` that does not
 * appear in the kernel's closed slot catalog. AJV at manifest load
 * already rejects unknown slots as `invalid-manifest`; this pass is
 * the defence-in-depth path for catalog-drift scenarios (a plugin
 * authored against an older catalog whose `catalogCompat` happens to
 * satisfy the current major syntactically, but whose slot id was
 * renamed / removed in the meantime).
 *
 * Iteration order is deterministic so the rendered doctor output stays
 * stable across runs. Split into two helpers per source, mirroring the
 * applicable-kind collectors above.
 */
function collectUnknownSlotWarnings(
  plugins: IDiscoveredPlugin[],
  knownSlots: ReadonlySet<string>,
): IUnknownSlotWarning[] {
  const out: IUnknownSlotWarning[] = [];
  collectBuiltInUnknownSlotWarnings(out, knownSlots);
  collectUserUnknownSlotWarnings(out, plugins, knownSlots);
  return out;
}

function collectBuiltInUnknownSlotWarnings(
  out: IUnknownSlotWarning[],
  knownSlots: ReadonlySet<string>,
): void {
  for (const plugin of builtInPlugins) {
    for (const ext of plugin.extensions) {
      // Every `TBuiltInExtension` extends `IExtensionBase`, which
      // declares the optional `viewContributions` field. Read it
      // through a structural cast (no kind filter, every extension
      // kind may contribute).
      const vc = (ext as { viewContributions?: Record<string, unknown> }).viewContributions;
      if (!vc) continue;
      appendUnknownSlotWarnings(out, qualifiedExtensionId(plugin.id, ext.id), vc, knownSlots);
    }
  }
}

function collectUserUnknownSlotWarnings(
  out: IUnknownSlotWarning[],
  plugins: IDiscoveredPlugin[],
  knownSlots: ReadonlySet<string>,
): void {
  for (const p of plugins) {
    if (p.status !== 'enabled' || !p.extensions) continue;
    for (const ext of p.extensions) {
      const inst = extensionInstance(ext);
      if (!inst) continue;
      const vc = inst['viewContributions'];
      if (vc === null || typeof vc !== 'object') continue;
      appendUnknownSlotWarnings(
        out,
        qualifiedExtensionId(ext.pluginId, ext.id),
        vc as Record<string, unknown>,
        knownSlots,
      );
    }
  }
}

function appendUnknownSlotWarnings(
  out: IUnknownSlotWarning[],
  extensionQualifiedId: string,
  viewContributions: Record<string, unknown>,
  knownSlots: ReadonlySet<string>,
): void {
  for (const [contributionId, raw] of Object.entries(viewContributions)) {
    if (raw === null || typeof raw !== 'object') continue;
    const slot = (raw as { slot?: unknown }).slot;
    if (typeof slot !== 'string') continue;
    if (knownSlots.has(slot)) continue;
    out.push({ extensionQualifiedId, contributionId, slot });
  }
}

// --- --json envelope ----------------------------------------------------

/**
 * Project the doctor's structured data into the wire envelope declared
 * by `spec/schemas/plugins-doctor.schema.json`. The human renderer
 * folds the same aggregates into a table; the JSON form drops the
 * formatting and keeps the raw counts + lists.
 */
function buildDoctorJsonEnvelope(args: {
  counts: TStatusCounts;
  bad: IDiscoveredPlugin[];
  applicableKindWarnings: IApplicableKindWarning[];
  unknownSlotWarnings: IUnknownSlotWarning[];
  totalWarnings: number;
  contribErrors: IContributionErrorRecord[];
  elapsedMs: number;
}): IPluginsDoctorJsonEnvelope {
  const issues = args.bad.map((p) => ({
    id: sanitizeForTerminal(p.id),
    status: p.status,
    reason: sanitizeForTerminal(p.reason ?? ''),
  }));
  const warnings: IPluginsDoctorJsonEnvelope['warnings'] = [];
  for (const w of args.applicableKindWarnings) {
    warnings.push({
      id: sanitizeForTerminal(w.extractorQualifiedId),
      kind: 'applicable-kind-unknown',
      message: tx(PLUGINS_TEXTS.doctorApplicableKindUnknown, {
        unknownKind: sanitizeForTerminal(w.unknownKind),
      }),
    });
  }
  for (const w of args.unknownSlotWarnings) {
    const slash = w.extensionQualifiedId.indexOf('/');
    const pluginId = slash >= 0 ? w.extensionQualifiedId.slice(0, slash) : w.extensionQualifiedId;
    warnings.push({
      id: sanitizeForTerminal(`${w.extensionQualifiedId}/${w.contributionId}`),
      kind: 'unknown-slot',
      message: tx(PLUGINS_TEXTS.doctorUnknownSlot, {
        contributionId: sanitizeForTerminal(w.contributionId),
        slot: sanitizeForTerminal(w.slot),
        pluginId: sanitizeForTerminal(pluginId),
      }),
    });
  }
  // `counts` mirrors the schema's enum surface; the verb collapses the
  // raw `IDiscoveredPlugin['status']` enum into the four error buckets
  // (`loaded` / `incompatible` / `invalid` / `loadError`) so consumers
  // do not have to track the kernel-side label catalog.
  const contributionErrors = args.contribErrors.map((e) => ({
    pluginId: sanitizeForTerminal(e.pluginId),
    extensionId: sanitizeForTerminal(e.extensionId),
    nodePath: sanitizeForTerminal(e.nodePath),
    reason: sanitizeForTerminal(e.reason),
    message: sanitizeForTerminal(e.message),
    ...(e.contributionId !== undefined
      ? { contributionId: sanitizeForTerminal(e.contributionId) }
      : {}),
    ...(e.slot !== undefined ? { slot: sanitizeForTerminal(e.slot) } : {}),
  }));
  return {
    ok: true,
    kind: 'plugins.doctor',
    counts: {
      enabled: args.counts.enabled,
      disabled: args.counts.disabled,
      loaded: args.counts.enabled,
      incompatible: args.counts['incompatible-spec'] + args.counts['incompatible-catalog'],
      invalid: args.counts['invalid-manifest'],
      loadError: args.counts['load-error'] + args.counts['id-collision'],
      warnings: args.totalWarnings,
    },
    issues,
    warnings,
    contributionErrors,
    elapsedMs: args.elapsedMs,
  };
}

// --- runtime contribution errors (last scan) ----------------------------

/**
 * "off-shape visible" follow-up. Read the last scan's persisted
 * contribution rejections from `scan_contribution_errors`. Best-effort:
 *
 *   - `tryWithSqlite` returns `null` when the DB file is absent (fresh
 *     project, no scan yet) → treated as `[]`.
 *   - The try/catch swallows a missing-table error (a DB written before
 *     this feature shipped, or `--no-built-ins` runs that never persist)
 *     so doctor still completes on a partially-provisioned DB.
 *
 * Scope is always project-local (`<cwd>/.skill-map/skill-map.db`); the
 * verb honours no `--db` override (none is declared on it), so the path
 * resolves from the runtime cwd context per
 * `spec/cli-contract.md` §Scope is always project-local.
 */
async function loadContributionErrors(): Promise<IContributionErrorRecord[]> {
  const ctx = defaultRuntimeContext();
  const dbPath = resolveDbPath({ db: undefined, cwd: ctx.cwd });
  try {
    const rows = await tryWithSqlite(
      { databasePath: dbPath, autoBackup: false },
      (adapter) => adapter.contributions.listAllErrors(),
    );
    return rows ?? [];
  } catch {
    return [];
  }
}

/**
 * Group contribution errors by plugin id, preserving the load order
 * (the loader already sorts `pluginId` ASC then `emittedAt` ASC), so
 * the rendered groups stay stable across runs.
 */
function groupContributionErrorsByPlugin(
  errors: readonly IContributionErrorRecord[],
): IContributionErrorGroup[] {
  const byPlugin = new Map<string, IContributionErrorGroup>();
  for (const err of errors) {
    let group = byPlugin.get(err.pluginId);
    if (!group) {
      group = { pluginId: err.pluginId, errors: [] };
      byPlugin.set(err.pluginId, group);
    }
    group.errors.push(err);
  }
  return [...byPlugin.values()];
}
