/**
 * DEMO-CONTRIBUTIONS — temporary helper that sprinkles fake view
 * contributions across loaded nodes so we can validate slot layout
 * (empty / single / a few / overflow) without writing a real producer
 * plugin.
 *
 * Distribution by deterministic hash of `node.path`:
 *   bucket 0 → 0 contribs (slot stays silent — visible only via debug border)
 *   bucket 1 → 1 contrib  (single chip)
 *   bucket 2 → 3 contribs (small group, no overflow)
 *   bucket 3 → 6 contribs (5 visible + 1 hidden → `+1` overflow chip)
 *
 * The synthetic contributions use `node-counter` and
 * `node-tag` contracts, which map to BOTH `card.footer.left` and
 * `inspector.header.badge`, so they will show up in both surfaces —
 * that's the architecture working as designed (contract-first, slot
 * mapping decided by UI).
 *
 * To remove cleanly:
 *   1. Delete this file.
 *   2. Drop the import + `inject(DemoContributionsService)` + the
 *      `demo.decorate(...)` call in
 *      `ui/src/app/components/view-contributions-host/view-contributions-host.ts`.
 *   3. `grep -rn DEMO-CONTRIBUTIONS ui/src` lists the cleanup checklist.
 */

import { Injectable } from '@angular/core';

import type { IContributionApi, IContributionsRegistryEntryApi } from '../../models/api';

const PLUGIN_ID = 'demo';
const EXTENSION_ID = 'sprinkler';

const BUCKETS = 4;
const BUCKET_COUNTS: readonly number[] = [0, 1, 3, 6];

/** Pool of debug emojis — cycled by index so each demo counter gets a
 * distinguishable icon. Lets the user eyeball the icon-value spacing
 * without writing a real producer plugin. */
const DEMO_COUNTER_ICONS: readonly string[] = ['🔥', '⚡', '✨', '🎯', '🚀', '💎'];
const DEMO_TAG_ICONS: readonly string[] = ['🏷️', '🔖', '📌'];

@Injectable({ providedIn: 'root' })
export class DemoContributionsService {
  /**
   * Returns the original list plus the synthetic ones for this path.
   * Stable per path: same node gets the same bucket every render.
   */
  decorate(
    path: string,
    current: readonly IContributionApi[],
  ): readonly IContributionApi[] {
    const bucket = hashBucket(path, BUCKETS);
    const count = BUCKET_COUNTS[bucket] ?? 0;
    if (count === 0) return current;
    const synthetic: IContributionApi[] = [];
    for (let i = 0; i < count; i++) {
      synthetic.push(i % 2 === 0 ? makeCounter(path, i) : makeTag(path, i));
    }
    return [...current, ...synthetic];
  }

  /**
   * Synthetic registry entry lookup — the demo plugin does not exist
   * in the real plugin catalog, so the host's `ContributionsRegistry`
   * has no record of it. The host falls back to this method when the
   * real registry returns `undefined`. Provides icons / labels so the
   * synthetic counters look like real ones.
   */
  lookup(qualifiedId: string): IContributionsRegistryEntryApi | undefined {
    if (!qualifiedId.startsWith(`${PLUGIN_ID}/${EXTENSION_ID}/`)) return undefined;
    const contributionId = qualifiedId.split('/')[2] ?? '';
    const counterMatch = contributionId.match(/^count-(\d+)$/);
    if (counterMatch) {
      const i = Number(counterMatch[1]);
      return {
        pluginId: PLUGIN_ID,
        extensionId: EXTENSION_ID,
        contributionId,
        contract: 'node-counter',
        icon: DEMO_COUNTER_ICONS[i % DEMO_COUNTER_ICONS.length],
        label: 'demo',
        emitWhenEmpty: false,
      };
    }
    const tagMatch = contributionId.match(/^tag-(\d+)$/);
    if (tagMatch) {
      const i = Number(tagMatch[1]);
      return {
        pluginId: PLUGIN_ID,
        extensionId: EXTENSION_ID,
        contributionId,
        contract: 'node-tag',
        icon: DEMO_TAG_ICONS[i % DEMO_TAG_ICONS.length],
        label: 'demo',
        emitWhenEmpty: false,
      };
    }
    return undefined;
  }
}

function hashBucket(s: string, n: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % n;
}

function makeCounter(path: string, i: number): IContributionApi {
  return {
    pluginId: PLUGIN_ID,
    extensionId: EXTENSION_ID,
    nodePath: path,
    contributionId: `count-${i}`,
    contract: 'node-counter',
    payload: { value: (i + 1) * 7 },
  };
}

function makeTag(path: string, i: number): IContributionApi {
  const severities = ['info', 'warn', 'success', 'danger'] as const;
  return {
    pluginId: PLUGIN_ID,
    extensionId: EXTENSION_ID,
    nodePath: path,
    contributionId: `tag-${i}`,
    contract: 'node-tag',
    payload: { label: `t${i}`, severity: severities[i % severities.length] },
  };
}
