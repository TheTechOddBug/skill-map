/**
 * `plain` parser. Treats the entire raw as the body; emits an empty
 * frontmatter object and an empty `frontmatterRaw`. Pure pass-through:
 * the body is not normalised, line endings are preserved verbatim.
 *
 * Used by Providers that walk files carrying no frontmatter convention
 * (e.g. Roo Code rules at `.roo/rules/*.md`, Windsurf rules at
 * `.windsurf/rules/*.md`, plain `CONVENTIONS.md`). Such Providers MUST
 * derive `frontmatter.name` (and other base-required fields) from the
 * file path inside their `classify()` / Provider-side post-processing,
 * because the spec's `frontmatter/base.schema.json` requires `name`.
 *
 * Spec note: when the `frontmatter/base.schema.json` `name` requirement
 * is relaxed in a later phase, the path-derivation step becomes optional.
 *
 * Lives under `src/built-in-plugins/parsers/` for layout consistency
 * with the other built-ins; the parser registry in
 * `kernel/scan/parsers/index.ts` stays kernel-internal and imports
 * from here.
 */

import type { IFileParser, IParsedFile } from '../../../kernel/scan/parsers/types.js';

export const plainParser: IFileParser = {
  id: 'plain',
  parse(raw: string, _path: string): IParsedFile {
    return { frontmatter: {}, frontmatterRaw: '', body: raw };
  },
};
