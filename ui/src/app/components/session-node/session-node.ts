/**
 * `<sm-session-node>`, the virtual session anchor rendered on the
 * graph while Real Time is on and a main context has live spawns
 * (`spec/provider-activity.md` §WS event: `agent.spawn`, session
 * parents).
 *
 * Purely presentational: a dashed capsule with a terminal glyph and a
 * page-lifetime "Session N" label; the opaque owner key surfaces only
 * in the tooltip. The Foblex `[fNode]` wrapper (id, position,
 * drag/selection disabling, the source fConnector) is owned by the
 * graph view template, mirroring how `<sm-node-card>` mounts, so
 * Foblex's content queries see the connectors as direct children of
 * `[fNode]`.
 */

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { SESSION_NODE_TEXTS } from '../../../i18n/session-node.texts';

@Component({
  selector: 'sm-session-node',
  imports: [TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'sm-session-node',
    '[attr.aria-label]': 'a11yLabel()',
  },
  template: `
    <span
      class="sm-session-node__body"
      [pTooltip]="tooltip()"
      tooltipPosition="top"
      data-testid="session-node-body"
    >
      <i class="fa-solid fa-terminal sm-session-node__glyph" aria-hidden="true"></i>
      <span class="sm-session-node__label" data-testid="session-node-label">{{ label() }}</span>
    </span>
  `,
  styles: [
    `
      /* Dashed capsule on the session accent (the spawn-edge hue), so
         anchor and edges read as one ephemeral system. Sized to the
         SESSION_NODE_WIDTH/HEIGHT constants in spawn-overlay.ts, keep
         them in sync. No transform/transition here, Foblex owns the
         wrapper's translate (foblex-flow skill rule 3). */
      :host {
        display: flex;
        width: 170px;
        height: 44px;
      }
      .sm-session-node__body {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.45rem;
        width: 100%;
        border: 1.5px dashed var(--sm-edge-spawn);
        border-radius: var(--sm-radius-pill);
        background: color-mix(in srgb, var(--sm-edge-spawn) 10%, transparent);
        color: var(--sm-edge-spawn);
        font-size: var(--sm-fs-sm);
        font-weight: 600;
        user-select: none;
      }
      .sm-session-node__glyph {
        font-size: var(--sm-fs-xs);
      }
    `,
  ],
})
export class SessionNode {
  /** Page-lifetime ordinal assigned by `AgentSpawnService`. */
  readonly ordinal = input.required<number>();
  /** Opaque session owner key (tooltip only, never parsed). */
  readonly owner = input.required<string>();

  protected readonly label = computed(() => SESSION_NODE_TEXTS.label(this.ordinal()));
  protected readonly tooltip = computed(() => SESSION_NODE_TEXTS.tooltip(this.owner()));
  protected readonly a11yLabel = computed(() => SESSION_NODE_TEXTS.a11y(this.ordinal()));
}
