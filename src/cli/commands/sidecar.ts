/**
 * `sm sidecars refresh <node-path>`
 * `sm sidecars prune [--dry-run]`
 * `sm sidecars annotate <node-path> [--force]`
 *
 * Step 9.6.4 (Decision A1). Administrative verbs around the sidecar
 * `.sm` files. Each is a thin wrapper:
 *
 *   - `refresh` , refreshes `for.{bodyHash, frontmatterHash}` only.
 *     Does NOT bump `annotations.version`, does NOT touch the audit
 *     block. Useful when the user knows a body change is editorial
 *     and they don't want to spend a version increment.
 *   - `prune`   , deletes orphan `.sm` files (those whose `<base>.md`
 *     no longer exists). `--dry-run` reports what would be deleted
 *     without touching disk.
 *   - `annotate`, pure scaffolding: creates an empty `.sm` next to
 *     the `.md` ready for editing. Per Decision A4 the
 *     `--from-frontmatter` migration helper is OUT of 9.6.4.
 *
 * `sm sidecars refresh` is intentionally distinct from `sm enrich`
 * (the Step A.8 enrichment-layer verb that re-runs Extractors), same
 * verb stem, different concept; the sub-namespace prefix keeps the
 * two from colliding.
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok
 *   1  prune surfaced delete failures
 *   2  operational failure (write error, etc.)
 *   5  node not in persisted scan / sidecar missing
 */

import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import { EConsentRequiredError, ensureSidecarWritesAllowed } from '../../core/config/sidecar-consent.js';
import { sidecarPathFor } from '../../kernel/sidecar/parse.js';
import { discoverOrphanSidecars } from '../../kernel/sidecar/discover-orphans.js';
import { FilesystemSidecarStore } from '../../kernel/sidecar/store.js';
import type { Node } from '../../kernel/types.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { pluralSuffix } from '../../kernel/util/text.js';
import { tx } from '../../kernel/util/tx.js';
import type { IAnsi } from '../util/ansi.js';
import { CONSENT_TEXTS } from '../i18n/consent.texts.js';
import { SIDECAR_TEXTS } from '../i18n/sidecar.texts.js';
import { confirm } from '../util/confirm.js';
import { resolveDbPath } from '../util/db-path.js';
import { ExitCode } from '../util/exit-codes.js';
import { pathExists } from '../util/fs.js';
import { assertContained } from '../../core/paths/path-guard.js';
import { defaultRuntimeContext } from '../../core/runtime/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { tryWithSqlite } from '../../core/sqlite/with-sqlite.js';

// --- shared consent wrapper ----------------------------------------------

/**
 * Bag the consent wrapper needs to surface the prompt. Exposed as a
 * struct instead of `this`-passing because two sibling commands
 * (`SidecarEnrichCommand`, `SidecarAnnotateCommand`) share the same
 * gate without a common subclass, and `protected printer` would not
 * be reachable from a free function. Each command's own method
 * forwards the live values.
 */
interface ISidecarConsentBag {
  stdin: NodeJS.ReadStream;
  stderr: NodeJS.WriteStream;
  yes: boolean;
  onAccept: () => void;
  printInfo: (s: string) => void;
  printError: (s: string) => void;
}

/**
 * Wrap a single sidecar-writing dispatch with the `.sm` consent gate:
 * on `EConsentRequiredError`, prompt the operator if stdin is a TTY
 * and `--yes` was not already passed; on accept, call `bag.onAccept`
 * (which flips `--yes` on the caller's command) and re-run; on
 * decline or non-TTY without `--yes`, render the directed message
 * and return `ExitCode.Error`.
 */
async function runWithSidecarConsent(
  bag: ISidecarConsentBag,
  ansi: IAnsi,
  dispatch: () => Promise<number>,
): Promise<number> {
  try {
    return await dispatch();
  } catch (err) {
    if (!(err instanceof EConsentRequiredError)) throw err;
    const isTTY = bag.stdin.isTTY === true;
    if (!isTTY || bag.yes) {
      const errGlyph = ansi.red('✕');
      bag.printError(
        tx(CONSENT_TEXTS.consentRequiredNonTty, {
          glyph: errGlyph,
          verb: 'sm sidecars',
          hint: ansi.dim(CONSENT_TEXTS.consentRequiredNonTtyHint),
        }),
      );
      return ExitCode.Error;
    }
    const ok = await confirm(
      tx(CONSENT_TEXTS.consentPrompt, { glyph: ansi.cyan('ℹ') }),
      { stdin: bag.stdin, stderr: bag.stderr },
      { defaultAnswer: 'yes' },
    );
    if (!ok) {
      bag.printInfo(
        tx(CONSENT_TEXTS.consentAborted, {
          glyph: ansi.cyan('ℹ'),
          verb: 'sm sidecars',
        }),
      );
      return ExitCode.Error;
    }
    bag.onAccept();
    return await dispatch();
  }
}

// --- sm sidecars refresh ---------------------------------------------------

export class SidecarEnrichCommand extends SmCommand {
  static override paths = [['sidecars', 'refresh']];
  static override exitCodes = [ExitCode.Ok, ExitCode.Error, ExitCode.NotFound];
  static override usage = Command.Usage({
    category: 'Actions',
    description:
      'Refresh a sidecar\'s `for.{bodyHash, frontmatterHash}` to match the live node. Does NOT bump the version.',
    details: `
      Useful when the user knows a body change is editorial-only and
      doesn't want to spend a \`annotations.version\` increment.
      Distinct from \`sm enrich\` (the enrichment-layer verb at Step
      A.8); different storage, different concept.

      Refuses if the node has no sidecar (run \`sm sidecars annotate\`
      first, or \`sm bump\` to create one through the Action). No-ops
      on a fresh node, there's nothing to refresh.
    `,
    examples: [
      ['Refresh a node\'s sidecar hashes', '$0 sidecar refresh .claude/agents/architect.md'],
    ],
  });

  nodePath = Option.String({ required: true });
  yes = Option.Boolean('--yes', false, {
    description: 'Confirm writing .sm sidecar files in this project (sets allowEditSmFiles=true on first run).',
  });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });

    const ansi = this.ansiFor('stdout');
    const okGlyph = ansi.green('✓');
    const errGlyph = ansi.red('✕');

    return runWithSidecarConsent(
      {
        stdin: this.context.stdin as NodeJS.ReadStream,
        stderr: this.context.stderr as NodeJS.WriteStream,
        yes: this.yes,
        onAccept: () => {
          this.yes = true;
        },
        printInfo: (s) => this.printer!.info(s),
        printError: (s) => this.printer!.error(s),
      },
      ansi,
      () => this.#runOnce(ctx, dbPath, okGlyph, errGlyph, ansi),
    );
  }

  // Inner dispatch, single attempt. The outer `run()` wraps every
  // call in `runWithSidecarConsent` so an `EConsentRequiredError`
  // surfaces as an interactive prompt (TTY) or a directed exit
  // (non-TTY).
  // eslint-disable-next-line complexity
  async #runOnce(
    ctx: { cwd: string },
    dbPath: string,
    okGlyph: string,
    errGlyph: string,
    ansi: IAnsi,
  ): Promise<number> {

    const persisted = await tryWithSqlite(
      { databasePath: dbPath, autoBackup: false },
      async (adapter) => adapter.scans.load(),
    );
    if (!persisted) {
      this.printer!.error(
        tx(SIDECAR_TEXTS.refreshNodeNotFound, {
          glyph: errGlyph,
          nodePath: this.nodePath,
          hint: ansi.dim(SIDECAR_TEXTS.refreshNodeNotFoundHint),
        }),
      );
      return ExitCode.NotFound;
    }

    const node = persisted.nodes.find((n) => n.path === this.nodePath);
    if (!node) {
      this.printer!.error(
        tx(SIDECAR_TEXTS.refreshNodeNotFound, {
          glyph: errGlyph,
          nodePath: this.nodePath,
          hint: ansi.dim(SIDECAR_TEXTS.refreshNodeNotFoundHint),
        }),
      );
      return ExitCode.NotFound;
    }

    let absPath: string;
    try {
      assertContained(ctx.cwd, node.path);
      absPath = resolve(ctx.cwd, node.path);
    } catch (err) {
      this.printer!.error(
        tx(SIDECAR_TEXTS.refreshFailed, { glyph: errGlyph, message: formatErrorMessage(err) }),
      );
      return ExitCode.Error;
    }
    const sidecarAbsPath = sidecarPathFor(absPath);

    if (node.sidecar?.present !== true) {
      this.printer!.error(
        tx(SIDECAR_TEXTS.refreshNoSidecar, {
          glyph: errGlyph,
          sidecarPath: sidecarAbsPath,
          hint: ansi.dim(SIDECAR_TEXTS.refreshNoSidecarHint),
        }),
      );
      return ExitCode.NotFound;
    }
    if (node.sidecar.status === 'fresh') {
      this.printer!.info(
        tx(SIDECAR_TEXTS.refreshFresh, { glyph: okGlyph, nodePath: sanitizeForTerminal(node.path) }),
      );
      return ExitCode.Ok;
    }

    // Hash-only update: refresh `for.{bodyHash, frontmatterHash}`,
    // leave version + audit untouched. Same deep-merge channel the
    // bump Action uses; this verb just hands the store a smaller
    // patch.
    const store = new FilesystemSidecarStore(ensureSidecarWritesAllowed);
    try {
      await store.applyPatch(
        sidecarAbsPath,
        {
          identity: {
            path: node.path,
            bodyHash: node.bodyHash,
            frontmatterHash: node.frontmatterHash,
          },
        },
        // Step 17 split: CLI accept / `--yes` persists the grant, so it
        // threads `always`, not the new one-shot `confirm`.
        { confirm: this.yes, always: this.yes, cwd: ctx.cwd },
      );
    } catch (err) {
      // Consent failures bubble up to `runWithSidecarConsent` for
      // prompt-and-retry handling; everything else funnels through
      // the local rendering branch.
      if (err instanceof EConsentRequiredError) throw err;
      this.printer!.error(
        tx(SIDECAR_TEXTS.refreshFailed, { glyph: errGlyph, message: formatErrorMessage(err) }),
      );
      return ExitCode.Error;
    }

    if (this.json) {
      this.printer!.data(
        JSON.stringify({
          nodePath: node.path,
          sidecarPath: sidecarAbsPath,
          status: 'refreshed',
        }) + '\n',
      );
    } else {
      this.printer!.data(
        tx(SIDECAR_TEXTS.refreshUpdated, { glyph: okGlyph, sidecarPath: sanitizeForTerminal(sidecarAbsPath) }),
      );
    }
    return ExitCode.Ok;
  }
}

// --- sm sidecars prune -----------------------------------------------------

export class SidecarPruneCommand extends SmCommand {
  static override paths = [['sidecars', 'prune']];
  static override exitCodes = [ExitCode.Ok, ExitCode.Issues, ExitCode.Error];
  static override usage = Command.Usage({
    category: 'Actions',
    description:
      'Delete orphan .sm files (sidecars whose accompanying .md no longer exists).',
    details: `
      Walks the configured roots looking for \`.sm\` files whose
      sibling \`<basename>.md\` does not exist on disk. With
      \`--dry-run\` reports what would be deleted without touching
      anything; without \`--dry-run\` prompts for interactive
      confirmation before deleting (per the project's destructive-verb
      convention). \`--yes\` (alias \`--force\`) bypasses the prompt
      for non-interactive use (CI, scripts, the pre-commit hook).

      Different domain from \`sm orphans\`: that verb operates on the
      node graph (rename heuristic). This one operates on the
      filesystem layer.
    `,
    examples: [
      ['List what would be pruned', '$0 sidecar prune --dry-run'],
      ['Delete every orphan .sm file (interactive)', '$0 sidecar prune'],
      ['Delete every orphan .sm file (non-interactive)', '$0 sidecar prune --yes'],
    ],
  });

  dryRun = Option.Boolean('-n,--dry-run', false);
  yes = Option.Boolean('--yes,--force', false, {
    description:
      'Skip the interactive confirmation prompt. Required for non-interactive callers (CI, pre-commit hooks).',
  });

  // Complexity is from per-orphan handling, empty-set / dry-run /
  // delete / error capture / json-vs-pretty branches each contributing
  // a guard. The unlink loop itself is linear.
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    // The configured root for the project scan is the cwd. The
    // discover walker accepts a list of roots; for prune we use the
    // single project root, symmetric with the orphan-rule consumer
    // in the orchestrator.
    const orphans = await discoverOrphanSidecars([ctx.cwd]);

    const ansi = this.ansiFor('stdout');
    const okGlyph = ansi.green('✓');
    const warnGlyph = ansi.yellow('⚠');
    const infoGlyph = ansi.cyan('ℹ');

    if (orphans.length === 0) {
      if (this.json) {
        this.printer!.data(
          JSON.stringify({ deleted: 0, wouldDelete: 0, items: [] }) + '\n',
        );
      } else {
        this.printer!.data(tx(SIDECAR_TEXTS.pruneNone, { glyph: okGlyph }));
      }
      return ExitCode.Ok;
    }

    const dryRun = this.dryRun === true;

    // Destructive-verb convention (per spec/cli-contract.md §Dry-run
    // rule): without --dry-run, prompt for confirmation unless --yes
    // was passed. Listing is shown to stderr so the operator sees what
    // they are about to lose; --yes (or non-interactive callers like
    // the pre-commit hook) skip the prompt.
    if (!dryRun && !this.yes) {
      const lines = orphans
        .map((o) =>
          tx(SIDECAR_TEXTS.pruneConfirmLine, {
            sidecarPath: sanitizeForTerminal(o.sidecarPath),
            expectedMdPath: sanitizeForTerminal(o.expectedMdPath),
          }),
        )
        .join('\n');
      const ok = await confirm(
        tx(SIDECAR_TEXTS.pruneConfirm, {
          count: orphans.length,
          plural: pluralSuffix(orphans.length),
          lines,
        }),
        { stdin: this.context.stdin, stderr: this.context.stderr },
      );
      if (!ok) {
        this.printer!.info(tx(SIDECAR_TEXTS.pruneAborted, { glyph: infoGlyph }));
        return ExitCode.Ok;
      }
    }
    const items: Array<{ sidecarPath: string; expectedMd: string; deleted: boolean; error?: string }> = [];
    let errors = 0;
    for (const orphan of orphans) {
      if (dryRun) {
        items.push({
          sidecarPath: orphan.sidecarPath,
          expectedMd: orphan.expectedMdPath,
          deleted: false,
        });
        continue;
      }
      try {
        await unlink(orphan.sidecarPath);
        items.push({
          sidecarPath: orphan.sidecarPath,
          expectedMd: orphan.expectedMdPath,
          deleted: true,
        });
      } catch (err) {
        errors += 1;
        const message = formatErrorMessage(err);
        items.push({
          sidecarPath: orphan.sidecarPath,
          expectedMd: orphan.expectedMdPath,
          deleted: false,
          error: message,
        });
        if (!this.json) {
          this.printer!.warn(
            tx(SIDECAR_TEXTS.pruneDeleteFailed, {
              glyph: warnGlyph,
              path: orphan.sidecarPath,
              message,
              hint: ansi.dim(SIDECAR_TEXTS.pruneDeleteFailedHint),
            }),
          );
        }
      }
    }

    if (this.json) {
      const env = {
        deleted: items.filter((i) => i.deleted).length,
        wouldDelete: dryRun ? items.length : 0,
        errors,
        items,
        elapsedMs: this.elapsed!.ms(),
      };
      this.printer!.data(JSON.stringify(env) + '\n');
      return errors > 0 ? ExitCode.Issues : ExitCode.Ok;
    }

    for (const item of items) {
      this.printer!.data(
        tx(SIDECAR_TEXTS.pruneItem, {
          action: dryRun ? 'would delete' : item.deleted ? 'deleted' : 'failed',
          sidecarPath: item.sidecarPath,
          expectedMd: item.expectedMd,
        }),
      );
    }
    if (dryRun) {
      const wouldDelete = items.length;
      this.printer!.info(
        tx(SIDECAR_TEXTS.pruneSummaryDryRun, {
          glyph: ansi.yellow('⋯'),
          wouldDelete,
          plural: wouldDelete === 1 ? '' : 's',
          dryTag: ansi.dim(SIDECAR_TEXTS.sidecarDryRunTag),
        }),
      );
    } else {
      const deleted = items.filter((i) => i.deleted).length;
      this.printer!.info(
        tx(SIDECAR_TEXTS.pruneSummary, {
          glyph: okGlyph,
          deleted,
          plural: deleted === 1 ? '' : 's',
        }),
      );
    }
    return errors > 0 ? ExitCode.Issues : ExitCode.Ok;
  }
}

// --- sm sidecars annotate --------------------------------------------------

export class SidecarAnnotateCommand extends SmCommand {
  static override paths = [['sidecars', 'annotate']];
  static override exitCodes = [ExitCode.Ok, ExitCode.Error, ExitCode.NotFound];
  static override usage = Command.Usage({
    category: 'Actions',
    description:
      'Scaffold an empty `<basename>.sm` next to a node ready for editing.',
    details: `
      Pure scaffolding helper. Writes a minimal \`.sm\` file with the
      \`identity:\` block populated and an empty \`annotations: {}\`
      block. After editing, run \`sm bump <node>\` to commit the
      version through the Action.

      Refuses if the file already exists; pass \`--force\` to
      overwrite. Per Decision A4 the \`--from-frontmatter\` migration
      helper is deferred (no released consumer demands it).
    `,
    examples: [
      ['Scaffold a sidecar', '$0 sidecar annotate .claude/agents/architect.md'],
      ['Overwrite an existing one', '$0 sidecar annotate .claude/agents/architect.md --force'],
    ],
  });

  nodePath = Option.String({ required: true });
  force = Option.Boolean('--force', false);
  yes = Option.Boolean('--yes', false, {
    description: 'Confirm writing .sm sidecar files in this project (sets allowEditSmFiles=true on first run).',
  });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });

    const ansi = this.ansiFor('stdout');
    const errGlyph = ansi.red('✕');

    return runWithSidecarConsent(
      {
        stdin: this.context.stdin as NodeJS.ReadStream,
        stderr: this.context.stderr as NodeJS.WriteStream,
        yes: this.yes,
        onAccept: () => {
          this.yes = true;
        },
        printInfo: (s) => this.printer!.info(s),
        printError: (s) => this.printer!.error(s),
      },
      ansi,
      () => this.#runOnce(ctx, dbPath, errGlyph, ansi),
    );
  }

  // CLI orchestrator: argument-validation guards + dry-run branch +
  // interactive confirm + collect/delete loop. Each branch is one
  // cyclomatic point; splitting would scatter the validations away
  // from the flag they gate. Per `context/lint.md` category 1.
  // eslint-disable-next-line complexity
  async #runOnce(
    ctx: { cwd: string },
    dbPath: string,
    errGlyph: string,
    ansi: IAnsi,
  ): Promise<number> {
    const persisted = await tryWithSqlite(
      { databasePath: dbPath, autoBackup: false },
      async (adapter) => adapter.scans.load(),
    );
    if (!persisted) {
      this.printer!.error(
        tx(SIDECAR_TEXTS.annotateNodeNotFound, {
          glyph: errGlyph,
          nodePath: this.nodePath,
          hint: ansi.dim(SIDECAR_TEXTS.annotateNodeNotFoundHint),
        }),
      );
      return ExitCode.NotFound;
    }

    const node = persisted.nodes.find((n) => n.path === this.nodePath);
    if (!node) {
      this.printer!.error(
        tx(SIDECAR_TEXTS.annotateNodeNotFound, {
          glyph: errGlyph,
          nodePath: this.nodePath,
          hint: ansi.dim(SIDECAR_TEXTS.annotateNodeNotFoundHint),
        }),
      );
      return ExitCode.NotFound;
    }

    let absPath: string;
    try {
      assertContained(ctx.cwd, node.path);
      absPath = resolve(ctx.cwd, node.path);
    } catch (err) {
      this.printer!.error(
        tx(SIDECAR_TEXTS.annotateFailed, { glyph: errGlyph, message: formatErrorMessage(err) }),
      );
      return ExitCode.Error;
    }
    const sidecarAbsPath = sidecarPathFor(absPath);

    const sidecarExists = await pathExists(sidecarAbsPath);
    if (sidecarExists && this.force !== true) {
      this.printer!.error(
        tx(SIDECAR_TEXTS.annotateExists, {
          glyph: errGlyph,
          sidecarPath: sidecarAbsPath,
          hint: ansi.dim(SIDECAR_TEXTS.annotateExistsHint),
        }),
      );
      return ExitCode.Error;
    }

    // With `--force` on a pre-existing sidecar, the legacy behaviour
    // was `writeFileSync` (whole-file overwrite). Now writes funnel
    // through `applyPatch` (deep-merge), so an unlink is required to
    // preserve the contract, otherwise the existing file's
    // plugin-namespaced blocks would survive the "scaffold" pass.
    if (sidecarExists && this.force === true) {
      try {
        await unlink(sidecarAbsPath);
      } catch (err) {
        this.printer!.error(
          tx(SIDECAR_TEXTS.annotateFailed, { glyph: errGlyph, message: formatErrorMessage(err) }),
        );
        return ExitCode.Error;
      }
    }

    const store = new FilesystemSidecarStore(ensureSidecarWritesAllowed);
    try {
      await store.applyPatch(
        sidecarAbsPath,
        scaffoldSidecarObject(node),
        // Step 17 split: CLI accept / `--yes` persists the grant, so it
        // threads `always`, not the new one-shot `confirm`.
        { confirm: this.yes, always: this.yes, cwd: ctx.cwd },
      );
    } catch (err) {
      // Consent failures bubble up to `runWithSidecarConsent` for
      // prompt-and-retry handling; everything else funnels through
      // the local rendering branch.
      if (err instanceof EConsentRequiredError) throw err;
      this.printer!.error(
        tx(SIDECAR_TEXTS.annotateFailed, { glyph: errGlyph, message: formatErrorMessage(err) }),
      );
      return ExitCode.Error;
    }

    if (this.json) {
      this.printer!.data(
        JSON.stringify({
          nodePath: node.path,
          sidecarPath: sidecarAbsPath,
          created: true,
        }) + '\n',
      );
    } else {
      this.printer!.data(
        tx(SIDECAR_TEXTS.annotateCreated, {
          glyph: ansi.green('✓'),
          sidecarPath: sidecarAbsPath,
          nodePath: node.path,
        }),
      );
    }
    return ExitCode.Ok;
  }
}

/**
 * Build the object form of a scaffold sidecar, the same shape
 * `FilesystemSidecarStore.applyPatch` expects. Carries the identity
 * (`identity:` block) so the next `sm bump` knows the hashes the
 * scaffolding was based on; `annotations: {}` is a valid empty block
 * per `spec/schemas/sidecar.schema.json`.
 *
 * Routing the scaffold through the store (instead of `writeFileSync`)
 * means every `.sm` write, first-time scaffold included, passes
 * the consent gate. The banner-comment header the previous string
 * scaffold emitted is dropped because the store serialises via
 * `js-yaml.dump` and never preserves comments; the same contract
 * applies to every `sm bump` round-trip.
 */
function scaffoldSidecarObject(node: Node): Record<string, unknown> {
  return {
    identity: {
      bodyHash: node.bodyHash,
      frontmatterHash: node.frontmatterHash,
      path: node.path,
    },
    annotations: {},
  };
}

export const SIDECAR_COMMANDS = [
  SidecarEnrichCommand,
  SidecarPruneCommand,
  SidecarAnnotateCommand,
];
