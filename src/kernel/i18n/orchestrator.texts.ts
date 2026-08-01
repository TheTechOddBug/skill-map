/**
 * Kernel-side strings emitted by `kernel/orchestrator.ts`.
 *
 * Convention: every entry is a flat string with `{{name}}` placeholders
 * (Mustache / Handlebars / Transloco compatible). The `tx` helper at
 * `kernel/util/tx.ts` does the interpolation. Plural / conditional
 * logic lives in the caller, pick the right template, don't branch
 * inside one.
 */

export const ORCHESTRATOR_TEXTS = {
  frontmatterInvalid:
    'Frontmatter for {{path}} ({{kind}}) failed schema validation: {{errors}}',

  frontmatterMalformedPasteWithIndent:
    'Frontmatter fence in {{path}} appears indented; YAML frontmatter MUST start with `---` ' +
    'at column 0. The file was scanned as body-only; the metadata block was silently lost. ' +
    'Move the `---` lines to the start of the line.',

  frontmatterMalformedByteOrderMark:
    'Frontmatter fence in {{path}} is preceded by a UTF-8 byte-order mark (BOM); the file ' +
    'was scanned as body-only. Re-save the file as UTF-8 without BOM. The metadata block ' +
    'was silently lost.',

  frontmatterMalformedLeadingBlankLine:
    'Frontmatter fence in {{path}} is preceded by one or more blank lines; YAML frontmatter ' +
    'MUST open with `---` on the very first line of the file. The file was scanned as ' +
    'body-only; the metadata block was silently lost. Delete the blank lines above the ' +
    'opening `---`.',

  frontmatterMalformedMissingClose:
    'Frontmatter in {{path}} opens with `---` but never closes (no matching `---` line ' +
    'at column 0 was found). The file was scanned as body-only and every metadata field was ' +
    'silently lost. Add a closing `---` line below the metadata block.',

  frontmatterMalformedEarlyClose:
    'Frontmatter in {{path}} appears to close early: a `---` line inside the metadata block ' +
    'ended it prematurely, and the fields below it ({{keys}}) parsed as body text. Remove the ' +
    'stray `---` or move those fields above it.',

  bodyBacktickUnclosedFence:
    'Body of {{path}} has an unclosed fenced code block opened at body line {{line}} (no ' +
    'matching closing ``` or ~~~). The code-strip policy then reads the rest of the file as ' +
    'code, so prose extractors stop emitting edges past it. Close the fence.',

  bodyBacktickUnclosedInline:
    'Body of {{path}} has an unclosed inline backtick at body line {{line}} (the backtick run ' +
    'has no equal-length closer). Close the inline span with a matching backtick run, or escape ' +
    'a literal backtick with a backslash.',

  // Names the global closed enum, not the retired per-extractor
  // `emitsLinkKinds` allowlist: the message an author reads has to point
  // at the constraint that actually rejected their link.
  extensionErrorLinkKindNotDeclared:
    'Extractor "{{extractorId}}" emitted a link of kind "{{linkKind}}", which is not one of ' +
    'the link kinds the spec defines [{{declaredKinds}}]. Link dropped.',

  extensionErrorIssueInvalidSeverity:
    'Rule "{{analyzerId}}" emitted an issue with invalid severity {{severity}} ' +
    "(allowed: 'error' | 'warn' | 'info'). Issue dropped.",

  extensionErrorContributionUndeclaredRef:
    'Extension "{{extractorId}}" emitted a view contribution on {{nodePath}} whose object is ' +
    'not one declared in its `ui` map (pass the declared const by reference, do not spread or ' +
    'inline it). Contribution dropped.',

  extensionErrorContributionPayloadInvalid:
    'Extractor "{{extractorId}}" emitted contribution "{{contributionId}}" on {{nodePath}}; ' +
    'payload failed the "{{slot}}" schema: {{errors}}. Contribution dropped.',

  extensionErrorRecommendedActionMissing:
    'Analyzer "{{analyzerId}}" declares recommendedAction "{{actionId}}" but no Action ' +
    'is registered under that qualified id. The analyzer stays registered; the recommendation ' +
    'will not surface in the inspector.',

  runScanRootEmptyArray:
    'runScan: roots must contain at least one path (spec requires minItems: 1)',

  runScanRootMissing: "runScan: root path '{{root}}' does not exist or is not a directory",
  runScanRootIsFile:
    "runScan: '{{root}}' is a file, and scan roots are directories. " +
    'A scan walks the corpus and re-derives the whole graph; ' +
    'to operate on one node use `sm enrich <node.path>` (its enrichment layer) ' +
    'or `sm scan --changed` (an incremental pass that re-extracts only what moved).',
} as const;
