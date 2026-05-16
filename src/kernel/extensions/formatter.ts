/**
 * Formatter runtime contract. Turns the (nodes, links, issues) graph into
 * a textual representation for `sm graph --format <name>`.
 *
 * **Structure-as-truth**: the format id comes from the formatter's folder
 * name (`<plugin>/formatters/<formatId>/index.ts`); it is injected by the
 * loader into `id` and surfaced here as `formatId` for the existing CLI
 * lookup (`formatters.find((f) => f.formatId === flag)`). Manifests carrying
 * a `formatId` literal are rejected as `invalid-manifest`.
 *
 * All formatters accept the `--filter` expression; opting out is no longer
 * supported (the old `supportsFilter` field was retired).
 */

import type { IExtensionBase } from './base.js';
import type { Issue, Link, Node, ScanResult } from '../types.js';

export interface IFormatterContext {
  nodes: Node[];
  links: Link[];
  issues: Issue[];
  /**
   * Full persisted scan, when the caller has it on hand. Optional so
   * formatters that only consume (nodes, links, issues) keep working
   * unchanged; formatters whose output mirrors a `ScanResult` envelope
   * (today: the built-in `json` formatter) read this to project the
   * canonical document verbatim.
   */
  scanResult?: ScanResult;
}

export interface IFormatter extends IExtensionBase {
  /** Discriminant injected by the loader from the folder structure. */
  kind: 'formatter';
  /**
   * Format identifier consumed by `sm graph --format <name>`. Injected
   * by the loader from the formatter folder name. Surfaced as a top-level
   * field (rather than reusing `id`) so the existing CLI lookup keeps its
   * domain-specific name.
   */
  formatId: string;
  /**
   * MIME-like hint surfaced when streaming over HTTP. Advisory; default
   * `'text/plain'`.
   */
  contentType?: string;
  /** Serialize the graph into a string. Deterministic-only. */
  format(ctx: IFormatterContext): string;
}
