/**
 * Offline token counting for scan nodes, backed by `gpt-tokenizer`.
 *
 * Owns the tokenizer name allow-list (mirrored by
 * `project-config.schema.json#/properties/tokenizer/enum`) and the
 * lazy, memoized construction of the per-encoding counter. Construction
 * is deferred behind `ITokenCounterHandle.resolve()` so a fully-warm
 * incremental scan (every node reused from cache) never loads a rank
 * table at all; the first cache-missing node pays the one-time load.
 *
 * Special-token policy: token counting NEVER throws. A literal special
 * token in prose (`<|endoftext|>` pasted into a markdown body) is
 * counted as plain text. `gpt-tokenizer`'s default rejects such input
 * (`Disallowed special token found`), which would abort the whole scan
 * on one hostile file; passing an empty `disallowedSpecial` set disables
 * the rejection scan without allowing any token to collapse to its
 * special id, so the text is BPE-encoded exactly like ordinary prose.
 *
 * Tuning note: `gpt-tokenizer`'s merge cache defaults to an LRU bounded
 * at 100k entries (`setMergeCacheSize` on the encoding subpath). We do
 * not touch it today; if watcher RSS ever demands a smaller bound, this
 * module is the single place to wire that knob.
 */

import type { TripleSplit } from '../types.js';

/**
 * Default offline tokenizer. Mirrors `defaults.json#/tokenizer` and the
 * `project-config.schema.json` enum default. The single source of the
 * "fall back to this" decision in the orchestrator.
 */
export const DEFAULT_TOKENIZER = 'cl100k_base';

/**
 * Closed allow-list of supported encodings, byte-aligned with
 * `project-config.schema.json#/properties/tokenizer/enum`.
 */
export type TTokenizerName = 'cl100k_base' | 'o200k_base';

/**
 * Belt-and-suspenders guard over the override layer. The config schema's
 * AJV `enum` already rejects out-of-set values for the config layers
 * (dropped-with-warning, falls back to the default), but the `override`
 * layer and out-of-band callers reach `runScan` without that gate, so
 * any unrecognised name resolves to the default here.
 */
export function resolveTokenizerName(name: string | undefined): TTokenizerName {
  return name === 'o200k_base' ? 'o200k_base' : DEFAULT_TOKENIZER;
}

/** A constructed counter for one encoding, ready to count synchronously. */
export interface ITokenCounter {
  count(frontmatterRaw: string, body: string): TripleSplit;
}

/**
 * Lazy handle to a counter. `resolve()` performs (or joins) the one-time
 * encoding load; callers that never resolve never pay it.
 */
export interface ITokenCounterHandle {
  resolve(): Promise<ITokenCounter>;
}

/**
 * The plain-text special-token policy (see module doc). One frozen
 * instance shared by every count call.
 */
const PLAIN_TEXT_SPECIALS = Object.freeze({ disallowedSpecial: new Set<string>() });

/**
 * Process-wide counter cache, keyed by encoding name. The PROMISE is
 * memoized (not the resolved counter) so concurrent `resolve()` calls
 * during one scan join a single in-flight load instead of constructing
 * twice. Never invalidated on purpose: the rank tables are static data
 * shipped with `gpt-tokenizer`.
 */
const counterCache = new Map<TTokenizerName, Promise<ITokenCounter>>();

async function loadCounter(name: TTokenizerName): Promise<ITokenCounter> {
  // The two specifiers are explicit string literals (NOT a template
  // `gpt-tokenizer/encoding/${name}`) so bundlers statically see both
  // subpaths; the ternary means exactly one table is loaded at runtime.
  // gpt-tokenizer resolves these through its exports map, the lint
  // rule's hard-coded extension matrix doesn't model subpath patterns.
  const mod = name === 'o200k_base'
    // eslint-disable-next-line import-x/extensions
    ? await import('gpt-tokenizer/encoding/o200k_base')
    // eslint-disable-next-line import-x/extensions
    : await import('gpt-tokenizer/encoding/cl100k_base');
  return {
    count(frontmatterRaw: string, body: string): TripleSplit {
      // Count the raw frontmatter bytes (not the parsed object) so the
      // count stays reproducible from on-disk content.
      const frontmatter = frontmatterRaw.length > 0
        ? mod.countTokens(frontmatterRaw, PLAIN_TEXT_SPECIALS)
        : 0;
      const bodyTokens = body.length > 0 ? mod.countTokens(body, PLAIN_TEXT_SPECIALS) : 0;
      return { frontmatter, body: bodyTokens, total: frontmatter + bodyTokens };
    },
  };
}

/** Sync factory: hands out the lazy handle without loading anything. */
export function getTokenCounterHandle(name: TTokenizerName): ITokenCounterHandle {
  return {
    resolve(): Promise<ITokenCounter> {
      let pending = counterCache.get(name);
      if (!pending) {
        pending = loadCounter(name);
        counterCache.set(name, pending);
      }
      return pending;
    },
  };
}
