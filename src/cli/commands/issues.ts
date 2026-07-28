/**
 * `sm issues`, the dismissal escape hatch for DETERMINISTIC analyzer
 * issues (`spec/cli-contract.md` §sm issues dismiss / undismiss /
 * suppressions), issue-flavored sibling of the `sm findings` suppression
 * verbs with one deliberate asymmetry: an issue suppression applies at
 * EMISSION time, not as a read-time lens. Issues carry no stable row
 * identity and are regenerated wholesale each scan, so the analyzer
 * consults the standing `annotations.issueSuppressions` entries on
 * every scan and skips both the issue and its confidence penalty.
 *
 *   - `sm issues dismiss <analyzer> <value> -n <node.path>` writes the
 *     entry to the node's `.sm` sidecar (gated, same consent as
 *     `sm bump`), refreshes the `scan_nodes.annotations_json` mirror,
 *     and DELETES the matching persisted `scan_issues` rows so every
 *     read agrees immediately.
 *   - `sm issues undismiss <analyzer> <value> -n <node.path>` removes
 *     ONE entry through the same gated channel; the issue reappears
 *     only at the NEXT scan (the rows were deleted, not hidden).
 *   - `sm issues suppressions [-n <node.path>]` is the READ half:
 *     lists every active entry from the mirror so a silenced value is
 *     never invisible state.
 *
 * Identity: `analyzer` qualified preferred, bare short id accepted
 * (either spelling matches either stored form, same grammar as
 * `sm check --analyzers`); `value` is the issue's verbatim
 * `data.target`, matched exact and case-sensitive.
 */

import { resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import { appendOperation } from '../../core/operations-log.js';

import type { StoragePort } from '../../kernel/ports/storage.js';
import type { Node } from '../../kernel/types.js';
import {
  buildIssueSuppressionEntry,
  existingIssueSuppressions,
  mergeIssueSuppression,
  readSidecarFor,
  removeIssueSuppression,
  sidecarPathFor,
} from '../../kernel/sidecar/index.js';
import { FilesystemSidecarStore } from '../../kernel/sidecar/store.js';
import {
  issueSuppressionsFromAnnotations,
  type IIssueSuppressionEntry,
} from '../../kernel/util/issue-suppressions.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { ensureSidecarWritesAllowed } from '../../core/config/sidecar-consent.js';
import { assertNoDriftForWrite } from '../../core/sqlite/db-version-runner.js';
import { ISSUES_TEXTS as T } from '../i18n/issues.texts.js';
import { buildReadVersionCheck } from '../util/db-version-check.js';
import { requireDbOrExit, resolveDbPath } from '../util/db-path.js';
import { defaultRuntimeContext } from '../../core/runtime/runtime-context.js';
import { ExitCode, type TExitCode } from '../util/exit-codes.js';
import {
  refreshAnnotationsMirror,
  runWithSidecarConsentGate,
} from '../util/sidecar-consent-gate.js';
import { SmCommand } from '../util/sm-command.js';
import { withSqlite } from '../../core/sqlite/with-sqlite.js';

/**
 * `sm issues dismiss <analyzer> <value> -n <node.path> [--note <text>]
 * [--yes] [--json]`
 *
 * Write path: standing sidecar entry (gated) + mirror refresh + delete
 * of the matching persisted rows. Idempotent: re-dismissing an
 * already-suppressed pair rewrites nothing but still runs the row
 * delete (harmless convergence toward what the next scan produces
 * anyway). Node absent from the scan: exit 5.
 */
export class IssuesDismissCommand extends SmCommand {
  static override paths = [['issues', 'dismiss']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Dismiss a deterministic analyzer issue (analyzer + exact value) on one node, durably.',
    details: `
      Writes a standing annotations.issueSuppressions entry to the node's
      .sm sidecar (through the same consent gate as sm bump), keyed by the
      emitting analyzer plus the verbatim flagged value (the issue's
      data.target, e.g. '@ApiSecurity'; quote values carrying sigils or
      slashes). Matching is exact and case-sensitive: a later
      '@apisecurity' is a different token and stays flagged.

      Unlike sm findings dismiss, the suppression applies at emission
      time: the analyzer consults the entry on every scan and skips both
      the issue and its confidence penalty. Dismissing also deletes the
      matching persisted scan_issues rows so every read agrees
      immediately; aggregate severity chips converge at the next scan.

      Idempotent: re-dismissing an already-suppressed pair rewrites
      nothing. Undo with sm issues undismiss (the issue returns at the
      next scan); list the active entries with sm issues suppressions.
    `,
    examples: [
      [
        'Dismiss a broken-mention false positive',
        "$0 issues dismiss core/reference-broken '@ApiSecurity' -n docs/api.md",
      ],
      [
        'Record why (bare analyzer id accepted)',
        '$0 issues dismiss reference-broken \'@nestjs/swagger\' -n docs/api.md --note "npm package, not a mention"',
      ],
      [
        'Non-interactive (CI, scripts)',
        "$0 issues dismiss core/reference-broken '@ApiSecurity' -n docs/api.md --yes",
      ],
    ],
  });

  analyzer = Option.String({ required: true });
  value = Option.String({ required: true });
  node = Option.String('-n,--node', {
    required: true,
    description: 'Node path the issue is flagged on (the suppression lives in its .sm sidecar).',
  });
  note = Option.String('--note', {
    required: false,
    description: 'One-line reason recorded on the suppression entry.',
  });
  yes = Option.Boolean('--yes', false, {
    description: 'Confirm writing .sm sidecar files in this project (sets allowEditSmFiles=true on first run).',
  });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr, this.noColor);
    if (dbExit !== null) return dbExit;
    // Write verb: refuse a drifted DB before the scan_issues delete
    // (spec/cli-contract.md §Schema-drift rebuild).
    assertNoDriftForWrite(dbPath);
    return withSqlite({ databasePath: dbPath, autoBackup: false }, async (adapter) => {
      // Scan membership anchors the sidecar path, guards typos, and
      // sources the identity block for a brand-new sidecar.
      const bundle = await adapter.scans.findNode(this.node);
      if (!bundle) return this.failNodeGone();
      // The sidecar write goes through the same consent gate as sm bump;
      // wrap so a first EConsentRequiredError surfaces as a prompt / retry.
      return runWithSidecarConsentGate({
        verb: 'sm issues dismiss',
        yes: this.yes,
        setYes: () => {
          this.yes = true;
        },
        stdin: this.context.stdin as NodeJS.ReadStream,
        stderr: this.context.stderr as NodeJS.WriteStream,
        ansi: this.ansiFor('stderr'),
        printError: (message) => this.printer!.error(message),
        dispatch: () => this.dismiss(adapter, bundle.node, ctx.cwd),
      });
    });
  }

  /**
   * The write half: merge the (analyzer, value) entry into the node's
   * `.sm` sidecar (gated), refresh the write-through
   * `scan_nodes.annotations_json` mirror, then DELETE the matching
   * persisted `scan_issues` rows (emission-time semantics: the rows are
   * regenerable machine state and the next scan's analyzer skips the
   * value anyway, so the delete just makes reads agree now).
   * `applyPatch` throws `EConsentRequiredError` BEFORE any disk write,
   * so on the first (declined) pass nothing has changed and
   * `runWithSidecarConsentGate` can re-run.
   */
  private async dismiss(adapter: StoragePort, node: Node, cwd: string): Promise<TExitCode> {
    const entry = buildIssueSuppressionEntry(this.analyzer, this.value, this.note);
    const mdAbs = resolve(cwd, this.node);
    const sidecarAbs = sidecarPathFor(mdAbs);
    const read = readSidecarFor(mdAbs);
    const merged = mergeIssueSuppression(
      existingIssueSuppressions(read.parsed?.annotations),
      entry,
    );
    const changes: Record<string, unknown> = { annotations: { issueSuppressions: merged } };
    // A brand-new (or previously invalid) sidecar needs the required
    // `identity` block to validate; source it from the live scan node so
    // the drift baseline is honest. An EXISTING valid sidecar keeps its
    // identity untouched (dismiss is not a bump, it must not reset drift).
    if (read.parsed === null) {
      changes['identity'] = {
        path: node.path,
        bodyHash: node.bodyHash,
        frontmatterHash: node.frontmatterHash,
      };
    }
    const store = new FilesystemSidecarStore(ensureSidecarWritesAllowed);
    // Step 17 consent split: --yes persists the grant (its documented
    // "never asked again" contract), so it threads `always`.
    await store.applyPatch(sidecarAbs, changes, { confirm: this.yes, always: this.yes, cwd });
    await refreshAnnotationsMirror(adapter, this.node, mdAbs);
    const deleted = await adapter.issues.deleteForSuppression(this.node, this.analyzer, this.value);
    return this.reportDismissed(entry, deleted, cwd);
  }

  /** Success: the suppression landed and the stored rows are gone. */
  private reportDismissed(
    entry: Record<string, unknown>,
    deleted: number,
    cwd: string,
  ): TExitCode {
    appendOperation(cwd, {
      op: 'issues.dismiss',
      target: this.node,
      extension: this.analyzer,
      channel: 'cli',
      outcome: 'ok',
      detail: `value=${this.value} deleted=${deleted}`,
    });
    if (this.json) {
      this.printer!.data(
        JSON.stringify({
          ok: true,
          kind: 'issue-suppression',
          suppression: entry,
          node: this.node,
          deletedIssues: deleted,
        }) + '\n',
      );
      return ExitCode.Ok;
    }
    const ansi = this.ansiFor('stdout');
    this.printer!.data(
      tx(T.dismissDone, {
        glyph: ansi.green('✓'),
        analyzer: sanitizeForTerminal(this.analyzer),
        value: sanitizeForTerminal(this.value),
        node: sanitizeForTerminal(this.node),
        sidecar: sanitizeForTerminal(sidecarPathFor(this.node)),
        deleted,
        plural: deleted === 1 ? '' : 's',
        hint: ansi.dim(T.dismissDoneHint),
      }),
    );
    return ExitCode.Ok;
  }

  /** Exit 5: the node is not in the current scan. */
  private failNodeGone(): TExitCode {
    const ansi = this.ansiFor('stderr');
    this.printer!.error(
      tx(T.dismissNodeGone, {
        glyph: ansi.red('✕'),
        node: sanitizeForTerminal(this.node),
        hint: ansi.dim(T.dismissNodeGoneHint),
      }),
    );
    return ExitCode.NotFound;
  }
}

/**
 * `sm issues undismiss <analyzer> <value> -n <node.path> [--yes]
 * [--json]`
 *
 * Remove ONE issue-suppression entry, same identity rules as dismiss
 * (analyzer qualified-or-bare in either direction, value exact and
 * case-sensitive). The rows were DELETED at dismiss time (emission-time
 * semantics), so the issue reappears only at the NEXT scan. No matching
 * entry, or the node absent from the scan: exit 5; on the no-match path
 * the mirror SELF-HEALS from the live `.sm` first (same rule as
 * `sm findings undismiss`).
 */
export class IssuesUndismissCommand extends SmCommand {
  static override paths = [['issues', 'undismiss']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'Remove an issue suppression written by dismiss; the issue returns at the next scan.',
    details: `
      Removes the matching annotations.issueSuppressions entry from the
      node's .sm sidecar (through the same consent gate as sm issues
      dismiss). Identity is exact: the analyzer (qualified or bare,
      either spelling matches either stored form) plus the
      case-sensitive value.

      Because the suppression acted at emission time (the stored rows
      were deleted, not hidden), the issue reappears only at the NEXT
      scan, the documented asymmetry with dismiss, which takes effect
      immediately. List the active entries with sm issues suppressions.
    `,
    examples: [
      [
        'Lift a suppression',
        "$0 issues undismiss core/reference-broken '@ApiSecurity' -n docs/api.md",
      ],
      [
        'Bare analyzer id accepted',
        "$0 issues undismiss reference-broken '@nestjs/swagger' -n docs/api.md --yes",
      ],
    ],
  });

  analyzer = Option.String({ required: true });
  value = Option.String({ required: true });
  node = Option.String('-n,--node', {
    required: true,
    description: 'Node path whose sidecar holds the issue suppression.',
  });
  yes = Option.Boolean('--yes', false, {
    description: 'Confirm writing .sm sidecar files in this project (sets allowEditSmFiles=true on first run).',
  });

  protected async run(): Promise<number> {
    const ctx = defaultRuntimeContext();
    const dbPath = resolveDbPath({ db: this.db, ...ctx });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr, this.noColor);
    if (dbExit !== null) return dbExit;
    return withSqlite(
      {
        databasePath: dbPath,
        autoBackup: false,
        versionCheck: buildReadVersionCheck(this.printer!, this.ansiFor('stderr')),
      },
      async (adapter) => {
        // Scan membership anchors the sidecar path and guards typos; the
        // suppression itself lives on disk, not in the DB.
        const bundle = await adapter.scans.findNode(this.node);
        if (!bundle) return this.failNodeGone();
        return runWithSidecarConsentGate({
          verb: 'sm issues undismiss',
          yes: this.yes,
          setYes: () => {
            this.yes = true;
          },
          stdin: this.context.stdin as NodeJS.ReadStream,
          stderr: this.context.stderr as NodeJS.WriteStream,
          ansi: this.ansiFor('stderr'),
          printError: (message) => this.printer!.error(message),
          dispatch: () => this.undismiss(adapter, ctx.cwd),
        });
      },
    );
  }

  /**
   * Remove the matching entry, write the remaining list back through the
   * gated channel, and refresh the write-through
   * `scan_nodes.annotations_json` mirror. `applyPatch` replaces arrays
   * wholesale, so the remaining list (possibly empty) is handed over in
   * full.
   */
  private async undismiss(adapter: StoragePort, cwd: string): Promise<TExitCode> {
    const mdAbs = resolve(cwd, this.node);
    const sidecarAbs = sidecarPathFor(mdAbs);
    const existing = existingIssueSuppressions(readSidecarFor(mdAbs).parsed?.annotations);
    const { remaining, removed } = removeIssueSuppression(existing, this.analyzer, this.value);
    if (removed === null) {
      // Self-heal before failing: the mirror may still claim a
      // suppression the live `.sm` no longer carries (edited or deleted
      // outside skill-map). Reconciling here costs one row UPDATE and
      // makes the exit-5 honest: after it, view and file agree.
      await refreshAnnotationsMirror(adapter, this.node, mdAbs);
      return this.failNoMatch();
    }
    const store = new FilesystemSidecarStore(ensureSidecarWritesAllowed);
    await store.applyPatch(
      sidecarAbs,
      { annotations: { issueSuppressions: remaining } },
      { confirm: this.yes, always: this.yes, cwd },
    );
    await refreshAnnotationsMirror(adapter, this.node, mdAbs);
    return this.reportRemoved(removed, cwd);
  }

  /** Success: the entry left the sidecar; the issue returns at the next scan. */
  private reportRemoved(removed: Record<string, unknown>, cwd: string): TExitCode {
    appendOperation(cwd, {
      op: 'issues.undismiss',
      target: this.node,
      extension: this.analyzer,
      channel: 'cli',
      outcome: 'ok',
      detail: `value=${this.value}`,
    });
    if (this.json) {
      this.printer!.data(
        JSON.stringify({ ok: true, kind: 'issue-unsuppression', removed, node: this.node }) +
          '\n',
      );
      return ExitCode.Ok;
    }
    const ansi = this.ansiFor('stdout');
    this.printer!.data(
      tx(T.undismissDone, {
        glyph: ansi.green('✓'),
        analyzer: sanitizeForTerminal(String(removed['analyzer'])),
        value: sanitizeForTerminal(String(removed['value'])),
        node: sanitizeForTerminal(this.node),
        sidecar: sanitizeForTerminal(sidecarPathFor(this.node)),
        hint: ansi.dim(T.undismissDoneHint),
      }),
    );
    return ExitCode.Ok;
  }

  /** Exit 5: no issue-suppression entry matches the (analyzer, value) pair. */
  private failNoMatch(): TExitCode {
    const ansi = this.ansiFor('stderr');
    this.printer!.error(
      tx(T.undismissNoMatch, {
        glyph: ansi.red('✕'),
        analyzer: sanitizeForTerminal(this.analyzer),
        value: sanitizeForTerminal(this.value),
        node: sanitizeForTerminal(this.node),
        hint: ansi.dim(T.undismissNoMatchHint),
      }),
    );
    return ExitCode.NotFound;
  }

  /** Exit 5: the node is not in the current scan. */
  private failNodeGone(): TExitCode {
    const ansi = this.ansiFor('stderr');
    this.printer!.error(
      tx(T.undismissNodeGone, {
        glyph: ansi.red('✕'),
        node: sanitizeForTerminal(this.node),
        hint: ansi.dim(T.undismissNodeGoneHint),
      }),
    );
    return ExitCode.NotFound;
  }
}

/**
 * `sm issues suppressions [-n <node.path>] [--json]`
 *
 * READ verb, the visibility half of the issue-dismiss escape hatch:
 * lists every ACTIVE issue suppression (node, analyzer, value, note) so
 * a silenced value is never invisible state. Reads the write-through
 * `scan_nodes.annotations_json` mirror (ONE query, zero file reads; the
 * `.sm` sidecar stays the source of truth, dismiss / undismiss keep the
 * column fresh, a hand-edited `.sm` reconciles at the next scan). `-n`
 * narrows to one node. No DB write, no sidecar consent, always exit 0.
 */
export class IssuesSuppressionsCommand extends SmCommand {
  static override paths = [['issues', 'suppressions']];
  static override usage = Command.Usage({
    category: 'Browse',
    description: 'List active issue suppressions (analyzer values silenced by dismiss).',
    details: `
      Lists every standing annotations.issueSuppressions entry across the
      scanned nodes: which (analyzer, value) pairs sm issues dismiss
      silenced, where, and why (the recorded note). Without this view a
      dismissed value is invisible state.

      -n restricts to one node path. Remove an entry with sm issues
      undismiss; the issue returns at the next scan.
    `,
    examples: [
      ['List every active issue suppression', '$0 issues suppressions'],
      ['One node', '$0 issues suppressions -n docs/api.md'],
    ],
  });

  node = Option.String('-n,--node', {
    description: 'Restrict to the issue suppressions of this node path.',
  });

  protected async run(): Promise<number> {
    const dbPath = resolveDbPath({ db: this.db, ...defaultRuntimeContext() });
    const dbExit = requireDbOrExit(dbPath, this.context.stderr, this.noColor);
    if (dbExit !== null) return dbExit;
    return withSqlite(
      {
        databasePath: dbPath,
        autoBackup: false,
        versionCheck: buildReadVersionCheck(this.printer!, this.ansiFor('stderr')),
      },
      async (adapter) => {
        // The write-through `scan_nodes.annotations_json` mirror rides
        // the node rows: ONE query (`findNodes` hydrates the column into
        // `node.sidecar.annotations`, path-ordered), zero file reads.
        // The `-n` narrow filters in process; the issues port has no
        // per-path suppression query and this listing is human-scale.
        const nodes = await adapter.scans.findNodes({});
        const rows = nodes
          .filter((node) => this.node === undefined || node.path === this.node)
          .flatMap((node) =>
            issueSuppressionsFromAnnotations(node.sidecar?.annotations).map((entry) => ({
              node: node.path,
              ...entry,
            })),
          )
          .sort(
            (a, b) =>
              a.node.localeCompare(b.node) ||
              a.analyzer.localeCompare(b.analyzer) ||
              a.value.localeCompare(b.value),
          );
        return this.report(rows);
      },
    );
  }

  private report(rows: Array<{ node: string } & IIssueSuppressionEntry>): TExitCode {
    if (this.json) {
      this.printer!.data(
        JSON.stringify({ ok: true, kind: 'issue-suppressions', suppressions: rows }) + '\n',
      );
      return ExitCode.Ok;
    }
    const ansi = this.ansiFor('stdout');
    if (rows.length === 0) {
      this.printer!.data(tx(T.suppressionsNone, { glyph: ansi.green('✓') }));
      return ExitCode.Ok;
    }
    let out = tx(T.suppressionsHeader, { count: rows.length });
    for (const row of rows) {
      out += tx(T.suppressionsRow, {
        node: sanitizeForTerminal(row.node),
        analyzer: sanitizeForTerminal(row.analyzer),
        value: sanitizeForTerminal(row.value),
        noteSuffix:
          row.note !== undefined
            ? ansi.dim(tx(T.suppressionsNoteSuffix, { note: sanitizeForTerminal(row.note) }))
            : '',
      });
    }
    out += ansi.dim(T.suppressionsTip);
    this.printer!.data(out);
    return ExitCode.Ok;
  }
}
