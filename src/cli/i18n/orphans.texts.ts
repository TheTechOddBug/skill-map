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
    '{{glyph}}  sm orphans reconcile: target node "{{path}}" not found in scan_nodes.\n' +
    '   {{hint}}\n',
  reconcileTargetNotFoundHint:
    'Run `sm scan` first, then retry with the path as it appears in `sm list`.',
  reconcileNoActiveIssue:
    '{{glyph}}  sm orphans reconcile: no active orphan issue found for "{{path}}".\n' +
    '   {{hint}}\n',
  reconcileNoActiveIssueHint:
    'Listing first: run `sm orphans` to see the open issues.',
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
    '{{glyph}}  {{count}} composite-PK collision{{plural}}; destination rows preserved.\n',
  reconcileCollisionsNoteDryRun:
    '{{glyph}}  {{count}} composite-PK collision{{plural}} would be skipped; destination rows preserved.\n',

  // --- undo-rename -------------------------------------------------------
  undoNoActiveIssue:
    '{{glyph}}  sm orphans undo-rename: no active auto-rename issue targets "{{path}}".\n' +
    '   {{hint}}\n',
  undoNoActiveIssueHint:
    'Run `sm orphans` to list the active auto-rename issues.',
  undoMultipleActive:
    '{{glyph}}  sm orphans undo-rename: {{count}} active auto-rename issues target "{{path}}".\n' +
    '   {{hint}}\n',
  undoMultipleActiveHint:
    'The rename heuristic should produce at most one. Run `sm scan` and retry.',
  undoMediumMissingFrom:
    '{{glyph}}  sm orphans undo-rename: auto-rename-medium issue is missing data.from.\n' +
    '   {{hint}}\n',
  undoMediumMissingFromHint:
    'Cannot revert without --from. Pass --from <old.path> explicitly.',
  undoMediumFromMismatch:
    '{{glyph}}  sm orphans undo-rename: --from "{{from}}" does not match auto-rename-medium data.from "{{dataFrom}}".\n',
  undoAmbiguousRequiresFrom:
    '{{glyph}}  sm orphans undo-rename: --from <old.path> is REQUIRED for auto-rename-ambiguous.\n' +
    '   {{hint}}\n',
  undoAmbiguousRequiresFromHint:
    'Pick one of data.candidates and pass it as --from.',
  undoAmbiguousNotInCandidates:
    '{{glyph}}  sm orphans undo-rename: --from "{{from}}" not in auto-rename-ambiguous candidates.\n',
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
   * catalog), kept here for now so the wording lives in one greppable
   * place even if the layering is imperfect.
   */
  undoRenameOrphanMessage:
    'Orphan history: {{toPath}} (was reverted from auto-rename to {{newPath}}).',

  // --- shared ------------------------------------------------------------
  invalidKind:
    '{{glyph}}  --kind: invalid value "{{kind}}".\n' +
    '   {{hint}}\n',
  invalidKindHint: 'Allowed: orphan, medium, ambiguous.',

  // --- renderOrphans (pretty listing) ------------------------------------
  /** Header line for the active orphan / auto-rename issues block. */
  listHeader: 'sm orphans: {{count}} {{noun}}\n\n',
  listNounSingular: 'issue',
  listNounPlural: 'issues',
  /**
   * Per-issue row: glyph + analyzerId + subject + dim message tail. Columns
   * are padded by the renderer so the message lines up across rows.
   */
  listRow: '  {{glyph}}  {{analyzerId}}  {{subject}}  {{message}}\n',
  listTip:
    '\nTip: `sm orphans reconcile <path>` to reattach, `sm orphans undo-rename` to revert.\n',
  /** Placeholder used when an issue has no associated node id. */
  noNodePlaceholder: '(no node)',
} as const;
