/**
 * `<sm-inspector-debug-panel>`, diagnostic surface the catalog
 * curation hides by default. Toggled on / off via the inspector's
 * header `i` button. Renders the canonical "what does the kernel see
 * for this node?" view:
 *
 *   - `for.path` (sanity-check the sidecar binding)
 *   - `for.bodyHash` (stored) vs live `node.bodyHash`, diff highlighted
 *   - `for.frontmatterHash` (stored) vs live `node.frontmatterHash`,
 *     diff highlighted
 *   - `for.resolvedAs.{provider, kind}` (always rendered; `(not set)`
 *     when neither is present, opt-in only when classification is
 *     ambiguous, so the absent state is the common case)
 *   - `sidecar.status` enum literal
 *
 * Refinement (2026-05-07): the panel ALWAYS renders the full structure
 * when toggled on. Rows whose source value is missing show an explicit
 * `(absent)` marker rather than disappearing, that way the panel
 * surfaces "this row is empty" instead of silently hiding rows for
 * sidecar-less nodes. The kernel-derived live hashes
 * (`node.bodyHash` / `node.frontmatterHash`) come from the scan
 * payload so they're populated regardless of sidecar presence.
 */

import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import { INSPECTOR_DEBUG_PANEL_TEXTS } from '../../../i18n/inspector-debug-panel.texts';
import { COPIED_FEEDBACK_MS, copyToClipboard } from '../../../services/clipboard';
import type { ISidecarOverlay, INodeView } from '../../../models/node';

interface IIdentityBlock {
  path: string | null;
  bodyHash: string | null;
  frontmatterHash: string | null;
  resolvedProvider: string | null;
  resolvedKind: string | null;
}

@Component({
  selector: 'sm-inspector-debug-panel',
  imports: [NgTemplateOutlet],
  templateUrl: './inspector-debug-panel.html',
  styleUrl: './inspector-debug-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorDebugPanel {
  readonly node = input.required<INodeView>();
  /** Parsed sidecar root (or `null` when no sidecar). */
  readonly sidecarRoot = input<Record<string, unknown> | null>(null);
  readonly overlay = input<ISidecarOverlay | undefined>(undefined);

  protected readonly texts = INSPECTOR_DEBUG_PANEL_TEXTS;

  /**
   * Key of the hash cell whose value was just copied to the clipboard
   * (`body-stored` / `body-live` / `fm-stored` / `fm-live`), or `null`.
   * Drives the inline "Copied" confirmation in that row, reverting ~2s
   * later. This is the lightweight stand-in for a global toast: the
   * feedback lives in the row that was clicked.
   */
  protected readonly copiedKey = signal<string | null>(null);

  protected readonly identityBlock = computed<IIdentityBlock>(() => {
    const root = this.sidecarRoot();
    const empty: IIdentityBlock = {
      path: null,
      bodyHash: null,
      frontmatterHash: null,
      resolvedProvider: null,
      resolvedKind: null,
    };
    if (!root) return empty;
    const f = root['identity'];
    if (typeof f !== 'object' || f === null) return empty;
    const fr = f as Record<string, unknown>;
    const resolvedAs =
      typeof fr['resolvedAs'] === 'object' && fr['resolvedAs'] !== null
        ? (fr['resolvedAs'] as Record<string, unknown>)
        : null;
    return {
      path: typeof fr['path'] === 'string' ? (fr['path'] as string) : null,
      bodyHash: typeof fr['bodyHash'] === 'string' ? (fr['bodyHash'] as string) : null,
      frontmatterHash:
        typeof fr['frontmatterHash'] === 'string' ? (fr['frontmatterHash'] as string) : null,
      resolvedProvider:
        resolvedAs && typeof resolvedAs['provider'] === 'string'
          ? (resolvedAs['provider'] as string)
          : null,
      resolvedKind:
        resolvedAs && typeof resolvedAs['kind'] === 'string'
          ? (resolvedAs['kind'] as string)
          : null,
    };
  });

  protected readonly bodyHashLive = computed<string | null>(() => this.node().bodyHash ?? null);
  protected readonly frontmatterHashLive = computed<string | null>(
    () => this.node().frontmatterHash ?? null,
  );

  protected readonly bodyHashDrift = computed<boolean>(() => {
    const stored = this.identityBlock().bodyHash;
    const live = this.bodyHashLive();
    return stored !== null && live !== null && stored !== live;
  });

  protected readonly frontmatterHashDrift = computed<boolean>(() => {
    const stored = this.identityBlock().frontmatterHash;
    const live = this.frontmatterHashLive();
    return stored !== null && live !== null && stored !== live;
  });

  /**
   * `sidecar.status` literal. `null` when no overlay is attached, or
   * when the overlay is present but parsing failed (kernel reports
   * `status: null`). The template renders `(absent)` in either case.
   */
  protected readonly sidecarStatusLiteral = computed<string | null>(() => {
    const overlay = this.overlay();
    if (!overlay) return null;
    const status = overlay.status ?? null;
    return status === null ? null : String(status);
  });

  /**
   * Copy the full hash to the clipboard and flag the row for ~2s so the
   * inline "Copied" note shows. The full 64-char digest is written, not
   * the truncated display form. A blocked clipboard leaves the row
   * untouched, see `copyToClipboard`.
   */
  protected async copyHash(key: string, value: string): Promise<void> {
    if (!(await copyToClipboard(value))) return;
    this.copiedKey.set(key);
    setTimeout(() => {
      if (this.copiedKey() === key) this.copiedKey.set(null);
    }, COPIED_FEEDBACK_MS);
  }

  /**
   * Display form for a hash: the first 20 characters followed by an
   * ellipsis. Hashes are 64-char SHA digests; the full value rides in
   * the cell's `title` so it stays available on hover / copy, while the
   * panel stays compact. Drift highlighting still compares the full
   * stored vs live values, so truncation never hides a real mismatch.
   */
  protected truncateHash(hash: string): string {
    return hash.length > 20 ? `${hash.slice(0, 20)}...` : hash;
  }
}
