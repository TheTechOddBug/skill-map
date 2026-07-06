/**
 * `toml` parser. Treats the entire file as TOML and returns it as the
 * node's `frontmatter`; `body` is empty. Used by Providers whose
 * authored entities are pure TOML manifests (no markdown body):
 *
 *   - OpenAI Codex sub-agents (`.codex/agents/*.toml`).
 *   - Future provider configs (`config.toml`-style manifests) declared
 *     by a Provider's `read: { extensions: ['.toml'], parser: 'toml' }`.
 *
 * Lives under `src/plugins/core/parsers/` for layout consistency with
 * the other built-in parsers (`frontmatter-yaml`, `plain`), but the
 * registry in `kernel/scan/parsers/index.ts` stays kernel-internal:
 * plugin authors cannot register their own parsers, the closed set is
 * the contract.
 *
 * Defences mirror `frontmatter-yaml`:
 *
 *   - **Prototype pollution**: `smol-toml.parse` returns a plain object
 *     tree, but the kernel still runs it through `stripPrototypePollution`
 *     at every depth so downstream `Object.assign`-style merges cannot
 *     trigger the `__proto__` setter chain. Same posture as YAML.
 *   - **Malformed TOML surfacing**: parse failures keep the historic
 *     `frontmatter: {}` fallback (so the scan keeps making progress)
 *     and ALSO emit an `IParseIssue` with code `frontmatter-parse-error`
 *     so the orchestrator translates it into a warn-level kernel
 *     `Issue`. Authors see the typo instead of silently losing their
 *     metadata.
 *   - **No code execution surface**: TOML is data-only by spec, the
 *     `!!js/function` class of attack does not apply.
 */

import { parse as parseToml } from 'smol-toml';

import type {
  IFileParser,
  IParsedFile,
  IParseIssue,
} from '../../../../kernel/scan/parsers/types.js';
import { sanitiseParseErrorMessage } from '../../../../kernel/scan/parsers/sanitise-parse-error.js';
import { stripPrototypePollution } from '../../../../kernel/util/strip-prototype-pollution.js';

export const tomlParser: IFileParser = {
  id: 'toml',
  parse(raw: string, _path: string): IParsedFile {
    let parsed: Record<string, unknown> = {};
    const issues: IParseIssue[] = [];
    try {
      const doc = parseToml(raw);
      if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
        parsed = stripPrototypePollution(doc as Record<string, unknown>);
      }
    } catch (err) {
      issues.push({
        code: 'frontmatter-parse-error',
        message: sanitiseParseErrorMessage(err),
      });
    }
    const out: IParsedFile = {
      frontmatterRaw: raw,
      frontmatter: parsed,
      body: '',
      // A pure-TOML entity IS its metadata block by format contract, so
      // the block is always "declared", even for an empty file. An empty
      // sub-agent `.toml` on a kind with required fields must reach the
      // per-kind AJV pass, mirroring the empty YAML fence.
      frontmatterDeclared: true,
    };
    if (issues.length > 0) {
      return { ...out, issues };
    }
    return out;
  },
};
