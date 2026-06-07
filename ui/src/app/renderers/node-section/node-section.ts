import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';

import type { IRendererInputs } from '../../slots/slot-renderer-map';
import { isSystemPluginId } from '../../slots/system-plugin-ids';
import { isObjectPayload, isArrayField } from '../../slots/renderer-payload-guards';
import { CollapsibleSection } from '../../components/collapsible-section/collapsible-section';
import { NodeKeyValues } from '../node-key-values/node-key-values';
import { Icon } from '../../slots/icon';
import { NODE_SECTION_TEXTS } from './node-section.texts';

/**
 * Renderer for the `inspector.body.section` slot: a plugin-owned,
 * collapsible inspector zone.
 *
 * Each contribution paints its OWN `<sm-collapsible-section>` (the same
 * vocabulary the inspector's built-in body sections use) titled by the
 * non-falsifiable prefix rule:
 *
 *   - drop-in plugin -> `<pluginId>:<zone>`
 *   - system (bundled) plugin -> `<zone>` (no prefix)
 *
 * The `<pluginId>:` prefix is applied HERE, from the contribution's
 * `pluginId` (threaded by the host from `scan_contributions`), never
 * from the payload, so a plugin can never disguise its zone as a system
 * section. Whether a plugin is "system" is decided by the closed
 * `isSystemPluginId` set (mirror of `src/plugins/ids.ts`).
 *
 * The zone's collapse state is OWNED by this renderer (unlike the
 * inspector body sections, whose state lives in `InspectorView`): the
 * payload's `defaultCollapsed` seeds the initial expanded value, and the
 * user can toggle it locally. Content is a key/value definition list,
 * reusing `<sm-node-key-values>` (same payload shape as
 * `inspector.body.panel.key-values`).
 *
 * LINT (renderer attr-sanitization, see context/view-slots.md):
 * contribution data is bound only via the collapsible-section title
 * (interpolated text), the `<sm-icon>` resolver (trusted-string
 * discriminator, never raw markup), and `<sm-node-key-values>` (text
 * interpolation). No `[innerHTML]` / `[style]` / `[src]` / `[href]`.
 */
interface ISectionEntry {
  key: string;
  value: string | number | boolean | null;
  tooltip?: string;
}

interface INodeSectionPayload {
  zone?: string;
  defaultCollapsed?: boolean;
  icon?: string;
  entries?: ISectionEntry[];
}

@Component({
  selector: 'sm-node-section',
  imports: [CollapsibleSection, NodeKeyValues, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sm-collapsible-section
      class="vc-section"
      [title]="title()"
      [expanded]="expanded()"
      [toggleAriaLabel]="title() || texts.toggleAriaFallback"
      [toggleTestid]="'renderer-node-section-toggle'"
      (toggle)="toggle()"
      [attr.data-testid]="'renderer-node-section'"
    >
      @if (icon()) {
        <span smSectionTitleExtra class="vc-section__icon"><sm-icon [icon]="icon()" /></span>
      }
      @if (expanded()) {
        <sm-node-key-values [inputs]="kvInputs()" />
      }
    </sm-collapsible-section>
  `,
  styles: [`
    .vc-section__icon { display: inline-flex; align-items: center;
      font-size: 0.75rem; margin-left: 0.4rem;
      color: var(--p-text-muted-color); }
  `],
})
export class NodeSection {
  readonly inputs = input.required<IRendererInputs>();
  protected readonly texts = NODE_SECTION_TEXTS;

  protected readonly typed = computed<INodeSectionPayload>(() => {
    const p = this.inputs().payload;
    if (!isObjectPayload(p)) return {};
    return p as INodeSectionPayload;
  });

  /** Plugin-chosen zone name; empty when the payload is malformed. */
  protected readonly zone = computed<string>(() => {
    const z = this.typed().zone;
    return typeof z === 'string' ? z : '';
  });

  /**
   * The rendered section title. Built-in (system) plugins show the bare
   * zone name; every other plugin gets the non-falsifiable
   * `<pluginId>:<zone>` prefix applied here from the contribution's
   * `pluginId`.
   */
  protected readonly title = computed<string>(() => {
    const zone = this.zone();
    if (!zone) return '';
    const pluginId = this.inputs().pluginId;
    return isSystemPluginId(pluginId) ? zone : `${pluginId}:${zone}`;
  });

  /** Optional zone icon, prefers the payload, then the manifest icon. */
  protected readonly icon = computed<string | undefined>(
    () => this.typed().icon ?? this.inputs().icon,
  );

  /**
   * Local collapse state. Seeded from `defaultCollapsed` on first read
   * (a section that declares `defaultCollapsed: true` starts collapsed),
   * then owned by the user's toggles. A `WritableSignal` initialized lazily
   * via the seeded computed keeps the seed in sync if the input ever swaps.
   */
  private readonly userToggled = signal<boolean | null>(null);

  protected readonly expanded = computed<boolean>(() => {
    const override = this.userToggled();
    if (override !== null) return override;
    return this.typed().defaultCollapsed !== true;
  });

  /**
   * Inputs forwarded to the embedded `<sm-node-key-values>`. The zone's
   * `entries` become the key-values payload; the manifest empty text is
   * threaded so an empty zone reads sensibly. The renderer's own
   * `pluginId` / `extensionId` / etc. ride along unchanged.
   */
  protected readonly kvInputs = computed<IRendererInputs>(() => {
    const entries = isArrayField(this.typed(), 'entries') ? this.typed().entries : [];
    return {
      ...this.inputs(),
      // `node-key-values` renders an optional <h5> from `label`; the
      // section title already names the zone, so suppress the inner
      // header to avoid a redundant heading.
      label: undefined,
      emptyText: this.inputs().emptyText ?? this.texts.emptyEntries,
      payload: { entries },
    };
  });

  protected toggle(): void {
    this.userToggled.set(!this.expanded());
  }
}
