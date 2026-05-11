/**
 * Sidecar-drift extractor. Reads `node.sidecar.status` and, when the
 * sidecar exists but is NOT `'fresh'`, surfaces a `pi-sync` corner
 * badge in the `graph.node.alert` slot so the operator sees at a
 * glance which nodes drifted from their last bump.
 *
 * Severity is uniform `warn` across the three stale states; the
 * worst case (`stale-both`) is differentiated by a `count: 2` badge
 * next to the icon, matching the rest of the catalog's "icon + count"
 * convention for alert slots.
 *
 * Frontmatter-scope — the sidecar overlay is built by the kernel
 * before extractors run, so the body is never read here. No link
 * emissions. Applies to every kind (any node that carries a sidecar
 * can drift).
 */

import type { IExtractor, IExtractorContext } from '../../../kernel/extensions/index.js';
import type { SidecarStatus } from '../../../kernel/types.js';
import { SIDECAR_DRIFT_TEXTS } from '../../i18n/sidecar-drift.texts.js';

const ID = 'sidecar-drift';

export const sidecarDriftExtractor: IExtractor = {
  id: ID,
  pluginId: 'core',
  kind: 'extractor',
  version: '1.0.0',
  description:
    'Marks nodes whose `.sm` sidecar is out of sync with the file content — shows a small sync badge on the node so the operator can spot drift at a glance. Run `sm bump <path>` to refresh.',
  stability: 'stable',
  emitsLinkKinds: [],
  defaultConfidence: 'high',
  scope: 'frontmatter',

  viewContributions: {
    drift: {
      slot: 'graph.node.alert',
      icon: 'sync',
      emitWhenEmpty: false,
    },
  },

  extract(ctx: IExtractorContext): void {
    const sidecar = ctx.node.sidecar;
    if (!sidecar || sidecar.present !== true) return;
    const status = sidecar.status;
    if (!status || status === 'fresh') return;

    const payload: {
      icon: string;
      severity: 'warn';
      tooltip: string;
      count?: number;
    } = {
      icon: 'sync',
      severity: 'warn',
      tooltip: tooltipFor(status),
    };
    if (status === 'stale-both') payload.count = 2;
    ctx.emitContribution('drift', payload);
  },
};

function tooltipFor(status: Exclude<SidecarStatus, 'fresh'>): string {
  switch (status) {
    case 'stale-body':
      return SIDECAR_DRIFT_TEXTS.staleBody;
    case 'stale-frontmatter':
      return SIDECAR_DRIFT_TEXTS.staleFrontmatter;
    case 'stale-both':
      return SIDECAR_DRIFT_TEXTS.staleBoth;
  }
}
