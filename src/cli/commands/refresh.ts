/**
 * `sm refresh <node.path>` and `sm refresh --stale` — kernel-side CLI
 * verbs for the universal enrichment layer (spec § A.8).
 *
 * Both verbs re-run Extractors against either a single node or the set of
 * nodes carrying at least one stale enrichment row, persisting the fresh
 * outputs back into `node_enrichments`. Extractors are deterministic-only,
 * so they always run for real and persist.
 *
 * The verbs read the node's body off disk (the persisted scan is the
 * source of truth for `node.path` and the extractor manifest set, but the
 * extractor itself wants the live body). They do NOT trigger a full scan —
 * the rest of the graph stays untouched.
 *
 * Exit code: 0 on a clean run. Operational failures (DB missing, node
 * not found, plugin load error bubbling up) → exit 2 / 5 per
 * spec/cli-contract.md §Exit codes.
 *
 * `--stale` is a no-op in this revision: with Extractors deterministic-only
 * no enrichment row is ever stale-flagged, so the verb always prints a
 * "nothing to do" advisory and exits 0. The flag is preserved for the
 * future Action-issued probabilistic enrichment revision (queued LLM
 * jobs that must preserve paid output across body changes) — see
 * spec `architecture.md` §Extractor · enrichment layer.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import { listBuiltIns } from '../../built-in-plugins/built-ins.js';
import {
  runExtractorsForNode,
  type IEnrichmentRecord,
  type IExtractor,
  type IPersistedEnrichment,
  type Node,
  type ScanResult,
} from '../../kernel/index.js';
import { InMemoryProgressEmitter } from '../../kernel/adapters/in-memory-progress.js';
import { tx } from '../../kernel/util/tx.js';
import { REFRESH_TEXTS } from '../i18n/refresh.texts.js';
import { ansiFor, type IAnsi } from '../util/ansi.js';
import { defaultProjectDbPath } from '../util/db-path.js';
import { ExitCode } from '../util/exit-codes.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { assertContained } from '../util/path-guard.js';
import {
  composeScanExtensions,
  emptyPluginRuntime,
  loadPluginRuntime,
} from '../util/plugin-runtime.js';
import { readConformanceKillSwitches } from '../util/conformance-env.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { tryWithSqlite, withSqlite } from '../util/with-sqlite.js';

/**
 * `sm refresh [<node.path>] [--stale]`
 *
 * Mutex: `--stale` and the positional `<node.path>` are mutually
 * exclusive. Exactly one MUST be supplied.
 */
export class RefreshCommand extends SmCommand {
  static override paths = [['refresh']];

  static override usage = Command.Usage({
    category: 'Scan',
    description:
      'Refresh enrichment rows: granular (single node) or batch (every stale row).',
    details: `
      Re-runs Extractors against the node(s) and upserts their outputs into
      the universal enrichment layer (\`node_enrichments\`). Extractors are
      deterministic-only — they always run for real and persist.

      Layer separation: enrichments live separately from the author's
      frontmatter, which is immutable from any Extractor.

      Pass \`--stale\` to refresh every node carrying a stale row. Pass a
      positional \`<node.path>\` to refresh just that node. The two are
      mutually exclusive. \`--stale\` is a no-op in this revision (no row
      is stale-flagged); it is preserved for the future Action-issued
      probabilistic enrichment revision.
    `,
    examples: [
      ['Refresh a single node', '$0 refresh .claude/agents/architect.md'],
      ['Refresh every node with stale enrichments', '$0 refresh --stale'],
    ],
  });

  nodePath = Option.String({ name: 'node', required: false });
  stale = Option.Boolean('--stale', false, {
    description:
      'Refresh every node carrying a stale enrichment row (no-op in this revision; reserved for future Action-prob enrichments).',
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
    const stderrEarly = this.context.stderr as NodeJS.WriteStream;
    const ansiEarly = ansiFor({ isTTY: stderrEarly.isTTY === true, noColorFlag: this.noColor });
    const errGlyph = ansiEarly.red('✕');
    // --- argument validation ------------------------------------------------
    if (this.stale && this.nodePath !== undefined) {
      this.printer!.info(tx(REFRESH_TEXTS.nodeAndStaleMutex, { glyph: errGlyph }));
      return ExitCode.Error;
    }
    if (!this.stale && this.nodePath === undefined) {
      this.printer!.info(tx(REFRESH_TEXTS.noTargetSpecified, { glyph: errGlyph }));
      return ExitCode.Error;
    }

    const ctx = defaultRuntimeContext();
    const dbPath = defaultProjectDbPath(ctx);

    // --- plugin runtime -----------------------------------------------------
    const pluginRuntime = this.noPlugins
      ? emptyPluginRuntime()
      : await loadPluginRuntime({ scope: 'project' });
    pluginRuntime.emitWarnings(this.printer!);

    // We always want the built-in set + plugin set; refresh has no
    // `--no-built-ins` knob (refresh against an empty pipeline would
    // be a no-op, and the listBuiltIns import below keeps the registry
    // shape parity with `sm scan`).
    listBuiltIns(); // touch the built-in registry to surface load errors early.
    const composed = composeScanExtensions({
      noBuiltIns: false,
      pluginRuntime,
      killSwitches: readConformanceKillSwitches(),
    });
    const allExtractors: IExtractor[] = composed?.extractors ?? [];

    // --- load DB-resident state --------------------------------------------
    const stdout = this.context.stdout as NodeJS.WriteStream;
    const ansi = ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: this.noColor });
    const persisted = await tryWithSqlite(
      { databasePath: dbPath, autoBackup: false },
      async (adapter) => {
        const result = await adapter.scans.load();
        const enrichments = await adapter.scans.loadNodeEnrichments();
        return { result, enrichments };
      },
    );
    if (!persisted) {
      this.printer!.info(
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
    let freshEnrichments: IEnrichmentRecord[];
    try {
      freshEnrichments = await this.#runExtractorsAcrossNodes(targetNodes, allExtractors, ctx.cwd);
    } catch (err) {
      const message = formatErrorMessage(err);
      this.printer!.info(tx(REFRESH_TEXTS.refreshFailed, { glyph: errGlyph, message }));
      return ExitCode.Error;
    }

    // --- persist fresh enrichments -----------------------------------------
    if (freshEnrichments.length > 0) {
      try {
        await withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
          await adapter.transaction(async (txStore) => {
            await txStore.enrichments.upsertMany(freshEnrichments);
          });
        });
      } catch (err) {
        const message = formatErrorMessage(err);
        this.printer!.info(tx(REFRESH_TEXTS.refreshFailed, { message }));
        return ExitCode.Error;
      }
    }

    // --- final result line --------------------------------------------------
    const glyph = ansi.green('✓');
    const count = freshEnrichments.length;
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
   * Decide which nodes the verb should refresh based on `--stale` /
   * `<nodePath>`. Writes the per-target advisory to stdout (or the
   * not-found / nothing-to-do message). Returns either the target list
   * or the exit code the caller should use.
   */
  #resolveTargetNodes(
    persisted: { result: ScanResult; enrichments: IPersistedEnrichment[] },
    ansi: IAnsi,
  ): { ok: true; nodes: Node[] } | { ok: false; exitCode: number } {
    const nodesByPath = new Map<string, Node>();
    for (const node of persisted.result.nodes) nodesByPath.set(node.path, node);

    if (this.stale) {
      const staleEnrichments = persisted.enrichments.filter((e) => e.stale);
      if (staleEnrichments.length === 0) {
        // Terminal "nothing to do" message — the answer to the user's
        // request — stays on stdout.
        this.printer!.data(
          tx(REFRESH_TEXTS.refreshSuccessNoStale, { glyph: ansi.green('✓') }),
        );
        return { ok: false, exitCode: ExitCode.Ok };
      }
      const stalePaths = new Set(staleEnrichments.map((e) => e.nodePath));
      const nodes: Node[] = [];
      for (const path of stalePaths) {
        const node = nodesByPath.get(path);
        if (node) nodes.push(node);
      }
      return { ok: true, nodes };
    }

    const node = nodesByPath.get(this.nodePath!);
    if (!node) {
      this.printer!.info(
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
   * records they produce.
   */
  async #runExtractorsAcrossNodes(
    targetNodes: Node[],
    allExtractors: IExtractor[],
    cwd: string,
  ): Promise<IEnrichmentRecord[]> {
    const freshEnrichments: IEnrichmentRecord[] = [];

    for (const node of targetNodes) {
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
        const stderr = this.context.stderr as NodeJS.WriteStream;
        const ansi = ansiFor({ isTTY: stderr.isTTY === true, noColorFlag: this.noColor });
        this.printer!.info(
          tx(REFRESH_TEXTS.refreshFailed, {
            glyph: ansi.red('✕'),
            message: tx(REFRESH_TEXTS.readFailedDetail, {
              path: node.path,
              message: formatErrorMessage(err),
            }),
          }),
        );
        continue;
      }
      const fm = (node.frontmatter ?? {}) as Record<string, unknown>;
      const applicable = allExtractors.filter(
        (ex) => ex.applicableKinds === undefined || ex.applicableKinds.includes(node.kind),
      );
      for (const extractor of applicable) {
        const records = await runExtractorForEnrichment(extractor, node, body, fm);
        for (const record of records) freshEnrichments.push(record);
      }
    }

    return freshEnrichments;
  }
}

/**
 * Run a single Extractor against a node and return the enrichment records
 * it produced. Mirrors the orchestrator's per-(node, extractor) collection
 * step but is deliberately lighter — there is no link emission here, no
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
  // Delegate to the kernel's shared loop (audit item V4 — refresh used
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
 * Strip a leading YAML frontmatter fence from `text`. Mirrors the
 * Provider's regex (`^---\r?\n[\s\S]*?\r?\n---\r?\n?`); if the close
 * fence is missing or the prefix is malformed, the helper returns the
 * original text unchanged — same fall-through as the Provider, where the
 * malformed-frontmatter extractor is responsible for surfacing the issue.
 */
function stripFrontmatterFence(text: string): string {
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return text;
  return text.slice(match[0].length);
}

/** Aggregate export so `entry.ts` can register the refresh verb in one line. */
export const REFRESH_COMMANDS = [RefreshCommand];
