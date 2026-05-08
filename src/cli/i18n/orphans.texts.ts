/**
 * Strings emitted by `cli/commands/orphans.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 */

export const ORPHANS_TEXTS = {
  /** Empty-state line: `✓  No orphan / auto-rename issues.` */
  noIssues: '{{glyph}}  No orphan / auto-rename issues.\n',
  aborted: 'Aborted.\n',

  // --- reconcile ---------------------------------------------------------
  reconcileTargetNotFound:
    'sm orphans reconcile: target node "{{path}}" not found in scan_nodes.\n',
  reconcileNoActiveIssue:
    'sm orphans reconcile: no active orphan issue found for "{{path}}".\n',
  /**
   * Two-line success block:
   *   `✓  Reconciled <from> → <to>`
   *   `   <rows> rows · jobs N · execs N · summaries N · enrichments N · kv N · favorites N`
   * Glyph is wrapped in green at the call site; the breakdown line is
   * dim. The dry-run variant swaps the headline glyph and the verb.
   */
  reconcileSuccessHead: '{{glyph}}  Reconciled {{from}} → {{to}}\n',
  reconcileSuccessBody:
    '   {{breakdown}}\n',
  reconcileDryRunHead: '{{glyph}}  Would reconcile {{from}} → {{to}}{{dryTag}}\n',
  /** Breakdown line composed at the call site from non-zero counts only. */
  reconcileBreakdown:
    '{{rows}} rows · jobs {{jobs}} · execs {{execs}} · summaries {{summaries}} · enrichments {{enrichments}} · kv {{kv}} · favorites {{favorites}}',
  reconcileCollisionsNote:
    '{{glyph}}  {{count}} composite-PK collision{{plural}} — destination rows preserved.\n',
  reconcileCollisionsNoteDryRun:
    '{{glyph}}  {{count}} composite-PK collision{{plural}} would be skipped; destination rows preserved.\n',

  // --- undo-rename -------------------------------------------------------
  undoNoActiveIssue:
    'sm orphans undo-rename: no active auto-rename issue targets "{{path}}".\n',
  undoMultipleActive:
    'sm orphans undo-rename: {{count}} active auto-rename issues target "{{path}}"; ' +
    'the rename heuristic should have produced at most one. Run `sm scan` and retry.\n',
  undoMediumMissingFrom:
    'sm orphans undo-rename: auto-rename-medium issue is missing data.from; ' +
    'cannot revert without --from.\n',
  undoMediumFromMismatch:
    'sm orphans undo-rename: --from "{{from}}" does not match auto-rename-medium ' +
    'data.from "{{dataFrom}}".\n',
  undoAmbiguousRequiresFrom:
    'sm orphans undo-rename: --from <old.path> is REQUIRED for auto-rename-ambiguous ' +
    '(pick one of data.candidates).\n',
  undoAmbiguousNotInCandidates:
    'sm orphans undo-rename: --from "{{from}}" not in auto-rename-ambiguous candidates.\n',
  undoConfirmPrompt:
    'Undo auto-rename: migrate state_* FKs from {{newPath}} back to {{from}}?',
  undoSuccessHead: '{{glyph}}  Reverted {{newPath}} → {{from}}\n',
  undoSuccessBody: '   {{rows}} rows migrated · new orphan issue emitted on {{from}}\n',
  undoDryRunHead: '{{glyph}}  Would revert {{newPath}} → {{from}}{{dryTag}}\n',
  undoDryRunBody: '   {{rows}} rows would migrate · would emit a new orphan issue on {{from}}\n',
  /** Trailing dim tag appended to dry-run head lines. */
  dryRunTag: '  (dry-run)',
  /**
   * Message persisted into `scan_issues.message` for the orphan issue
   * emitted after `sm orphans undo-rename`. The string lands in DB rows
   * and travels through `--json`, `sm check`, and downstream consumers,
   * so localising it requires a kernel-side template (not just a CLI
   * catalog) — kept here for now so the wording lives in one greppable
   * place even if the layering is imperfect.
   */
  undoRenameOrphanMessage:
    'Orphan history: {{toPath}} (was reverted from auto-rename to {{newPath}}).',

  // --- shared ------------------------------------------------------------
  invalidKind:
    '--kind: invalid value "{{kind}}". Allowed: orphan, medium, ambiguous.\n',

  // --- renderOrphans (pretty listing) ------------------------------------
  /** Header line for the active orphan / auto-rename issues block. */
  listHeader: 'sm orphans — {{count}} {{noun}}\n\n',
  listNounSingular: 'issue',
  listNounPlural: 'issues',
  /**
   * Per-issue row: glyph + ruleId + subject + dim message tail. Columns
   * are padded by the renderer so the message lines up across rows.
   */
  listRow: '  {{glyph}}  {{ruleId}}  {{subject}}  {{message}}\n',
  listTip:
    '\nTip: `sm orphans reconcile <path>` to reattach, `sm orphans undo-rename` to revert.\n',
  /** Placeholder used when an issue has no associated node id. */
  noNodePlaceholder: '(no node)',
} as const;
