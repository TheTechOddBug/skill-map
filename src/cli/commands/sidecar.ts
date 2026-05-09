/**
 * `sm sidecar refresh <node-path>`
 * `sm sidecar prune [--dry-run]`
 * `sm sidecar annotate <node-path> [--force]`
 *
 * Step 9.6.4 (Decision A1). Administrative verbs around the sidecar
 * `.sm` files. Each is a thin wrapper:
 *
 *   - `refresh`  — refreshes `for.{bodyHash, frontmatterHash}` only.
 *     Does NOT bump `annotations.version`, does NOT touch the audit
 *     block. Useful when the user knows a body change is editorial
 *     and they don't want to spend a version increment.
 *   - `prune`    — deletes orphan `.sm` files (those whose `<base>.md`
 *     no longer exists). `--dry-run` reports what would be deleted
 *     without touching disk.
 *   - `annotate` — pure scaffolding: creates an empty `.sm` next to
 *     the `.md` ready for editing. Per Decision A4 the
 *     `--from-frontmatter` migration helper is OUT of 9.6.4.
 *
 * `sm sidecar refresh` is intentionally distinct from `sm refresh`
 * (the Step A.8 enrichment-layer verb that re-runs Extractors) — same
 * verb stem, different concept; the sub-namespace prefix keeps the
 * two from colliding.
 *
 * Exit codes (per `spec/cli-contract.md` §Exit codes):
 *   0  ok
 *   1  prune surfaced delete failures
 *   2  operational failure (write error, etc.)
 *   5  node not in persisted scan / sidecar missing
 */

import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Command, Option } from 'clipanion';
import yaml from 'js-yaml';

import { sidecarPathFor } from '../../kernel/sidecar/parse.js';
import { discoverOrphanSidecars } from '../../kernel/sidecar/discover-orphans.js';
import { FilesystemSidecarStore } from '../../kernel/sidecar/store.js';
import type { Node } from '../../kernel/types.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { ansiFor } from '../util/ansi.js';
import { SIDECAR_TEXTS } from '../i18n/sidecar.texts.js';
import { confirm } from '../util/confirm.js';
import { resolveDbPath } from '../util/db-path.js';
import { ExitCode } from '../util/exit-codes.js';
import { assertContained } from '../util/path-guard.js';
import { defaultRuntimeContext } from '../util/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';
import { tryWithSqlite } from '../util/with-sqlite.js';

// --- sm sidecar refresh ---------------------------------------------------

export class SidecarRefreshCommand extends SmCommand {
  static override paths = [['sidecar', 'refresh']];
  static override usage = Command.Usage({
    category: 'Actions',
    description:
      'Refresh a sidecar\'s `for.{bodyHash, frontmatterHash}` to match the live node. Does NOT bump the version.',
    details: `
      Useful when the user knows a body change is editorial-only and
      doesn't want to spend a \`annotations.version\` increment.
      Distinct from \`sm refresh\` (the enrichment-layer verb at Step
      A.8) — different storage, different concept.

      Refuses if the node has no sidecar (run \`sm sidecar annotate\`
      first, or \`sm bump\` to create one through the Action). No-ops
      on a fresh node — there's nothing to refresh.
    `,
    examples: [
      ['Refresh a node\'s sidecar hashes', '$0 sidecar refresh .claude/agents/architect.md'],
    ],
  });

  nodePath = Option.String({ required: true });

  // Complexity is from CLI ergonomics: db-load / not-found / abs-path
  // / no-sidecar / fresh / write-error / json-vs-pretty branches.
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ global: this.global, db: this.db, ...ctx });

    const stdout = this.context.stdout as NodeJS.WriteStream;
    const ansi = ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: this.noColor });
    const okGlyph = ansi.green('✓');
    const errGlyph = ansi.red('✕');

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
        tx(SIDECAR_TEXTS.refreshFresh, { glyph: okGlyph, nodePath: node.path }),
      );
      return ExitCode.Ok;
    }

    // Hash-only update: refresh `for.{bodyHash, frontmatterHash}`,
    // leave version + audit untouched. Same deep-merge channel the
    // bump Action uses; this verb just hands the store a smaller
    // patch.
    const store = new FilesystemSidecarStore();
    try {
      await store.applyPatch(sidecarAbsPath, {
        for: {
          path: node.path,
          bodyHash: node.bodyHash,
          frontmatterHash: node.frontmatterHash,
        },
      });
    } catch (err) {
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
        tx(SIDECAR_TEXTS.refreshUpdated, { glyph: okGlyph, sidecarPath: sidecarAbsPath }),
      );
    }
    return ExitCode.Ok;
  }
}

// --- sm sidecar prune -----------------------------------------------------

export class SidecarPruneCommand extends SmCommand {
  static override paths = [['sidecar', 'prune']];
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

      Different domain from \`sm orphans\` — that verb operates on the
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

  // Complexity is from per-orphan handling — empty-set / dry-run /
  // delete / error capture / json-vs-pretty branches each contributing
  // a guard. The unlink loop itself is linear.
  // eslint-disable-next-line complexity
  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    // The configured root for the project scan is the cwd. The
    // discover walker accepts a list of roots; for prune we use the
    // single project root — symmetric with the orphan-rule consumer
    // in the orchestrator.
    const orphans = discoverOrphanSidecars([ctx.cwd]);

    const stdout = this.context.stdout as NodeJS.WriteStream;
    const ansi = ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: this.noColor });
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
        .map((o) => `  ${o.sidecarPath} (expected ${o.expectedMdPath})`)
        .join('\n');
      const ok = await confirm(
        tx(SIDECAR_TEXTS.pruneConfirm, { count: orphans.length, lines }),
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
        unlinkSync(orphan.sidecarPath);
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

// --- sm sidecar annotate --------------------------------------------------

export class SidecarAnnotateCommand extends SmCommand {
  static override paths = [['sidecar', 'annotate']];
  static override usage = Command.Usage({
    category: 'Actions',
    description:
      'Scaffold an empty `<basename>.sm` next to a node ready for editing.',
    details: `
      Pure scaffolding helper. Writes a minimal \`.sm\` file with the
      identity \`for:\` block populated and an empty \`annotations: {}\`
      block. After editing, run \`sm bump <node>\` to commit the
      version through the Action.

      Refuses if the file already exists — pass \`--force\` to
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

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ global: this.global, db: this.db, ...ctx });

    const stdout = this.context.stdout as NodeJS.WriteStream;
    const ansi = ansiFor({ isTTY: stdout.isTTY === true, noColorFlag: this.noColor });
    const errGlyph = ansi.red('✕');

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

    if (existsSync(sidecarAbsPath) && this.force !== true) {
      this.printer!.error(
        tx(SIDECAR_TEXTS.annotateExists, {
          glyph: errGlyph,
          sidecarPath: sidecarAbsPath,
          hint: ansi.dim(SIDECAR_TEXTS.annotateExistsHint),
        }),
      );
      return ExitCode.Error;
    }

    const scaffold = scaffoldSidecar(node);
    try {
      writeFileSync(sidecarAbsPath, scaffold, { encoding: 'utf8' });
    } catch (err) {
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
 * Produce the YAML body of a scaffold sidecar. Carries the identity
 * (`for:` block) so the next `sm bump` knows the hashes the
 * scaffolding was based on; `annotations: {}` is a valid empty block
 * per `spec/schemas/sidecar.schema.json`.
 *
 * Serialised via `js-yaml` with `sortKeys: true` to match the
 * `FilesystemSidecarStore` round-trip — a follow-up `sm bump` deep-
 * merges the patch and re-emits via the same serializer, so starting
 * from the same byte shape avoids a noisy diff on first bump.
 */
function scaffoldSidecar(node: Node): string {
  const root = {
    for: {
      bodyHash: node.bodyHash,
      frontmatterHash: node.frontmatterHash,
      path: node.path,
    },
    annotations: {},
  };
  const body = yaml.dump(root, {
    sortKeys: true,
    lineWidth: -1,
    noRefs: true,
    noCompatMode: true,
  });
  // Step 9.6 review queue R6: comments inside `.sm` are dropped by the
  // bump round-trip (the FilesystemSidecarStore re-serialises via
  // `js-yaml dump`). Surface that contract in the very first scaffold
  // the user sees so nobody is surprised mid-flow. Narrative / docs
  // belong in the `.md` body, which is never touched.
  const banner =
    '# Skill-map sidecar — managed artifact.\n' +
    '# Comments in .sm are NOT preserved across `sm bump` (the bump action\n' +
    '# re-serialises the file). Narrative / docs → the .md body, which is\n' +
    '# never touched. See spec/cli-contract.md §Sidecar bump for the\n' +
    '# round-trip contract.\n\n';
  return banner + body;
}

export const SIDECAR_COMMANDS = [
  SidecarRefreshCommand,
  SidecarPruneCommand,
  SidecarAnnotateCommand,
];
