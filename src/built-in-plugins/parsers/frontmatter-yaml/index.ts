/**
 * `frontmatter-yaml` parser. Splits a `--- yaml --- body` document and
 * parses the frontmatter via `js-yaml`. Carries the audit-cleared
 * defences:
 *
 *   - **Symlink / TOCTOU**, out of scope here (lives in the walker;
 *     this parser receives the raw string after the kernel walker has
 *     already vetted the file).
 *   - **Prototype pollution (audit L2/L3)**, keys named `__proto__`,
 *     `constructor`, `prototype` are stripped from the parsed object.
 *     `js-yaml` stores `__proto__:` as an own data property (rather
 *     than mutating `Object.prototype`), but the value still flows into
 *     downstream `Object.assign`-style merges where the `__proto__`
 *     setter fires. Stripping at parse time keeps the returned object
 *     safe to spread, copy, and persist.
 *   - **`!!js/function` & friends (audit L3)**, `yaml.load` runs with
 *     `schema: JSON_SCHEMA` explicitly. js-yaml v4's default schema is
 *     already safe (no `!!js/function` tag), but the explicit selection
 *     documents intent and protects against an upstream default flip.
 *     Frontmatter values that are valid JSON (string, number, bool,
 *     null, sequence, mapping) round-trip unchanged; YAML-only
 *     conveniences like unquoted timestamps degrade to strings, but the
 *     kernel's node schema does not depend on parsed Date objects so
 *     the tradeoff is safe.
 *
 * Lives under `src/built-in-plugins/parsers/` even though the parser
 * registry stays kernel-internal (no `kind: 'parser'` is exposed to
 * plugin authors). The relocation aligns the file layout with the
 * other built-ins (Provider / Extractor / Rule / Formatter / Action /
 * Hook), every shipped extension-shaped artifact lives under
 * `built-in-plugins/`. The registry in `kernel/scan/parsers/index.ts`
 * imports from here and stays the single resolution surface.
 */

import yaml from 'js-yaml';

import type { IFileParser, IParsedFile } from '../../../kernel/scan/parsers/types.js';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const FORBIDDEN_FRONTMATTER_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const frontmatterYamlParser: IFileParser = {
  id: 'frontmatter-yaml',
  parse(raw: string, _path: string): IParsedFile {
    const match = FRONTMATTER_RE.exec(raw);
    if (!match) return { frontmatterRaw: '', frontmatter: {}, body: raw };
    const frontmatterRaw = match[1]!;
    const body = match[2]!;
    const parsed: Record<string, unknown> = {};
    try {
      const doc = yaml.load(frontmatterRaw, { schema: yaml.JSON_SCHEMA });
      if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
        for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
          if (FORBIDDEN_FRONTMATTER_KEYS.has(k)) continue;
          parsed[k] = v;
        }
      }
    } catch {
      // Malformed YAML, leave as empty object, keep the raw string for
      // downstream diagnostics.
    }
    return { frontmatterRaw, frontmatter: parsed, body };
  },
};
