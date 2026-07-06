/**
 * Frontmatter validation + malformed-fence detection helpers used by
 * `node-build.ts`. Pulled out of the monolith so the per-kind AJV
 * validation pass and the malformed-fence heuristic live next to each
 * other (they form a single conceptual surface: "did the frontmatter
 * arrive intact?").
 */

import { load as yamlLoad, JSON_SCHEMA } from 'js-yaml';

import { ORCHESTRATOR_TEXTS } from '../i18n/orchestrator.texts.js';
import type { IProvider } from '../extensions/index.js';
import type { IProviderFrontmatterValidator } from '../adapters/schema-validators.js';
import { tx } from '../util/tx.js';
import type { Issue } from '../types.js';

/**
 * Validate a node's frontmatter against the per-kind schema declared by
 * the Provider that classified the node. Only called for files that
 * actually declared a fence (caller checks `frontmatterRaw.length > 0`).
 * Returns a single `frontmatter-invalid` issue with the AJV error
 * string, or `null` when the frontmatter is structurally valid. Severity
 * is `warn` by default; `strict` flips it to `error` so the scan exit
 * code rises to 1.
 *
 * Spec 0.8.0: per-kind schemas live with the Provider, not in
 * spec. The orchestrator passes the live `IProviderFrontmatterValidator`
 * (composed from every loaded Provider's `kinds[<kind>].schemaJson`)
 * plus the active Provider so the lookup is `(provider.id, kind) →
 * schema`. A Provider that does not declare an entry for the kind it
 * classified into still gets a `frontmatter-invalid` issue with errors
 * `'no-schema'` so the kernel never silently skips validation.
 */
export function validateFrontmatter(
  providerFrontmatter: IProviderFrontmatterValidator,
  provider: IProvider,
  kind: string,
  frontmatter: Record<string, unknown>,
  path: string,
  strict: boolean,
): Issue | null {
  const result = providerFrontmatter.validate(provider, kind, frontmatter);
  if (result.ok) return null;
  return {
    analyzerId: 'frontmatter-invalid',
    severity: strict ? 'error' : 'warn',
    nodeIds: [path],
    message: tx(ORCHESTRATOR_TEXTS.frontmatterInvalid, { path, kind, errors: result.errors }),
    data: { kind, errors: result.errors },
  };
}

/**
 * Malformed-frontmatter detection, detect cases where the user clearly meant
 * frontmatter but the Provider's regex couldn't recognise the fence.
 * The Provider regex requires `^---\r?\n[\s\S]*?\r?\n---\r?\n?`,
 * column-0 open fence, column-0 close fence, CRLF or LF line endings.
 * Four real-world variants that fall through silently and silently
 * lose every metadata field:
 *
 *   - `paste-with-indent`: terminal heredoc auto-indented every line,
 *     so the open fence is `<spaces>---`. The most common variant.
 *   - `byte-order-mark`: a UTF-8 BOM (U+FEFF) precedes the fence. Some
 *     editors (notably old VS Code on Windows) inject this; the YAML
 *     parser handles BOM, but the Provider regex doesn't anchor past it.
 *   - `leading-blank-line`: one or more blank lines precede the open
 *     fence, so it is no longer at byte 0. Same careless-paste family
 *     as `paste-with-indent` (and it also covers a blank-then-indented
 *     fence, which that check cannot reach past the leading newline).
 *   - `missing-close`: the open fence is on column 0 but the closing
 *     fence is missing or indented. Whole "frontmatter" parses as body.
 *
 * A fifth hint, `early-close`, belongs to the same `frontmatter-malformed`
 * family but fires on the INVERSE precondition (the fence WAS recognised;
 * a stray `---` inside the block truncated it), so it lives in its own
 * detector, `detectEarlyCloseFrontmatter`, invoked from the declared-block
 * lane of `node-build`'s `detectFrontmatterIssue`.
 *
 * Each variant emits a `frontmatter-malformed` warn with a `data.hint`
 * tag so downstream tooling can disambiguate. `--strict` promotes to
 * `error` consistent with the strict-fence policy.
 *
 * False-positive guards:
 *
 *   - Indented `---` with no YAML-looking line after → likely a nested
 *     horizontal rule, not malformed frontmatter.
 *   - Column-0 `---` followed by prose (not a YAML key) → likely a
 *     legitimate horizontal rule with prose underneath. Tested.
 *
 * The schema-strict validator above only fires when `frontmatterRaw`
 * is non-empty; this fills the previously-silent path where the Provider
 * couldn't even recognise the fence.
 */
export function detectMalformedFrontmatter(body: string, path: string, strict: boolean): Issue | null {
  const hint = classifyMalformedFrontmatter(body);
  if (!hint) return null;
  return {
    analyzerId: 'frontmatter-malformed',
    severity: strict ? 'error' : 'warn',
    nodeIds: [path],
    message: malformedMessage(hint, path),
    data: { hint },
  };
}

export type TMalformedHint =
  | 'paste-with-indent'
  | 'byte-order-mark'
  | 'leading-blank-line'
  | 'missing-close'
  | 'early-close';

/**
 * Bound the BOM heuristic's key-line probe so its lazy `[\s\S]*?` scan
 * cannot go quadratic on a huge, colon-free, BOM-prefixed body (the
 * same cost-bounding posture as `EARLY_CLOSE_SCAN_LINES` below). Any
 * genuine frontmatter block opens a YAML key well inside this window.
 */
const BOM_SCAN_CHARS = 4096;

function classifyMalformedFrontmatter(body: string): TMalformedHint | null {
  // (a) BOM at the very first byte. Check before everything else
  // because a BOM offsets the column-0 anchor of the Provider's regex.
  // Pattern after BOM is the standard fence + YAML key-value line, so
  // we still require that shape to avoid false positives on any
  // BOM-prefixed prose. Blank lines (and fence indent) after the BOM
  // are tolerated so the COMBINED accident (BOM + blank line before the
  // fence) classifies here first; once the author strips the BOM, the
  // leading-blank / indent heuristics below take over on the next scan.
  if (body.startsWith('\uFEFF')) {
    if (
      /^\uFEFF(?:[ \t]*\r?\n)*[ \t]*---\r?\n[\s\S]*?[A-Za-z0-9_-]+\s*:/.test(
        body.slice(0, BOM_SCAN_CHARS),
      )
    ) {
      return 'byte-order-mark';
    }
  }

  // (b) Indented opening fence followed by a YAML-looking key-value
  // line. The most common variant (terminal heredoc auto-indent).
  if (/^[ \t]+---\r?\n[ \t]*[A-Za-z0-9_-]+\s*:/.test(body)) {
    return 'paste-with-indent';
  }

  // (c) One or more blank (whitespace-only) lines before the opening
  // fence, so the fence is not at byte 0 and the Provider regex cannot
  // anchor. Tolerates an indent on the fence itself (blank-then-indent
  // is the same paste accident; check (b) cannot see it because its
  // `^[ \t]+` anchor stops at the leading newline). Same false-positive
  // guard as the other variants: a YAML-looking `key: value` line MUST
  // follow the fence, otherwise it reads as a horizontal rule.
  if (/^(?:[ \t]*\r?\n)+[ \t]*---\r?\n[ \t]*[A-Za-z0-9_-]+\s*:/.test(body)) {
    return 'leading-blank-line';
  }

  // (d) Column-0 opening fence followed by a YAML-looking key-value
  // line, but no matching closing fence. The Provider regex needs both
  // fences; a missing close means the entire intended frontmatter
  // (plus the body) parses as body.
  //
  // Heuristic: open at column 0, then at least one `key: value` line
  // immediately, then anywhere in the file there is NO column-0 `---`
  // closing the block. If the body had been parsed as frontmatter the
  // Provider would have set `frontmatterRaw` non-empty and we wouldn't
  // be in this branch, so the absence of close means the regex
  // didn't match.
  if (/^---\r?\n[ \t]*[A-Za-z0-9_-]+\s*:/.test(body)) {
    // Search for any line that is exactly `---` (column 0, no indent).
    // If found, the Provider regex would have matched and this code
    // path is unreachable; absence here means the close is missing
    // or indented.
    const hasCloseFence = /\r?\n---(?:\r?\n|$)/.test(body);
    if (!hasCloseFence) {
      return 'missing-close';
    }
  }

  return null;
}

function malformedMessage(hint: TMalformedHint, path: string): string {
  switch (hint) {
    case 'paste-with-indent':
      return tx(ORCHESTRATOR_TEXTS.frontmatterMalformedPasteWithIndent, { path });
    case 'byte-order-mark':
      return tx(ORCHESTRATOR_TEXTS.frontmatterMalformedByteOrderMark, { path });
    case 'leading-blank-line':
      return tx(ORCHESTRATOR_TEXTS.frontmatterMalformedLeadingBlankLine, { path });
    case 'missing-close':
      return tx(ORCHESTRATOR_TEXTS.frontmatterMalformedMissingClose, { path });
    case 'early-close':
      // Unreachable through `classifyMalformedFrontmatter` (the hint is
      // emitted by `detectEarlyCloseFrontmatter`, which formats its own
      // message with the leaked keys); kept for switch exhaustiveness.
      return tx(ORCHESTRATOR_TEXTS.frontmatterMalformedEarlyClose, { path, keys: '' });
  }
}

/**
 * Early-close detection: a column-0 `---` line INSIDE the intended
 * metadata block ends the frontmatter prematurely (the parser's close
 * is lazy: first column-0 `---` wins), so everything below it silently
 * parses as body. Runs only when a fence WAS declared and parsed; the
 * signature it looks for at the very START of the body:
 *
 *   1. The first body line is `key: value`-shaped (leaked metadata).
 *   2. A column-0 `---` line follows within the first
 *      `EARLY_CLOSE_SCAN_LINES` lines (the close the author meant).
 *   3. The leaked segment parses as a YAML mapping.
 *   4. At least one leaked top-level key is a property declared in the
 *      kind's frontmatter schema. This is the load-bearing
 *      false-positive gate: prose like `Note: caveats` followed by a
 *      horizontal rule (a legitimate setext-heading / HR shape) parses
 *      as YAML too, but `Note` is not a schema property, while a leaked
 *      `tools:` / `description:` / `model:` is.
 *
 * When it fires, the AJV pass on the truncated frontmatter is
 * suppressed by the caller (`detectFrontmatterIssue`): a "missing
 * required property description" whose `description` sits three lines
 * below the stray `---` points the author away from the real defect.
 */
export function detectEarlyCloseFrontmatter(
  body: string,
  path: string,
  schemaJson: unknown,
  strict: boolean,
): Issue | null {
  const keys = leakedSchemaKeys(body, schemaJson);
  if (keys === null) return null;
  return {
    analyzerId: 'frontmatter-malformed',
    severity: strict ? 'error' : 'warn',
    nodeIds: [path],
    message: tx(ORCHESTRATOR_TEXTS.frontmatterMalformedEarlyClose, {
      path,
      keys: keys.join(', '),
    }),
    data: { hint: 'early-close', leakedKeys: keys },
  };
}

/** Bound the early-close scan so a huge body costs nothing. */
const EARLY_CLOSE_SCAN_LINES = 40;

const YAML_KEY_LINE_RE = /^[A-Za-z0-9_-]+\s*:/;

/**
 * The leaked segment's schema-declared keys, or `null` when the body
 * start does not match the early-close signature. Split from
 * `detectEarlyCloseFrontmatter` for the lint complexity cap.
 */
function leakedSchemaKeys(body: string, schemaJson: unknown): string[] | null {
  const lines = body.split('\n', EARLY_CLOSE_SCAN_LINES + 1);
  if (!lines[0] || !YAML_KEY_LINE_RE.test(lines[0])) return null;
  const closeIdx = lines.findIndex(
    (line, i) => i > 0 && i <= EARLY_CLOSE_SCAN_LINES && /^---\r?$/.test(line),
  );
  if (closeIdx < 0) return null;
  const doc = parseLeakedSegment(lines.slice(0, closeIdx).join('\n'));
  if (!doc) return null;
  const properties = schemaProperties(schemaJson);
  const leaked = Object.keys(doc).filter((k) => properties.has(k));
  return leaked.length > 0 ? leaked : null;
}

/** The segment as a YAML mapping, or `null` when it is not one. */
function parseLeakedSegment(segment: string): Record<string, unknown> | null {
  try {
    const doc = yamlLoad(segment, { schema: JSON_SCHEMA });
    if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
      return doc as Record<string, unknown>;
    }
  } catch {
    // Not valid YAML: whatever leaked is not a recognisable metadata
    // block, stay silent.
  }
  return null;
}

/**
 * Property names the kind's frontmatter schema declares: the top-level
 * `properties`, any INLINE `allOf` branch's `properties`, plus the
 * universal base pair `name` / `description`. Every per-kind schema
 * composes `spec/schemas/frontmatter/base.schema.json` through an
 * `allOf` `$ref`, and that base declares exactly those two keys;
 * resolving the `$ref` here would drag the AJV registry into a
 * heuristic that only needs the key names, so the pair is folded in as
 * a documented constant instead.
 */
function schemaProperties(schemaJson: unknown): ReadonlySet<string> {
  const out = new Set<string>(['name', 'description']);
  if (!schemaJson || typeof schemaJson !== 'object') return out;
  const schema = schemaJson as Record<string, unknown>;
  collectInlineProperties(schema, out);
  const allOf = schema['allOf'];
  if (Array.isArray(allOf)) {
    for (const branch of allOf) collectInlineProperties(branch, out);
  }
  return out;
}

/** Fold one schema object's own `properties` keys into `out`. */
function collectInlineProperties(schema: unknown, out: Set<string>): void {
  if (!schema || typeof schema !== 'object') return;
  const props = (schema as Record<string, unknown>)['properties'];
  if (!props || typeof props !== 'object') return;
  for (const key of Object.keys(props)) out.add(key);
}
