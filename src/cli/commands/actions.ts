/**
 * `sm actions list` / `sm actions show <id>` (Step 10), the manifest view
 * over the composed Action catalog (`spec/cli-contract.md` §Actions).
 *
 * Both verbs compose the same runtime the job verbs resolve against
 * (`loadActionRuntime`: built-ins + enabled project plugins) and render
 * manifests only; actions are never invoked here (invocation is `sm jobs
 * submit` for probabilistic actions, in-process dispatch for
 * deterministic ones). No DB gate: the catalog exists with or without a
 * scan, so an empty project still lists the built-ins.
 *
 * Derived traits get NO fields of their own (decision 2026-07-13): the
 * summarizer write-through, for example, is read where it lives, the
 * `report schema` ref on the `show` detail (a `summaries/` extension IS
 * the signal, `job-lifecycle.md` §Record). The view renders manifest
 * data only.
 */

import { join } from 'node:path';

import { Command, Option } from 'clipanion';

import type {
  IAction,
  IActionPrecondition,
  TActionWriteKind,
} from '../../kernel/extensions/index.js';
import type { TExecutionMode } from '../../kernel/types.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { ACTIONS_TEXTS as T } from '../i18n/actions.texts.js';
import type { IAnsi } from '../util/ansi.js';
import { ExitCode } from '../util/exit-codes.js';
import { relativeIfBelow } from '../util/path-display.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { truncateHead } from '../util/text.js';
import { loadActionRuntime, resolveAction, type IActionRuntime } from './action-runtime.js';
import { resolveActionRecord } from './record-outcome.js';

/**
 * One catalog row, the shared shape of `list --json` (array) and
 * `show --json` (single object, extended with `reportSchemaRef` +
 * `hasPromptTemplate`). Raw manifest values, unsanitised: JSON is
 * contract, the human renderers sanitise at their own boundary.
 */
interface IActionRow {
  qualifiedId: string;
  id: string;
  pluginId: string;
  /** Manifest `mode`, defaulted (`deterministic` when absent). */
  mode: TExecutionMode;
  description?: string;
  writes?: TActionWriteKind[];
  precondition?: IActionPrecondition;
  probExpectedDurationSeconds?: number;
  /** `built-in` (bundled) or the plugin dir, relative when under cwd. */
  source: string;
}

/** `show --json` payload: the row plus the schema-derived extras. */
interface IActionDetail extends IActionRow {
  reportSchemaRef: string | null;
  hasPromptTemplate: boolean;
}

export class ActionsListCommand extends SmCommand {
  static override paths = [['actions', 'list']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Registered action types (manifest view).',
    details: `
      Composes the action catalog (built-ins + enabled project plugins)
      and lists one row per action: qualified id, execution mode, and
      description. Actions are not invoked here; probabilistic actions
      queue via \`sm jobs submit\`.
    `,
    examples: [
      ['List every registered action', '$0 actions list'],
      ['Machine-readable catalog', '$0 actions list --json'],
    ],
  });

  protected async run(): Promise<number> {
    const runtime = await loadActionRuntime(this.printer!);
    const rows = buildRows(runtime);
    if (this.json) {
      this.printer!.data(JSON.stringify(rows) + '\n');
      return ExitCode.Ok;
    }
    const ansi = this.ansiFor('stdout');
    if (rows.length === 0) {
      this.printer!.data(tx(T.listEmpty, { glyph: ansi.green('✓') }));
      return ExitCode.Ok;
    }
    this.printer!.data(renderTable(rows, ansi));
    return ExitCode.Ok;
  }
}

export class ActionsShowCommand extends SmCommand {
  static override paths = [['actions', 'show']];
  static override usage = Command.Usage({
    category: 'Jobs',
    description: 'Full action manifest: preconditions, expected duration, report schema ref.',
    details: `
      Resolves an action by qualified id (\`core/markdown-summarizer\`)
      or bare id (\`markdown-summarizer\`) against the composed catalog
      and renders its full manifest: plugin, mode, description, declared
      writes, source, the probabilistic block (expected duration, prompt
      template, report schema ref) and the declared precondition.
    `,
    examples: [
      ['Show the universal summarizer', '$0 actions show markdown-summarizer'],
      ['Machine-readable manifest', '$0 actions show core/node-bump --json'],
    ],
  });

  id = Option.String({ required: true });

  protected async run(): Promise<number> {
    const runtime = await loadActionRuntime(this.printer!);
    const action = resolveAction(runtime.actions, this.id);
    if (!action) {
      const stderrAnsi = this.ansiFor('stderr');
      this.printer!.error(
        tx(T.showNotFound, {
          glyph: stderrAnsi.red('✕'),
          id: sanitizeForTerminal(this.id),
          hint: stderrAnsi.dim(T.showNotFoundHint),
        }),
      );
      return ExitCode.NotFound;
    }

    const { row, schema } = buildRow(runtime, action);
    if (this.json) {
      const detail: IActionDetail = {
        ...row,
        reportSchemaRef: reportSchemaRefOf(schema),
        hasPromptTemplate: hasPromptTemplate(runtime, action, row.mode),
      };
      this.printer!.data(JSON.stringify(detail) + '\n');
      return ExitCode.Ok;
    }
    this.printer!.data(renderDetail(runtime, action, row, schema));
    return ExitCode.Ok;
  }
}

// --- row building ----------------------------------------------------------

function buildRows(runtime: IActionRuntime): IActionRow[] {
  return runtime.actions
    .map((action) => buildRow(runtime, action).row)
    .sort((a, b) => a.qualifiedId.localeCompare(b.qualifiedId));
}

/**
 * Project one Action manifest into the shared row shape, alongside its
 * resolved report schema (the plugin's on-disk `report.schema.json` or
 * the built-in's inlined `reportSchema`; `null` when unresolvable). The
 * schema drives the report-schema rendering on the `show` detail,
 * resolved once so `show` never re-reads the file.
 */
function buildRow(
  runtime: IActionRuntime,
  action: IAction,
): { row: IActionRow; schema: Record<string, unknown> | null } {
  const qualifiedId = qualifiedExtensionId(action.pluginId, action.id);
  const dir = runtime.dirByAction.get(qualifiedId);
  const resolution = resolveActionRecord(runtime, qualifiedId);
  const schema = resolution.ok ? resolution.record.schema : null;
  const row: IActionRow = {
    qualifiedId,
    id: action.id,
    pluginId: action.pluginId,
    mode: action.mode ?? 'deterministic',
    source:
      dir === undefined
        ? T.sourceBuiltIn
        : relativeIfBelow(dir, defaultRuntimeContext().cwd),
  };
  assignOptionalManifestFields(row, action);
  return { row, schema };
}

/**
 * Copy the optional manifest fields onto the row only when declared, so
 * the JSON projection omits them entirely (absent, not `null`) exactly
 * like the manifest does.
 */
function assignOptionalManifestFields(row: IActionRow, action: IAction): void {
  if (action.description !== undefined) row.description = action.description;
  if (action.writes !== undefined) row.writes = action.writes;
  if (action.precondition !== undefined) row.precondition = action.precondition;
  if (action.probExpectedDurationSeconds !== undefined) {
    row.probExpectedDurationSeconds = action.probExpectedDurationSeconds;
  }
}

/**
 * First `$ref` string in the report schema's top-level `allOf`, the
 * conventional "extends" pointer every report schema carries
 * (`report-base.schema.json`, or `summaries/<kind>.schema.json` for a
 * summarizer). `null` when the schema is unresolvable or carries none.
 */
function reportSchemaRefOf(schema: Record<string, unknown> | null): string | null {
  if (schema === null) return null;
  const allOf = schema['allOf'];
  if (!Array.isArray(allOf)) return null;
  for (const entry of allOf) {
    if (entry === null || typeof entry !== 'object') continue;
    const ref = (entry as Record<string, unknown>)['$ref'];
    if (typeof ref === 'string') return ref;
  }
  return null;
}

/**
 * Whether the action ships a prompt template: inlined on the built-in
 * manifest (`promptTemplate`, codegen-populated), or resolved by
 * convention from a probabilistic plugin action's source dir
 * (`<dir>/prompt.md`, presence not probed here; the submit path fails
 * loudly when the file is missing).
 */
function hasPromptTemplate(
  runtime: IActionRuntime,
  action: IAction,
  mode: TExecutionMode,
): boolean {
  if (action.promptTemplate !== undefined) return true;
  const dir = runtime.dirByAction.get(qualifiedExtensionId(action.pluginId, action.id));
  return mode === 'probabilistic' && dir !== undefined;
}

// --- list: human renderer ---------------------------------------------------

/**
 * Soft cap on the DESCRIPTION column. Descriptions are single sentences
 * by convention; capping keeps a rogue manifest from exploding the table
 * sideways. Longer values truncate with a trailing `…` (the head of a
 * description carries the signal, unlike `sm list` paths which keep the
 * basename via `truncateTail`).
 */
const DESCRIPTION_COL_MAX_WIDTH = 60;

/** 2-space indent applied to every header / data row (§3.4 rhythm). */
const ROW_INDENT = '  ';

/**
 * Render the human-mode table:
 *
 *   ID                        MODE           DESCRIPTION
 *   core/markdown-summarizer  probabilistic  Summarizes a node's…
 *   core/node-bump            deterministic  Increments the sidecar…
 *
 *   4 actions
 *   Tip: `sm actions show <id>` for the full manifest; …
 *
 * Plugin-sourced fields are sanitised once at the row boundary (§6).
 */
function renderTable(rows: IActionRow[], ansi: IAnsi): string {
  const human = rows.map((r) => ({
    id: sanitizeForTerminal(r.qualifiedId),
    mode: sanitizeForTerminal(r.mode),
    description: truncateHead(
      sanitizeForTerminal(r.description ?? ''),
      DESCRIPTION_COL_MAX_WIDTH,
    ),
  }));
  const idWidth = Math.max(T.tableHeaderId.length, ...human.map((r) => r.id.length));
  const modeWidth = Math.max(T.tableHeaderMode.length, ...human.map((r) => r.mode.length));

  const lines: string[] = [];
  lines.push(ROW_INDENT + [
    ansi.dim(T.tableHeaderId.padEnd(idWidth)),
    ansi.dim(T.tableHeaderMode.padEnd(modeWidth)),
    ansi.dim(T.tableHeaderDescription),
  ].join('  '));
  for (const r of human) {
    lines.push((ROW_INDENT + [
      r.id.padEnd(idWidth),
      ansi.dim(r.mode.padEnd(modeWidth)),
      r.description,
    ].join('  ')).trimEnd());
  }

  lines.push('');
  const noun = rows.length === 1 ? T.footerNounSingular : T.footerNounPlural;
  lines.push(tx(T.tableFooterCount, { count: rows.length, noun }).trimEnd());
  lines.push(ansi.dim(T.tableFooterTip.trimEnd()));
  return lines.join('\n') + '\n';
}

// --- show: human renderer ----------------------------------------------------

interface IDetailField {
  label: string;
  value: string;
}

/**
 * Sectioned detail block (§3.3): header (the qualified id) + main field
 * rows, then a `Probabilistic` section (probabilistic actions only) and
 * a `Precondition` section (declared preconditions only). Empty sections
 * drop entirely (§9), their absence is the signal.
 */
function renderDetail(
  runtime: IActionRuntime,
  action: IAction,
  row: IActionRow,
  schema: Record<string, unknown> | null,
): string {
  const out: string[] = [];
  out.push(tx(T.showHeader, { qualifiedId: sanitizeForTerminal(row.qualifiedId) }));
  out.push(renderFieldBlock(mainFields(row)));
  const prob = probabilisticFields(runtime, action, row, schema);
  if (prob.length > 0) {
    out.push(T.sectionProbabilistic);
    out.push(renderFieldBlock(prob));
  }
  const precond = preconditionFields(row.precondition);
  if (precond.length > 0) {
    out.push(T.sectionPrecondition);
    out.push(renderFieldBlock(precond));
  }
  return out.join('');
}

function mainFields(row: IActionRow): IDetailField[] {
  const fields: IDetailField[] = [
    { label: T.fieldPlugin, value: sanitizeForTerminal(row.pluginId) },
    { label: T.fieldMode, value: sanitizeForTerminal(row.mode) },
  ];
  if (row.description !== undefined) {
    fields.push({ label: T.fieldDescription, value: sanitizeForTerminal(row.description) });
  }
  if (row.writes !== undefined && row.writes.length > 0) {
    fields.push({
      label: T.fieldWrites,
      value: row.writes.map((w) => sanitizeForTerminal(w)).join(', '),
    });
  }
  fields.push({ label: T.fieldSource, value: sanitizeForTerminal(row.source) });
  return fields;
}

/** Rows of the `Probabilistic` section; `[]` for deterministic actions. */
function probabilisticFields(
  runtime: IActionRuntime,
  action: IAction,
  row: IActionRow,
  schema: Record<string, unknown> | null,
): IDetailField[] {
  if (row.mode !== 'probabilistic') return [];
  const fields: IDetailField[] = [];
  if (row.probExpectedDurationSeconds !== undefined) {
    fields.push({
      label: T.fieldExpectedDuration,
      value: tx(T.expectedDurationValue, { n: row.probExpectedDurationSeconds }),
    });
  }
  const prompt = promptTemplateDisplay(runtime, action);
  if (prompt !== null) fields.push({ label: T.fieldPromptTemplate, value: prompt });
  const schemaValue = reportSchemaDisplay(schema);
  if (schemaValue !== null) fields.push({ label: T.fieldReportSchema, value: schemaValue });
  return fields;
}

/**
 * `inline (built-in)` for a codegen-inlined template, the conventional
 * `<dir>/prompt.md` path (relative when under cwd) for a plugin action,
 * `null` when neither source exists (row drops per §9).
 */
function promptTemplateDisplay(runtime: IActionRuntime, action: IAction): string | null {
  if (action.promptTemplate !== undefined) return T.promptTemplateInline;
  const dir = runtime.dirByAction.get(qualifiedExtensionId(action.pluginId, action.id));
  if (dir === undefined) return null;
  return relativeIfBelow(
    sanitizeForTerminal(join(dir, 'prompt.md')),
    defaultRuntimeContext().cwd,
  );
}

/**
 * Report-schema row value: the top-level `allOf` `$ref` (the schema this
 * report extends), falling back to the schema's own `$id` / `title`.
 * `null` (row drops) when the schema is unresolvable. A `summaries/`
 * ref IS the summarizer signal; no extra annotation is rendered
 * (derived traits get no fields, see the module header).
 */
function reportSchemaDisplay(schema: Record<string, unknown> | null): string | null {
  const ref = reportSchemaRefOf(schema);
  const value = ref ?? schemaIdOrTitle(schema);
  if (value === null) return null;
  return sanitizeForTerminal(value);
}

function schemaIdOrTitle(schema: Record<string, unknown> | null): string | null {
  if (schema === null) return null;
  if (typeof schema['$id'] === 'string') return schema['$id'];
  if (typeof schema['title'] === 'string') return schema['title'];
  return null;
}

/** Rows of the `Precondition` section; `[]` when none is declared. */
function preconditionFields(precondition: IActionPrecondition | undefined): IDetailField[] {
  if (!precondition) return [];
  const fields: IDetailField[] = [];
  const push = (label: string, values: string[] | undefined): void => {
    if (values === undefined || values.length === 0) return;
    fields.push({ label, value: values.map((v) => sanitizeForTerminal(v)).join(', ') });
  };
  push(T.fieldPrecondKind, precondition.kind);
  push(T.fieldPrecondProvider, precondition.provider);
  push(T.fieldPrecondAnalyzers, precondition.analyzerIds);
  return fields;
}

/** Aligned label/value rows at indent 4 (§3.3), labels padded per section. */
function renderFieldBlock(fields: IDetailField[]): string {
  const labelWidth = Math.max(...fields.map((f) => f.label.length));
  return fields
    .map((f) => tx(T.fieldRow, { label: f.label.padEnd(labelWidth), value: f.value }))
    .join('');
}
