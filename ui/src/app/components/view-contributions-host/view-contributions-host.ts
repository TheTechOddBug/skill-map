/**
 * `<sm-view-contributions-host slot="..." [node]="..." />` — generic
 * slot dispatcher for the View contribution system.
 *
 * Reads `node.contributions[]`, filters by the slot's compatible
 * contracts (via `CONTRACT_SLOTS`), sorts per `SLOT_REGISTRY`, applies
 * `maxItems` (overflow → `+N` chip), and instantiates the matching
 * renderer component per contribution via `NgComponentOutlet` so each
 * renderer stays standalone and the host stays slim.
 *
 * No DOM injection from plugins (isolation rule #1). No payload
 * mutation (rule #5: AJV at three layers — manifest, emit, envelope).
 * Each rendered child is the corresponding entry from
 * `CONTRACT_RENDERERS` — a closed catalog the UI ships, never the
 * plugin.
 *
 * Mounting: see `inspector-view`, `node-card`, `graph-view` templates.
 * One host per slot per template.
 *
 * `data-testid` convention (per `context/view-contributions.md`):
 *   - host root → `view-contributions-host-<slot-id-kebab>`
 *   - per-instance wrapper → `contribution-<plugin>-<extension>-<contribution>`
 */

import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { TooltipModule } from 'primeng/tooltip';

import type { IContributionApi } from '../../../models/api';

/**
 * Minimal node shape this host needs. Decoupled from `INodeApi` /
 * `INodeView` so the host stays callable from any view that has a
 * `contributions` array — including the static demo fixtures and the
 * `INodeView`-based inspector.
 */
export interface IHostNode {
  path: string;
  contributions?: readonly IContributionApi[];
}
import { ContributionsRegistryService } from '../../services/contributions-registry';
import {
  CONTRACT_RENDERERS,
  CONTRACT_SLOTS,
  isKnownContract,
  type IRendererInputs,
  type TContractId,
} from '../../contracts/contract-renderer-map';
import { SLOT_REGISTRY, type TSlotId } from '../../slots/slot-config';
import { VIEW_CONTRIBUTIONS_TEXTS } from '../../../i18n/view-contributions.texts';

interface IDispatchedItem {
  qualifiedId: string;
  contract: TContractId;
  rendererInputs: IRendererInputs;
}

@Component({
  selector: 'sm-view-contributions-host',
  standalone: true,
  imports: [NgComponentOutlet, TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible().length > 0 || overflowCount() > 0) {
      <span
        class="vch"
        [attr.data-testid]="'view-contributions-host-' + testidSuffix()"
      >
        @for (item of visible(); track item.qualifiedId) {
          <span
            class="vch__slot"
            [attr.data-testid]="'contribution-' + item.qualifiedId.replaceAll('/', '-')"
          >
            <ng-container
              *ngComponentOutlet="
                rendererFor(item.contract);
                inputs: { inputs: item.rendererInputs }
              "
            />
          </span>
        }
        @if (overflowCount() > 0) {
          <span
            class="vch__overflow"
            [pTooltip]="overflowTooltip()"
            data-testid="view-contributions-host-overflow"
          >
            {{ overflowBadge() }}
          </span>
        }
      </span>
    }
  `,
  styles: [`
    .vch { display: inline-flex; align-items: center; gap: 0.25rem;
      flex-wrap: wrap; }
    .vch__slot { display: inline-flex; }
    .vch__overflow { display: inline-flex; align-items: center;
      padding: 0.125rem 0.5rem; border-radius: 0.75rem;
      background: var(--p-surface-100); color: var(--p-surface-600);
      font-size: 0.8rem; cursor: default; }
  `],
})
export class ViewContributionsHost {
  /** Slot id this host instance owns. Drives sort + cardinality. */
  readonly slot = input.required<TSlotId>();
  /**
   * Node whose contributions feed this host. The host filters
   * `node.contributions[]` to entries whose contract maps to this
   * slot (via `CONTRACT_SLOTS`). When the node is missing or carries
   * no `contributions` array (cold-start, demo mode, bulk-omitted),
   * the host renders nothing.
   *
   * Typed loosely (`IHostNode`) so any view with a `contributions`
   * array can mount the host — `INodeApi`, `INodeView`, demo
   * fixtures, etc.
   */
  readonly node = input<IHostNode | null>(null);

  protected readonly testidSuffix = computed(() => this.slot().replaceAll('.', '-'));

  /**
   * The full filtered + ordered list. Internal — used by `visible`
   * + `overflowCount` to compute the cap.
   */
  private readonly registry = inject(ContributionsRegistryService);

  protected readonly dispatched = computed<IDispatchedItem[]>(() => {
    const node = this.node();
    if (!node) return [];
    const contributions = node.contributions ?? [];
    if (contributions.length === 0) return [];
    const slot = this.slot();
    const matching = contributions
      .filter((c) => contractMatchesSlot(c.contract, slot))
      .filter((c) => isKnownContract(c.contract));
    return this.sortBySlotOrder(matching, slot).map((c) => ({
      qualifiedId: `${c.pluginId}/${c.extensionId}/${c.contributionId}`,
      contract: c.contract as TContractId,
      rendererInputs: this.buildInputs(c, slot),
    }));
  });

  protected readonly visible = computed<IDispatchedItem[]>(() => {
    const all = this.dispatched();
    const cap = SLOT_REGISTRY[this.slot()].maxItems;
    return all.slice(0, cap);
  });

  protected readonly overflowCount = computed(() => {
    const all = this.dispatched();
    const cap = SLOT_REGISTRY[this.slot()].maxItems;
    return Math.max(0, all.length - cap);
  });

  protected readonly overflowBadge = computed(
    () => VIEW_CONTRIBUTIONS_TEXTS.overflowBadge(this.overflowCount()),
  );

  protected readonly overflowTooltip = computed(() => {
    const all = this.dispatched();
    const cap = SLOT_REGISTRY[this.slot()].maxItems;
    const hidden = all.slice(cap).map((i) => i.qualifiedId).join(', ');
    return VIEW_CONTRIBUTIONS_TEXTS.overflowTooltip(hidden);
  });

  protected rendererFor(contract: TContractId) {
    return CONTRACT_RENDERERS[contract];
  }

  private buildInputs(c: IContributionApi, slot: TSlotId): IRendererInputs {
    const qualified = `${c.pluginId}/${c.extensionId}/${c.contributionId}`;
    const reg = this.registry.get(qualified);
    const respectSeverity = SLOT_REGISTRY[slot].respectSeverity !== false;
    let payload = c.payload;
    if (!respectSeverity && typeof payload === 'object' && payload !== null && 'severity' in payload) {
      const { severity: _drop, ...rest } = payload as Record<string, unknown>;
      payload = rest;
    }
    const inputs: IRendererInputs = {
      pluginId: c.pluginId,
      extensionId: c.extensionId,
      contributionId: c.contributionId,
      payload,
    };
    if (reg?.label) inputs.label = reg.label;
    if (reg?.tooltip) inputs.tooltip = reg.tooltip;
    if (reg?.icon) inputs.icon = reg.icon;
    if (reg?.emptyText) inputs.emptyText = reg.emptyText;
    return inputs;
  }

  private sortBySlotOrder(items: IContributionApi[], slot: TSlotId): IContributionApi[] {
    const order = SLOT_REGISTRY[slot].order;
    if (order === 'fifo') return items.slice();
    if (order === 'priority') {
      return items.slice().sort((a, b) => {
        const pa = this.priorityFor(a);
        const pb = this.priorityFor(b);
        if (pa !== pb) return pa - pb;
        return qualifiedIdCmp(a, b);
      });
    }
    return items.slice().sort(qualifiedIdCmp);
  }

  private priorityFor(c: IContributionApi): number {
    const qualified = `${c.pluginId}/${c.extensionId}/${c.contributionId}`;
    return this.registry.get(qualified)?.priority ?? 100;
  }
}

function contractMatchesSlot(contract: string, slot: TSlotId): boolean {
  if (!isKnownContract(contract)) return false;
  return CONTRACT_SLOTS[contract].includes(slot);
}

function qualifiedIdCmp(a: IContributionApi, b: IContributionApi): number {
  const ka = `${a.pluginId}/${a.extensionId}/${a.contributionId}`;
  const kb = `${b.pluginId}/${b.extensionId}/${b.contributionId}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

