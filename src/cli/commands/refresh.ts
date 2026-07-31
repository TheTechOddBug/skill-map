/**
 * `sm refresh <node.path>` and `sm refresh --stale`, kernel-side CLI
 * verbs for the enrichment layer (spec § A.8 + `spec/db-schema.md`
 * §state_enrichments).
 *
 * Both verbs run TWO passes against the target node(s):
 *
 *   1. **Extractors (Model B)**: re-run every applicable Extractor and
 *      upsert the outputs into `node_enrichments`. Deterministic-only,
 *      they always run for real and persist.
 *   2. **Enrichment Actions (Model A)**: execute every ENABLED Action
 *      whose report schema extends a canonical `enrichments/<kind>`
 *      schema (the enricher signal,
 *      `kernel/enrichments/enrichment-schema.ts`), in-process
 *      (`runner = 'in-process'`, execution row recorded), validating
 *      the returned report against the Action's own report schema and
 *      upserting it into `state_enrichments` keyed
 *      `(node_id, <qualified action id>)`. An Action declaring
 *      `io: ['network']` receives the injected `ctx.fetch` and is
 *      gated by the committed `allowNetworkActions` project policy
 *      (default off → skipped with a §3.1b advisory naming the key,
 *      exit stays 0). A node without the `source` + `sourceVersion`
 *      annotations an enricher consumes is a SILENT no-op skip, not a
 *      failure (`spec/cli-contract.md` §Refresh). This is the ONLY
 *      execution surface for network Actions, never `sm scan`, never a
 *      queued job.
 *
 * The verbs read the node's body off disk (the persisted scan is the
 * source of truth for `node.path` and the extractor manifest set, but the
 * extractor itself wants the live body). They do NOT trigger a full scan,
 * the rest of the graph stays untouched.
 *
 * Exit code: 0 on a clean run. Operational failures (DB missing, node
 * not found, plugin load error bubbling up) → exit 2 / 5 per
 * spec/cli-contract.md §Exit codes.
 *
 * `--stale` covers the `state_enrichments` candidates: rows whose
 * recorded `data_json.localBodyHash` drifted from the node's current
 * `scan_nodes.body_hash` (v1's only staleness signal, `stale_after`
 * stays null) plus any future policy-expired rows. Extractor (Model B)
 * writes never set `stale = 1`, so with no enrichment Actions enabled
 * the set stays empty and the verb prints the "nothing to do" advisory.
 */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import { listBuiltIns } from '../../plugins/built-ins.js';
import {
  runExtractorsForNode,
  type IEnrichmentRecord,
  type IExtractor,
  type IPersistedEnrichment,
  type Node,
  type ScanResult,
} from '../../kernel/index.js';
import type { IAction } from '../../kernel/extensions/index.js';
import type { ExecutionRecord } from '../../kernel/types.js';
import type {
  IStateEnrichmentRecord,
  IStateEnrichmentUpsert,
} from '../../kernel/types/storage.js';
import { InMemoryProgressEmitter } from '../../kernel/adapters/in-memory-progress.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { loadConfig } from '../../kernel/config/loader.js';
import { enrichmentKindOfReportSchema } from '../../kernel/enrichments/enrichment-schema.js';
import { generateExecutionId } from '../../kernel/jobs/index.js';
import { qualifiedExtensionId } from '../../kernel/registry.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { buildSettingsResolver } from '../../core/config/plugin-settings.js';
import { tx } from '../../kernel/util/tx.js';
import { REFRESH_TEXTS } from '../i18n/refresh.texts.js';
import type { IAnsi } from '../util/ansi.js';
import { resolveDbPath } from '../util/db-path.js';
import { assertNoDriftForWrite } from '../../core/sqlite/db-version-runner.js';
import { ExitCode } from '../util/exit-codes.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { assertContained } from '../../core/paths/path-guard.js';
import {
  composeScanExtensions,
  emptyPluginRuntime,
  loadPluginRuntime,
} from '../../core/runtime/plugin-runtime.js';
import { readConformanceKillSwitches } from '../util/conformance-env.js';
import { appendOperation } from '../../core/operations-log.js';
import { defaultRuntimeContext } from '../../core/runtime/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { tryWithSqlite, withSqlite } from '../../core/sqlite/with-sqlite.js';
import { buildActionDirMap } from '../../core/jobs/action-runtime.js';

/**
 * Network transport injected into declared-network enrichment Actions
 * as `ctx.fetch`. Module-level seam (same convention as the other
 * `_set*ForTests` seams across `cli/commands/`) so the CLI integration
 * tests can substitute a fake transport without monkey-patching the
 * global; production always resolves to `globalThis.fetch`.
 */
let refreshFetch: typeof globalThis.fetch = globalThis.fetch;

/** Test-only escape hatch; `null` restores the real global fetch. */
export function _setRefreshFetchForTests(impl: typeof globalThis.fetch | null): void {
  refreshFetch = impl ?? globalThis.fetch;
}

/**
 * One enabled enricher: the composed Action plus its resolved report
 * schema (a built-in's codegen-inlined `reportSchema`, or a plugin's
 * on-disk `report.schema.json`). The schema is both the enricher
 * signal (it `$ref`s a canonical `enrichments/<kind>` schema) and the
 * validation contract the returned report is checked against.
 */
interface IEnricherEntry {
  action: IAction;
  qualifiedId: string;
  schema: Record<string, unknown>;
}

/**
 * One pending Model A persistence unit collected by the enricher pass:
 * the execution row always lands; `upsert` is present only on the
 * validated-report path (a `report-invalid` failure records the
 * execution without a state row, mirroring the record path).
 */
interface IStateEnrichmentWrite {
  nodePath: string;
  execution: ExecutionRecord;
  upsert?: IStateEnrichmentUpsert;
}

/**
 * `--json` envelope per `spec/schemas/refresh-report.schema.json`.
 * Reported on stdout when `--json` is set; the human glyph + path
 * advisory is suppressed in that mode.
 */
interface IRefreshJsonEnvelope {
  ok: true;
  kind: 'refresh.report';
  refreshed: number;
  nodes: Array<{ path: string; enrichments: number }>;
  elapsedMs: number;
}

/** Error code catalog for `--json` failures (mirrors `cli-contract.md` §Error envelope). */
type TRefreshJsonErrorCode = 'not-found' | 'db-missing' | 'internal';

/**
 * `sm refresh [<node.path>] [--stale]`
 *
 * Mutex: `--stale` and the positional `<node.path>` are mutually
 * exclusive. Exactly one MUST be supplied.
 */
export class RefreshCommand extends SmCommand {
  static override paths = [['refresh']];
  static override exitCodes = [ExitCode.Ok, ExitCode.Error, ExitCode.NotFound];

  static override usage = Command.Usage({
    category: 'Scan',
    description:
      'Refresh enrichment rows: granular (single node) or batch (every stale row).',
    details: `
      Re-runs Extractors against the node(s) and upserts their outputs into
      the universal enrichment layer (\`node_enrichments\`), THEN executes
      every enabled enrichment Action (e.g. the provenance verifier
      \`github/enrichment\`) in-process, upserting its validated report
      into \`state_enrichments\`. Actions that declare network IO are
      gated by the committed \`allowNetworkActions\` project policy
      (default off: skipped with an advisory). Nodes without the
      \`source\` / \`sourceVersion\` annotations an enricher needs are
      skipped silently.

      Layer separation: enrichments live separately from the author's
      frontmatter, which is immutable from any Extractor or Action.

      Pass \`--stale\` to refresh every node carrying a stale row (a
      \`state_enrichments\` verification whose recorded body hash drifted
      from the node's current body). Pass a positional \`<node.path>\` to
      refresh just that node. The two are mutually exclusive.
    `,
    examples: [
      ['Refresh a single node', '$0 refresh .claude/agents/architect.md'],
      ['Refresh every node with stale enrichments', '$0 refresh --stale'],
    ],
  });

  nodePath = Option.String({ name: 'node', required: false });
  stale = Option.Boolean('--stale', false, {
    description:
      'Refresh every node carrying a stale enrichment row (state_enrichments body-hash drift).',
  });
  noPlugins = Option.Boolean('--no-plugins', false, {
    description: 'Skip drop-in plugin discovery; use only the built-in extractor set.',
  });

  // The remaining cyclomatic count comes from CLI ergonomics that don't
  // benefit from further extraction: argument-validation guards (2) plus
  // try/catch around extract + persist. The inner work already lives in
  // `#resolveTargetNodes` and `#runExtractorsAcrossNodes`.
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    const ansiEarly = this.ansiFor('stderr');
    const errGlyph = ansiEarly.red('✕');
    // --- argument validation ------------------------------------------------
    if (this.stale && this.nodePath !== undefined) {
      this.printer!.error(
        tx(REFRESH_TEXTS.nodeAndStaleMutex, {
          glyph: errGlyph,
          hint: ansiEarly.dim(REFRESH_TEXTS.nodeAndStaleMutexHint),
        }),
      );
      return ExitCode.Error;
    }
    if (!this.stale && this.nodePath === undefined) {
      this.printer!.error(
        tx(REFRESH_TEXTS.noTargetSpecified, {
          glyph: errGlyph,
          hint: ansiEarly.dim(REFRESH_TEXTS.noTargetSpecifiedHint),
        }),
      );
      return ExitCode.Error;
    }

    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    // Write verb: refresh inserts `state_enrichments` +
    // `state_executions` rows; refuse a drifted DB BEFORE the plugin
    // runtime loads (spec/cli-contract.md §Schema-drift rebuild).
    assertNoDriftForWrite(dbPath);

    // --- plugin runtime -----------------------------------------------------
    const pluginRuntime = this.noPlugins
      ? emptyPluginRuntime()
      : await loadPluginRuntime();
    pluginRuntime.emitWarnings(this.printer!);

    // We always want the built-in set + plugin set; refresh has no
    // `--no-built-ins` knob (refresh against an empty pipeline would
    // be a no-op, and the listBuiltIns import below keeps the registry
    // shape parity with `sm scan`).
    listBuiltIns(); // touch the built-in registry to surface load errors early.
    // Refresh re-invokes extractors + enrichment actions per node, so
    // resolved settings must reach `ctx.settings.<id>` exactly as they
    // would during `sm scan`. Load the merged config and thread its
    // settings resolver into the composer (a tolerant load: a malformed
    // layer degrades to defaults rather than aborting the refresh).
    const refreshCfg = loadConfig({ cwd: ctx.cwd }).effective;
    const resolveSettings = buildSettingsResolver(refreshCfg);
    const composed = composeScanExtensions({
      noBuiltIns: false,
      pluginRuntime,
      resolveSettings,
      killSwitches: readConformanceKillSwitches(),
    });
    const allExtractors: IExtractor[] = composed?.extractors ?? [];
    // Model A: enrichers are the ENABLED actions whose report schema
    // extends a canonical `enrichments/<kind>` schema. The
    // `allowNetworkActions` policy gate applies later, right before the
    // enricher pass, so its advisory never precedes a db-missing /
    // not-found failure.
    const enrichers = await resolveEnricherActions(
      composed?.actions ?? [],
      buildActionDirMap(pluginRuntime.discovered),
    );

    // --- load DB-resident state --------------------------------------------
    const ansi = this.ansiFor('stdout');
    const persisted = await tryWithSqlite(
      { databasePath: dbPath, autoBackup: false },
      async (adapter) => {
        const result = await adapter.scans.load();
        const enrichments = await adapter.scans.loadNodeEnrichments();
        const staleState = await adapter.enrichments.listStaleStateCandidates(Date.now());
        return { result, enrichments, staleState };
      },
    );
    if (!persisted) {
      // `tryWithSqlite` returns `null` when the project DB file is
      // absent, which is a `db-missing` failure for `--json` consumers.
      // The human path keeps its original "node not found" framing
      // since the user sees the same advisory regardless of whether
      // the DB is missing or the node is.
      if (this.json) {
        this.#emitJsonError('db-missing', tx(REFRESH_TEXTS.jsonErrorDbMissing));
        return ExitCode.NotFound;
      }
      this.printer!.error(
        tx(REFRESH_TEXTS.nodeNotFound, {
          glyph: ansi.red('✕'),
          nodePath: this.nodePath ?? '<stale>',
          hint: ansi.dim(REFRESH_TEXTS.nodeNotFoundHint),
        }),
      );
      return ExitCode.NotFound;
    }

    // --- decide target nodes -----------------------------------------------
    const targetResult = this.#resolveTargetNodes(persisted, ansi);
    if (!targetResult.ok) return targetResult.exitCode;
    const targetNodes = targetResult.nodes;

    // --- run extractors per node -------------------------------------------
    let freshEnrichmentsByNode: Array<{ path: string; enrichments: IEnrichmentRecord[] }>;
    try {
      freshEnrichmentsByNode = await this.#runExtractorsAcrossNodes(targetNodes, allExtractors, ctx.cwd);
    } catch (err) {
      const message = formatErrorMessage(err);
      if (this.json) {
        this.#emitJsonError('internal', message);
        return ExitCode.Error;
      }
      this.printer!.error(tx(REFRESH_TEXTS.refreshFailed, { glyph: errGlyph, message }));
      return ExitCode.Error;
    }

    const freshEnrichments: IEnrichmentRecord[] = freshEnrichmentsByNode.flatMap((n) => n.enrichments);

    // --- run enrichment actions per node (Model A) ---------------------------
    // Policy gate first (skip advisory naming `allowNetworkActions`,
    // exit stays 0), then the pass. Never throws: an action throw /
    // invalid report degrades to a warn advisory (the pass collects
    // what DID succeed), remote failures are valid `verified: false`
    // reports by the action contract.
    const gatedEnrichers = this.#applyNetworkPolicyGate(
      enrichers,
      refreshCfg.allowNetworkActions === true,
    );
    const stateWrites = await this.#runEnrichersAcrossNodes(
      targetNodes,
      gatedEnrichers,
      resolveSettings,
      ctx.cwd,
    );

    // --- persist fresh enrichments + state rows ------------------------------
    // One transaction: Model B upserts, Model A state rows, and their
    // execution siblings commit together (the state row + execution pair
    // mirrors the summaries fold inside the record transaction).
    if (freshEnrichments.length > 0 || stateWrites.length > 0) {
      try {
        await withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
          await adapter.transaction(async (txStore) => {
            if (freshEnrichments.length > 0) {
              await txStore.enrichments.upsertMany(freshEnrichments);
            }
            for (const write of stateWrites) {
              if (write.upsert) await txStore.enrichments.upsertState(write.upsert);
              await txStore.history.insertExecution(write.execution);
            }
          });
        });
      } catch (err) {
        const message = formatErrorMessage(err);
        if (this.json) {
          this.#emitJsonError('internal', message);
          return ExitCode.Error;
        }
        this.printer!.error(
          tx(REFRESH_TEXTS.refreshFailed, { glyph: errGlyph, message }),
        );
        return ExitCode.Error;
      }
    }

    // --- final result line --------------------------------------------------
    // State rows fold into `refreshed` + the per-node counts (the
    // refresh-report envelope keeps its shape, `spec/cli-contract.md`
    // §Refresh); only VALIDATED reports count (a report-invalid
    // execution persists nothing user-visible here).
    const stateUpsertsByNode = new Map<string, number>();
    for (const write of stateWrites) {
      if (!write.upsert) continue;
      stateUpsertsByNode.set(write.nodePath, (stateUpsertsByNode.get(write.nodePath) ?? 0) + 1);
    }
    const totalRefreshed =
      freshEnrichments.length + [...stateUpsertsByNode.values()].reduce((a, b) => a + b, 0);

    // §Operations log: refresh mutates `node_enrichments` /
    // `state_enrichments`, same machine-output surface as a scan pass.
    appendOperation(defaultRuntimeContext().cwd, {
      op: 'refresh',
      target: this.nodePath ?? '*',
      channel: 'cli',
      outcome: 'ok',
      detail: `refreshed=${totalRefreshed}`,
    });

    if (this.json) {
      const envelope: IRefreshJsonEnvelope = {
        ok: true,
        kind: 'refresh.report',
        refreshed: totalRefreshed,
        nodes: freshEnrichmentsByNode.map((n) => ({
          path: n.path,
          enrichments: n.enrichments.length + (stateUpsertsByNode.get(n.path) ?? 0),
        })),
        elapsedMs: this.elapsed!.ms(),
      };
      this.printer!.data(JSON.stringify(envelope) + '\n');
      return ExitCode.Ok;
    }

    const glyph = ansi.green('✓');
    const count = totalRefreshed;
    const noun = count === 1
      ? REFRESH_TEXTS.refreshNounSingular
      : REFRESH_TEXTS.refreshNounPlural;
    if (this.stale) {
      const nodeCount = targetNodes.length;
      const nodeNoun = nodeCount === 1
        ? REFRESH_TEXTS.refreshNodeNounSingular
        : REFRESH_TEXTS.refreshNodeNounPlural;
      this.printer!.data(
        tx(REFRESH_TEXTS.refreshSuccessStale, {
          glyph, count, noun, nodeCount, nodeNoun,
        }),
      );
    } else {
      this.printer!.data(
        tx(REFRESH_TEXTS.refreshSuccessSingle, {
          glyph, count, noun, nodePath: this.nodePath!,
        }),
      );
    }

    return ExitCode.Ok;
  }

  /**
   * Emit the canonical `--json` error envelope on stdout. Mirrors the
   * shape from `cli-contract.md` §Error envelope. Suppresses the
   * human-facing glyph + hint output that the non-JSON branches still
   * render.
   */
  #emitJsonError(code: TRefreshJsonErrorCode, message: string): void {
    const payload = { ok: false as const, error: { code, message } };
    this.printer!.data(JSON.stringify(payload) + '\n');
  }

  /**
   * Decide which nodes the verb should refresh based on `--stale` /
   * `<nodePath>`. Writes the per-target advisory to stdout (or the
   * not-found / nothing-to-do message). Returns either the target list
   * or the exit code the caller should use.
   *
   * Complexity is from the two-axis branch (stale-vs-single x
   * json-vs-human) plus the two terminal branches inside each axis.
   * Further extraction would split the method per axis but lose the
   * tight `nodesByPath.get(...)` reuse that drives both paths.
   */
  // eslint-disable-next-line complexity
  #resolveTargetNodes(
    persisted: {
      result: ScanResult;
      enrichments: IPersistedEnrichment[];
      staleState: IStateEnrichmentRecord[];
    },
    ansi: IAnsi,
  ): { ok: true; nodes: Node[] } | { ok: false; exitCode: number } {
    const nodesByPath = new Map<string, Node>();
    for (const node of persisted.result.nodes) nodesByPath.set(node.path, node);

    if (this.stale) {
      // The stale set unions both models: Model B rows flagged stale
      // (never happens in this revision, Extractors are deterministic)
      // and Model A `state_enrichments` candidates (body-hash drift /
      // policy expiry, computed SQL-side by the adapter).
      const staleEnrichments = persisted.enrichments.filter((e) => e.stale);
      if (staleEnrichments.length === 0 && persisted.staleState.length === 0) {
        if (this.json) {
          const envelope: IRefreshJsonEnvelope = {
            ok: true,
            kind: 'refresh.report',
            refreshed: 0,
            nodes: [],
            elapsedMs: this.elapsed!.ms(),
          };
          this.printer!.data(JSON.stringify(envelope) + '\n');
          return { ok: false, exitCode: ExitCode.Ok };
        }
        // Terminal "nothing to do" message, the answer to the user's
        // request, stays on stdout.
        this.printer!.data(
          tx(REFRESH_TEXTS.refreshSuccessNoStale, { glyph: ansi.green('✓') }),
        );
        return { ok: false, exitCode: ExitCode.Ok };
      }
      const stalePaths = new Set(staleEnrichments.map((e) => e.nodePath));
      for (const row of persisted.staleState) stalePaths.add(row.nodeId);
      const nodes: Node[] = [];
      for (const path of stalePaths) {
        const node = nodesByPath.get(path);
        if (node) nodes.push(node);
      }
      return { ok: true, nodes };
    }

    const node = nodesByPath.get(this.nodePath!);
    if (!node) {
      if (this.json) {
        this.#emitJsonError(
          'not-found',
          tx(REFRESH_TEXTS.jsonErrorNodeNotFound, { nodePath: this.nodePath! }),
        );
        return { ok: false, exitCode: ExitCode.NotFound };
      }
      this.printer!.error(
        tx(REFRESH_TEXTS.nodeNotFound, {
          glyph: ansi.red('✕'),
          nodePath: this.nodePath!,
          hint: ansi.dim(REFRESH_TEXTS.nodeNotFoundHint),
        }),
      );
      return { ok: false, exitCode: ExitCode.NotFound };
    }
    return { ok: true, nodes: [node] };
  }

  /**
   * For each target node: read its body off disk, run every applicable
   * Extractor (deterministic-only by spec), and collect the enrichment
   * records they produce. Returns one entry per node (in iteration
   * order) so the verb's `--json` envelope can report a per-node
   * breakdown; consumers that only care about the flat list flatten
   * the result.
   */
  async #runExtractorsAcrossNodes(
    targetNodes: Node[],
    allExtractors: IExtractor[],
    cwd: string,
  ): Promise<Array<{ path: string; enrichments: IEnrichmentRecord[] }>> {
    const perNode: Array<{ path: string; enrichments: IEnrichmentRecord[] }> = [];

    for (const node of targetNodes) {
      const nodeEnrichments: IEnrichmentRecord[] = [];
      let body: string;
      try {
        // Defence in depth (audit M8): reject `node.path` rows that are
        // absolute or escape `cwd` BEFORE resolving + reading. A manually-
        // tampered DB row could otherwise route this read at any file
        // the user can open.
        assertContained(cwd, node.path);
        // Async read inside a sequential per-node loop. Today the loop
        // body still serializes (the extractor pass is awaited per
        // node), but routing the read through `fs/promises` lets the
        // event loop overlap any concurrent kernel work and keeps the
        // door open for a future parallel-by-node refresh without a
        // second sweep.
        const raw = await readFile(resolve(cwd, node.path), 'utf8');
        body = stripFrontmatterFence(raw);
      } catch (err) {
        if (!this.json) {
          const ansi = this.ansiFor('stderr');
          this.printer!.info(
            tx(REFRESH_TEXTS.refreshFailed, {
              glyph: ansi.red('✕'),
              message: tx(REFRESH_TEXTS.readFailedDetail, {
                path: node.path,
                message: formatErrorMessage(err),
              }),
            }),
          );
        }
        perNode.push({ path: node.path, enrichments: nodeEnrichments });
        continue;
      }
      const fm = (node.frontmatter ?? {}) as Record<string, unknown>;
      const applicable = allExtractors.filter((ex) => {
        const kinds = ex.precondition?.kind;
        if (!kinds || kinds.length === 0) return true;
        return kinds.some((qualified) => {
          const slashIdx = qualified.indexOf('/');
          const kindOnly = slashIdx === -1 ? qualified : qualified.slice(slashIdx + 1);
          return kindOnly === node.kind;
        });
      });
      for (const extractor of applicable) {
        const records = await runExtractorForEnrichment(extractor, node, body, fm);
        for (const record of records) nodeEnrichments.push(record);
      }
      perNode.push({ path: node.path, enrichments: nodeEnrichments });
    }

    return perNode;
  }

  /**
   * The `allowNetworkActions` policy gate (`spec/cli-contract.md`
   * §Refresh): an enabled enricher declaring `io: ['network']` is
   * refused at execution while the committed project policy is off,
   * with a §3.1b advisory naming the key. One advisory per skipped
   * action (not per node); the exit code stays 0, the manifest keeps
   * loading and listing everywhere else.
   */
  #applyNetworkPolicyGate(
    enrichers: IEnricherEntry[],
    allowNetworkActions: boolean,
  ): IEnricherEntry[] {
    const survivors: IEnricherEntry[] = [];
    const ansi = this.ansiFor('stderr');
    for (const enricher of enrichers) {
      const needsNetwork = enricher.action.io?.includes('network') === true;
      if (needsNetwork && !allowNetworkActions) {
        this.printer!.info(
          tx(REFRESH_TEXTS.networkActionsPolicySkip, {
            glyph: ansi.yellow('•'),
            actionId: sanitizeForTerminal(enricher.qualifiedId),
            hint: ansi.dim(REFRESH_TEXTS.networkActionsPolicySkipHint),
          }),
        );
        continue;
      }
      survivors.push(enricher);
    }
    return survivors;
  }

  /**
   * Model A pass: for each `(node, enricher)` pair that survives the
   * gates, invoke the Action in-process, validate its report against
   * the Action's own report schema, and collect the pending
   * `state_enrichments` upsert + `state_executions` row for the caller
   * to persist in one transaction.
   *
   * Gates, in order:
   *   1. declarative `precondition` (kind / provider), same matching
   *      the extractor pass applies;
   *   2. provenance annotations: a node without both `source` AND
   *      `sourceVersion` is a SILENT no-op skip per the contract
   *      (not a failure, nothing recorded);
   *   3. `invoke` present (an enricher shipped for a future runner is
   *      skipped silently).
   *
   * Failure posture: an `invoke()` throw is an action defect (remote
   * failures must come back as `verified: false` reports), warn +
   * nothing recorded; a schema-invalid report records a FAILED
   * execution (`report-invalid`, mirroring the record path) with no
   * state row.
   */
  async #runEnrichersAcrossNodes(
    targetNodes: Node[],
    enrichers: IEnricherEntry[],
    resolveSettings: (ext: { pluginId: string; id: string }) => Record<string, unknown>,
    cwd: string,
  ): Promise<IStateEnrichmentWrite[]> {
    if (enrichers.length === 0) return [];
    const validators = loadSchemaValidators();
    const writes: IStateEnrichmentWrite[] = [];
    for (const node of targetNodes) {
      if (!nodeHasProvenanceAnnotations(node)) continue;
      for (const enricher of enrichers) {
        if (!actionPreconditionMatches(enricher.action, node)) continue;
        const write = await this.#invokeEnricher(enricher, node, resolveSettings, validators, cwd);
        if (write !== null) writes.push(write);
      }
    }
    return writes;
  }

  /**
   * Invoke one enricher against one node and translate the outcome into
   * a pending persistence unit (`null` = nothing to record). `ctx.fetch`
   * is injected ONLY for declared-network actions (the purity carve-out,
   * `spec/architecture.md`); everything else sees the standard pure
   * context.
   */
  async #invokeEnricher(
    enricher: IEnricherEntry,
    node: Node,
    resolveSettings: (ext: { pluginId: string; id: string }) => Record<string, unknown>,
    validators: ReturnType<typeof loadSchemaValidators>,
    cwd: string,
  ): Promise<IStateEnrichmentWrite | null> {
    const { action, qualifiedId, schema } = enricher;
    if (typeof action.invoke !== 'function') return null;
    try {
      // Same defence-in-depth as the extractor pass (audit M8): a
      // tampered `node.path` row must not compose an out-of-tree
      // absolute path into the action context.
      assertContained(cwd, node.path);
    } catch {
      return null;
    }

    const startedAt = Date.now();
    const ctx: Parameters<NonNullable<IAction['invoke']>>[1] = {
      node,
      nodeAbsolutePath: resolve(cwd, node.path),
      invoker: 'cli',
      now: () => new Date(),
      settings: resolveSettings(action),
    };
    if (action.io?.includes('network') === true) ctx.fetch = refreshFetch;

    let report: unknown;
    try {
      const result = await action.invoke({}, ctx);
      report = result.report;
    } catch (err) {
      this.#warnEnricher(REFRESH_TEXTS.enricherInvokeFailed, {
        actionId: sanitizeForTerminal(qualifiedId),
        nodePath: sanitizeForTerminal(node.path),
        message: sanitizeForTerminal(formatErrorMessage(err)),
      });
      return null;
    }
    const finishedAt = Date.now();

    const validation = validators.validateActionReport(schema, report);
    if (!validation.ok) {
      this.#warnEnricher(REFRESH_TEXTS.enricherReportInvalid, {
        actionId: sanitizeForTerminal(qualifiedId),
        nodePath: sanitizeForTerminal(node.path),
        errors: sanitizeForTerminal(validation.errors),
      });
      return {
        nodePath: node.path,
        execution: buildEnricherExecution(enricher, node, {
          status: 'failed',
          failureReason: 'report-invalid',
          startedAt,
          finishedAt,
          reportJson: null,
        }),
      };
    }

    const reportJson = JSON.stringify(report);
    const verifiedRaw = (report as Record<string, unknown>)['verified'];
    return {
      nodePath: node.path,
      execution: buildEnricherExecution(enricher, node, {
        status: 'completed',
        failureReason: null,
        startedAt,
        finishedAt,
        reportJson,
      }),
      upsert: {
        nodeId: node.path,
        providerId: qualifiedId,
        dataJson: reportJson,
        // `verified` lifted from the report when it carries a boolean
        // verdict (`spec/db-schema.md` §state_enrichments); null keeps
        // the column tri-state for report shapes without one.
        verified: typeof verifiedRaw === 'boolean' ? verifiedRaw : null,
        fetchedAt: finishedAt,
        // v1: no declared refresh policy, body-hash drift is the only
        // staleness signal.
        staleAfter: null,
      },
    };
  }

  /** Warn-channel advisory for a degraded enricher outcome. */
  #warnEnricher(template: string, vars: Record<string, string>): void {
    const ansi = this.ansiFor('stderr');
    this.printer!.warn(tx(template, { glyph: ansi.yellow('•'), ...vars }));
  }
}

/**
 * Run a single Extractor against a node and return the enrichment records
 * it produced. Mirrors the orchestrator's per-(node, extractor) collection
 * step but is deliberately lighter, there is no link emission here, no
 * external pseudo-link partitioning, no scan-cache bookkeeping.
 *
 * Multiple `enrichNode` calls within the same `extract(ctx)` invocation
 * fold into a single record's `value` (last-write-wins per field), which
 * matches the orchestrator's contract.
 *
 * Exported for the test suite so it can drive a probe extractor directly
 * without bringing the whole CLI surface online.
 */
export async function runExtractorForEnrichment(
  extractor: IExtractor,
  node: Node,
  body: string,
  frontmatter: Record<string, unknown>,
): Promise<IEnrichmentRecord[]> {
  // Delegate to the kernel's shared loop (audit item V4, refresh used
  // to hand-duplicate the extract-and-fold dance). Refresh stays scoped
  // to the enrichment layer, so emitted links are discarded; the
  // emitter is a throwaway in-memory instance because refresh doesn't
  // expose progress events.
  const result = await runExtractorsForNode({
    extractors: [extractor],
    node,
    body,
    frontmatter,
    bodyHash: node.bodyHash,
    emitter: new InMemoryProgressEmitter(),
  });
  return result.enrichments;
}


/**
 * Resolve the enabled enrichers out of the composed action catalog: an
 * action is an enricher when its report schema (a plugin's on-disk
 * `report.schema.json`, or a built-in's codegen-inlined `reportSchema`)
 * `$ref`s a canonical `enrichments/<kind>` schema
 * (`kernel/enrichments/enrichment-schema.ts`), the mirror of the
 * summarizer detection. An unreadable / unparseable on-disk schema
 * simply keeps the action out of the enricher set (the plugin doctor
 * surface owns schema diagnostics; refresh must not crash on it).
 */
async function resolveEnricherActions(
  actions: readonly IAction[],
  dirByAction: Map<string, string>,
): Promise<IEnricherEntry[]> {
  const out: IEnricherEntry[] = [];
  for (const action of actions) {
    const qualifiedId = qualifiedExtensionId(action.pluginId, action.id);
    const schema = await resolveActionReportSchema(action, dirByAction.get(qualifiedId));
    if (schema === null) continue;
    if (enrichmentKindOfReportSchema(schema) === null) continue;
    out.push({ action, qualifiedId, schema });
  }
  return out;
}

/**
 * An action's report schema: the on-disk `report.schema.json` for a
 * plugin action (its directory is in the dir map), the codegen-inlined
 * `reportSchema` for a built-in. `null` when neither resolves.
 */
async function resolveActionReportSchema(
  action: IAction,
  dir: string | undefined,
): Promise<Record<string, unknown> | null> {
  if (dir !== undefined) {
    try {
      return JSON.parse(
        await readFile(join(dir, 'report.schema.json'), 'utf8'),
      ) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (action.reportSchema && typeof action.reportSchema === 'object') {
    return action.reportSchema;
  }
  return null;
}

/**
 * The provenance-annotation gate: enrichers consume the `source` +
 * `sourceVersion` sidecar annotations
 * (`spec/schemas/annotations.schema.json`), so a node carrying neither
 * (or blank values) is a silent no-op skip per the contract, NOT a
 * failure. v1 gates on this fixed pair because the canonical
 * enrichments namespace has a single shape (`github`); a future second
 * shape moves the needed-annotations declaration onto the manifest.
 */
function nodeHasProvenanceAnnotations(node: Node): boolean {
  const annotations = (node.sidecar?.annotations ?? {}) as Record<string, unknown>;
  const source = annotations['source'];
  const version = annotations['sourceVersion'];
  return (
    typeof source === 'string' &&
    source.length > 0 &&
    typeof version === 'string' &&
    version.length > 0
  );
}

/**
 * Declarative `precondition` match for the enricher pass. Kind entries
 * are qualified (`<provider-plugin>/<kindName>`); like the extractor
 * filter above, the comparison is against the kind tail. Provider
 * entries match `node.provider` verbatim. No precondition → universal.
 */
function actionPreconditionMatches(action: IAction, node: Node): boolean {
  const pre = action.precondition;
  if (!pre) return true;
  if (pre.kind && pre.kind.length > 0) {
    const kindMatches = pre.kind.some((qualified) => {
      const slashIdx = qualified.indexOf('/');
      const kindOnly = slashIdx === -1 ? qualified : qualified.slice(slashIdx + 1);
      return kindOnly === node.kind;
    });
    if (!kindMatches) return false;
  }
  if (pre.provider && pre.provider.length > 0 && !pre.provider.includes(node.provider)) {
    return false;
  }
  return true;
}

/**
 * Compose the `state_executions` row for one in-process enricher
 * invocation. Mirrors the record path's row shape (`record-outcome.ts`)
 * with the Model A specifics: `runner: 'in-process'`, no job, no
 * content hash, wall-clock duration measured around the invocation.
 */
function buildEnricherExecution(
  enricher: IEnricherEntry,
  node: Node,
  opts: {
    status: 'completed' | 'failed';
    failureReason: 'report-invalid' | null;
    startedAt: number;
    finishedAt: number;
    reportJson: string | null;
  },
): ExecutionRecord {
  return {
    id: generateExecutionId(),
    kind: 'action',
    extensionId: enricher.qualifiedId,
    extensionVersion: enricher.action.version,
    nodeIds: [node.path],
    contentHash: null,
    status: opts.status,
    failureReason: opts.failureReason,
    exitCode: null,
    runner: 'in-process',
    startedAt: opts.startedAt,
    finishedAt: opts.finishedAt,
    durationMs: opts.finishedAt - opts.startedAt,
    tokensIn: null,
    tokensOut: null,
    // Domain field name; storage bridges it to the report_json column.
    reportPath: opts.reportJson,
    jobId: null,
  };
}

/**
 * Strip a leading YAML frontmatter fence from `text`. Mirrors the
 * Provider's regex (`^---\r?\n[\s\S]*?\r?\n---\r?\n?`); if the close
 * fence is missing or the prefix is malformed, the helper returns the
 * original text unchanged, same fall-through as the Provider, where the
 * malformed-frontmatter extractor is responsible for surfacing the issue.
 */
function stripFrontmatterFence(text: string): string {
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return text;
  return text.slice(match[0].length);
}

/** Aggregate export so `entry.ts` can register the refresh verb in one line. */
export const REFRESH_COMMANDS = [RefreshCommand];
