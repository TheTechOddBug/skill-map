/**
 * Kernel-internal parser registry. Built-ins are seeded at module load
 * time and frozen — user plugins cannot register their own parsers
 * (this module is NOT re-exported from `src/kernel/index.ts`).
 *
 * Provider manifests reference parsers by id via `read.parser`. The
 * walker calls `getParser(id)` once per scan when it resolves a
 * Provider's read config; the orchestrator never sees a parser
 * directly.
 *
 * Registry shape: a single `Map<id, IFileParser>` seeded from the two
 * built-in modules — both now living under `src/built-in-plugins/parsers/`
 * for layout consistency with the other shipped extensions, while the
 * registry itself stays kernel-internal (no `kind: 'parser'` is exposed
 * to plugin authors). The set of built-in ids is captured into
 * `FROZEN_IDS` at seed time; subsequent `registerParser` calls reject
 * collisions with frozen built-ins. The `registerParser` seam exists
 * for kernel-internal tests and future built-ins; it is not part of any
 * plugin-author API.
 */

import { frontmatterYamlParser } from '../../../built-in-plugins/parsers/frontmatter-yaml/index.js';
import { plainParser } from '../../../built-in-plugins/parsers/plain/index.js';

import type { IFileParser } from './types.js';

export type { IFileParser, IParsedFile } from './types.js';

const REGISTRY = new Map<string, IFileParser>([
  [frontmatterYamlParser.id, frontmatterYamlParser],
  [plainParser.id, plainParser],
]);
const FROZEN_IDS: ReadonlySet<string> = new Set(REGISTRY.keys());

/** Resolve a parser by id. Returns `undefined` for unknown ids. */
export function getParser(id: string): IFileParser | undefined {
  return REGISTRY.get(id);
}

/**
 * Kernel-internal seam for tests and future built-ins. Throws when the
 * id collides with a frozen built-in (`frontmatter-yaml`, `plain`).
 * NOT re-exported from `src/kernel/index.ts` — user plugins have no
 * public surface to call this.
 */
export function registerParser(parser: IFileParser): void {
  if (FROZEN_IDS.has(parser.id)) {
    throw new Error(
      `Cannot register parser with built-in id '${parser.id}'. Built-in parsers are frozen.`,
    );
  }
  REGISTRY.set(parser.id, parser);
}

/** Test-only — drop a non-built-in registration. Throws on a frozen id. */
export function _unregisterParserForTests(id: string): void {
  if (FROZEN_IDS.has(id)) {
    throw new Error(`Cannot unregister built-in parser '${id}'.`);
  }
  REGISTRY.delete(id);
}
