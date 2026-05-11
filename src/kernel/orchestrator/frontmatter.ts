/**
 * Frontmatter validation + malformed-fence detection helpers used by
 * `node-build.ts`. Pulled out of the monolith so the per-kind AJV
 * validation pass and the malformed-fence heuristic live next to each
 * other (they form a single conceptual surface: "did the frontmatter
 * arrive intact?").
 */

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
 * Malformed-frontmatter detection — detect cases where the user clearly meant
 * frontmatter but the Provider's regex couldn't recognise the fence.
 * The Provider regex requires `^---\r?\n[\s\S]*?\r?\n---\r?\n?` —
 * column-0 open fence, column-0 close fence, CRLF or LF line endings.
 * Three real-world variants that fall through silently and silently
 * lose every metadata field:
 *
 *   - `paste-with-indent`: terminal heredoc auto-indented every line,
 *     so the open fence is `<spaces>---`. The most common variant
 *    .
 *   - `byte-order-mark`: a UTF-8 BOM (﻿) precedes the fence. Some
 *     editors (notably old VS Code on Windows) inject this; the YAML
 *     parser handles BOM, but the Provider regex doesn't anchor past it.
 *   - `missing-close`: the open fence is on column 0 but the closing
 *     fence is missing or indented. Whole "frontmatter" parses as body.
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

export type TMalformedHint = 'paste-with-indent' | 'byte-order-mark' | 'missing-close';

function classifyMalformedFrontmatter(body: string): TMalformedHint | null {
  // (a) BOM at the very first byte. Check before everything else
  // because a BOM offsets the column-0 anchor of the Provider's regex.
  // Pattern after BOM is the standard column-0 fence + YAML key-value
  // line, so we still require that shape to avoid false positives on
  // any BOM-prefixed prose.
  if (body.startsWith('﻿')) {
    if (/^﻿---\r?\n[\s\S]*?[A-Za-z0-9_-]+\s*:/.test(body)) {
      return 'byte-order-mark';
    }
  }

  // (b) Indented opening fence followed by a YAML-looking key-value
  // line. The most common variant (terminal heredoc auto-indent).
  if (/^[ \t]+---\r?\n[ \t]*[A-Za-z0-9_-]+\s*:/.test(body)) {
    return 'paste-with-indent';
  }

  // (c) Column-0 opening fence followed by a YAML-looking key-value
  // line, but no matching closing fence. The Provider regex needs both
  // fences; a missing close means the entire intended frontmatter
  // (plus the body) parses as body.
  //
  // Heuristic: open at column 0, then at least one `key: value` line
  // immediately, then anywhere in the file there is NO column-0 `---`
  // closing the block. If the body had been parsed as frontmatter the
  // Provider would have set `frontmatterRaw` non-empty and we wouldn't
  // be in this branch — so the absence of close means the regex
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
    case 'missing-close':
      return tx(ORCHESTRATOR_TEXTS.frontmatterMalformedMissingClose, { path });
  }
}
