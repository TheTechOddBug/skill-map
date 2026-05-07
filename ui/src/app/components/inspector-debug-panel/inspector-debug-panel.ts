/**
 * `<sm-inspector-debug-panel>` — diagnostic surface the catalog
 * curation hides by default. Toggled on / off via the inspector's
 * header `i` button. Renders:
 *
 *   - `for.path` (sanity-check the sidecar binding)
 *   - `for.bodyHash` (stored) vs live `node.bodyHash`, diff highlighted
 *   - `for.frontmatterHash` (stored) vs live `node.frontmatterHash`,
 *     diff highlighted
 *   - `for.resolvedAs.{provider, kind}` when present
 *   - `sidecar.status` enum literal
 *   - `sidecar.present` boolean
 *
 * The panel reads the sidecar root payload (the parsed YAML) from the
 * inspector. When the sidecar isn't present, it just renders the live
 * hashes and the `sidecar.present: false` flag.
 */

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { INSPECTOR_DEBUG_PANEL_TEXTS } from '../../../i18n/inspector-debug-panel.texts';
import type { ISidecarOverlay, INodeView } from '../../../models/node';

interface IForBlock {
  path: string | null;
  bodyHash: string | null;
  frontmatterHash: string | null;
  resolvedProvider: string | null;
  resolvedKind: string | null;
}

@Component({
  selector: 'sm-inspector-debug-panel',
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

  protected readonly forBlock = computed<IForBlock>(() => {
    const root = this.sidecarRoot();
    const empty: IForBlock = {
      path: null,
      bodyHash: null,
      frontmatterHash: null,
      resolvedProvider: null,
      resolvedKind: null,
    };
    if (!root) return empty;
    const f = root['for'];
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
    const stored = this.forBlock().bodyHash;
    const live = this.bodyHashLive();
    return stored !== null && live !== null && stored !== live;
  });

  protected readonly frontmatterHashDrift = computed<boolean>(() => {
    const stored = this.forBlock().frontmatterHash;
    const live = this.frontmatterHashLive();
    return stored !== null && live !== null && stored !== live;
  });

  protected readonly resolvedAsPresent = computed<boolean>(() => {
    const f = this.forBlock();
    return f.resolvedProvider !== null || f.resolvedKind !== null;
  });

  protected readonly sidecarStatusLiteral = computed<string>(() => {
    const status = this.overlay()?.status ?? null;
    return status === null ? 'null' : String(status);
  });

  protected readonly sidecarPresent = computed<boolean>(() => this.overlay()?.present === true);
}
