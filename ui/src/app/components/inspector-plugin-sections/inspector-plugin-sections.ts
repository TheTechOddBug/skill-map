/**
 * `<sm-inspector-plugin-sections [node]="..." />`, the inspector body's
 * per-plugin contribution surface.
 *
 * Groups a node's `inspector.body.panel.*` contributions into ONE
 * collapsible section per plugin (titled by the trusted `pluginId`),
 * replacing the former shared "View contributions" drawer and the
 * retired `inspector.body.section` slot. Each plugin owns its own
 * space: a contribution only ever lands in its own plugin's section
 * because the grouping key is the contribution's `pluginId` (stamped by
 * the kernel from the extension identity, never the payload).
 *
 * Ordering (inspector-only, from the new manifest `order` fields,
 * default 100):
 *   - sections by `pluginOrder` ASC, tie-break by plugin id;
 *   - bricks within a section by `extensionOrder` ASC, then the
 *     contribution `priority`, then qualified id.
 *
 * Sections default COLLAPSED; the per-plugin collapse state is owned
 * here (a localStorage-backed signal map), independent of the inspector
 * view's static-section controller. Renderers come from the closed
 * `SLOT_RENDERERS` catalog via `NgComponentOutlet`; payload shaping is
 * the shared `buildRendererInputs` helper (same as `view-contributions-host`).
 */

import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';

import { CollapsibleSection } from '../collapsible-section/collapsible-section';
import { ContributionsRegistryService } from '../../services/contributions-registry';
import { buildRendererInputs } from '../../slots/build-renderer-inputs';
import { INSPECTOR_BODY_PANEL_SLOTS, type TSlotId } from '../../slots/slot-config';
import { SLOT_RENDERERS, isKnownSlot, type IRendererInputs } from '../../slots/slot-renderer-map';
import type { IContributionApi } from '../../../models/api';
import type { IHostNode } from '../view-contributions-host/view-contributions-host';

interface IBrick {
  qualifiedId: string;
  slot: TSlotId;
  rendererInputs: IRendererInputs;
}

interface IPluginGroup {
  pluginId: string;
  pluginOrder: number;
  bricks: IBrick[];
}

const COLLAPSE_STORAGE_KEY = 'skill-map.ui.inspector.plugin-sections';
const DEFAULT_ORDER = 100;

@Component({
  selector: 'sm-inspector-plugin-sections',
  imports: [NgComponentOutlet, CollapsibleSection],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (group of groups(); track group.pluginId) {
      <sm-collapsible-section
        [title]="group.pluginId"
        [expanded]="expanded(group.pluginId)"
        [toggleTestid]="'inspector-plugin-section-toggle-' + group.pluginId"
        (toggle)="toggle(group.pluginId)"
        [attr.data-testid]="'inspector-plugin-section-' + group.pluginId"
      >
        @if (expanded(group.pluginId)) {
          <div class="ips__bricks">
            @for (brick of group.bricks; track brick.qualifiedId) {
              <div
                class="ips__brick"
                [attr.data-testid]="'contribution-' + brick.qualifiedId.replaceAll('/', '-')"
              >
                <ng-container
                  *ngComponentOutlet="
                    rendererFor(brick.slot);
                    inputs: { inputs: brick.rendererInputs }
                  "
                />
              </div>
            }
          </div>
        }
      </sm-collapsible-section>
    }
  `,
  styles: [`
    /* Transparent to layout so each <sm-collapsible-section> becomes a
       direct flex child of the parent .inspector column and inherits its
       0.75rem gap, matching the spacing between the built-in sections.
       Same pattern as view-contributions-host. */
    :host { display: contents; }
    .ips__bricks { display: flex; flex-direction: column; gap: 0.6rem; }
    .ips__brick { display: block; }
  `],
})
export class InspectorPluginSections {
  readonly node = input<IHostNode | null>(null);

  private readonly registry = inject(ContributionsRegistryService);

  /** Per-plugin collapse state, persisted; missing key = collapsed. */
  private readonly collapseState = signal<Record<string, boolean>>(readCollapseState());

  protected readonly groups = computed<IPluginGroup[]>(() => {
    const node = this.node();
    if (!node) return [];
    const contributions = (node.contributions ?? []).filter(
      (c) => isKnownSlot(c.slot) && INSPECTOR_BODY_PANEL_SLOTS.has(c.slot as TSlotId),
    );
    if (contributions.length === 0) return [];

    const byPlugin = new Map<string, IContributionApi[]>();
    for (const c of contributions) {
      const list = byPlugin.get(c.pluginId);
      if (list) list.push(c);
      else byPlugin.set(c.pluginId, [c]);
    }

    const groups: IPluginGroup[] = [];
    for (const [pluginId, cs] of byPlugin) {
      let pluginOrder = DEFAULT_ORDER;
      const ranked = cs
        .map((c) => {
          const qualifiedId = `${c.pluginId}/${c.extensionId}/${c.contributionId}`;
          const reg = this.registry.get(qualifiedId);
          if (typeof reg?.pluginOrder === 'number') pluginOrder = reg.pluginOrder;
          return {
            c,
            qualifiedId,
            extensionOrder: reg?.extensionOrder ?? DEFAULT_ORDER,
            priority: reg?.priority ?? DEFAULT_ORDER,
            inputs: buildRendererInputs(c, c.slot as TSlotId, node.path, reg),
          };
        })
        .sort((a, b) => {
          if (a.extensionOrder !== b.extensionOrder) return a.extensionOrder - b.extensionOrder;
          if (a.priority !== b.priority) return a.priority - b.priority;
          return a.qualifiedId < b.qualifiedId ? -1 : a.qualifiedId > b.qualifiedId ? 1 : 0;
        });
      groups.push({
        pluginId,
        pluginOrder,
        bricks: ranked.map((r) => ({
          qualifiedId: r.qualifiedId,
          slot: r.c.slot as TSlotId,
          rendererInputs: r.inputs,
        })),
      });
    }

    groups.sort((a, b) => {
      if (a.pluginOrder !== b.pluginOrder) return a.pluginOrder - b.pluginOrder;
      return a.pluginId < b.pluginId ? -1 : a.pluginId > b.pluginId ? 1 : 0;
    });
    return groups;
  });

  protected expanded(pluginId: string): boolean {
    return this.collapseState()[pluginId] ?? false;
  }

  protected toggle(pluginId: string): void {
    this.collapseState.update((s) => ({ ...s, [pluginId]: !(s[pluginId] ?? false) }));
    persistCollapseState(this.collapseState());
  }

  protected rendererFor(slot: TSlotId) {
    return SLOT_RENDERERS[slot];
  }
}

function readCollapseState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function persistCollapseState(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable (private mode / quota); collapse state is
    // best-effort, so a failed persist is silently ignored.
  }
}
