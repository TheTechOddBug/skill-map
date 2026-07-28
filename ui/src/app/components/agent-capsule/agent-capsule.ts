/**
 * `<sm-agent-capsule>`, the ephemeral capsule rendered on the graph
 * for a runtime sub-agent that resolved to NO scanned node
 * (`spec/provider-activity.md` §WS event: `agent.spawn`, unresolved
 * children): a vendor built-in like an explorer or planner agent, with
 * no file on disk. One capsule aggregates every live spawn of the same
 * (anchor, name) pair; the badge carries the live-run count.
 *
 * Purely presentational, sibling of `<sm-session-node>`: a dashed
 * capsule on the spawn accent with a robot glyph and the child name
 * exactly as the runtime reported it. The Foblex `[fNode]` wrapper
 * (id, position, drag, the target fConnector) is owned by the graph
 * view template, mirroring how `<sm-node-card>` mounts, so Foblex's
 * content queries see the connectors as direct children of `[fNode]`.
 */

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { AGENT_CAPSULE_TEXTS } from '../../../i18n/agent-capsule.texts';

@Component({
  selector: 'sm-agent-capsule',
  imports: [TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'sm-agent-capsule',
    '[attr.aria-label]': 'a11yLabel()',
  },
  template: `
    <span
      class="sm-agent-capsule__body"
      [pTooltip]="tooltip()"
      tooltipPosition="top"
      data-testid="agent-capsule-body"
    >
      <i class="fa-solid fa-robot sm-agent-capsule__glyph" aria-hidden="true"></i>
      <span class="sm-agent-capsule__label" data-testid="agent-capsule-label">{{ name() }}</span>
      @if (count() > 1) {
        <span class="sm-agent-capsule__count" data-testid="agent-capsule-count">{{
          countLabel()
        }}</span>
      }
    </span>
  `,
  styles: [
    `
      /* Dashed capsule on the spawn accent, one ephemeral system with
         the session anchor and the dashed edges. Sized to the
         VAGENT_NODE_WIDTH/HEIGHT constants in spawn-overlay.ts, keep
         them in sync. No transform/transition here, Foblex owns the
         wrapper's translate (foblex-flow skill rule 3). */
      :host {
        display: flex;
        width: 170px;
        height: 36px;
      }
      .sm-agent-capsule__body {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.4rem;
        width: 100%;
        padding: 0 0.6rem;
        border: 1.5px dashed var(--sm-edge-spawn);
        border-radius: var(--sm-radius-pill);
        background: color-mix(in srgb, var(--sm-edge-spawn) 10%, transparent);
        color: var(--sm-edge-spawn);
        font-size: var(--sm-fs-xs);
        font-weight: 600;
        user-select: none;
      }
      .sm-agent-capsule__glyph {
        font-size: var(--sm-fs-xs);
      }
      .sm-agent-capsule__label {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .sm-agent-capsule__count {
        flex: none;
        padding: 0 0.35rem;
        border-radius: var(--sm-radius-pill);
        background: color-mix(in srgb, var(--sm-edge-spawn) 22%, transparent);
        font-size: var(--sm-fs-xs);
      }
    `,
  ],
})
export class AgentCapsule {
  /** The child unit's name, exactly as the runtime reported it. */
  readonly name = input.required<string>();
  /** The child unit's kind, when the runtime reported one. */
  readonly kind = input<string | undefined>(undefined);
  /** Live spawns aggregated into this capsule. */
  readonly count = input.required<number>();

  protected readonly countLabel = computed(() => AGENT_CAPSULE_TEXTS.count(this.count()));
  protected readonly tooltip = computed(() =>
    AGENT_CAPSULE_TEXTS.tooltip(this.name(), this.kind(), this.count()),
  );
  protected readonly a11yLabel = computed(() =>
    AGENT_CAPSULE_TEXTS.a11y(this.name(), this.count()),
  );
}
