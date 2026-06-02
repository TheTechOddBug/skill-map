/**
 * `<sm-graph-layout-toolbar>`, the 3-button layout-control cluster of
 * the graph view's bottom toolbar:
 *
 *   1. Algorithm popover (vertical menu of layout algorithms).
 *   2. Direction popover (icon row, top/bottom/left/right arrows).
 *   3. Connection-type popover (icon row, segment/straight/bezier/adaptive).
 *
 * Layout spacing has no control here: it is fixed to "Normal"
 * (`DEFAULT_LAYOUT_SPACING`) in `GraphPreferencesService`. The
 * spacing -> nodeGap/layerGap machinery stays intact; only the toolbar
 * toggle + popover were removed.
 *
 * Extracted out of `graph-view.ts` so the catalogs, labelers, setters,
 * and icon tables for layout preferences live next to the markup that
 * binds them. The component reads + writes through
 * `GraphPreferencesService` directly, the parent passes nothing as
 * input. Side effects are confined to the service (which persists to
 * localStorage and ticks every subscriber signal).
 *
 * Sibling buttons in the bottom toolbar (zoom in/out, fit-to-screen,
 * reset-layout) stay in `<sm-graph-view>` because they coordinate with
 * the canvas + node-position state, which would otherwise require
 * threading every viewport / state signal through an input.
 */

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { PopoverModule } from 'primeng/popover';
import { TooltipModule } from 'primeng/tooltip';

import { GRAPH_VIEW_TEXTS } from '../../../../i18n/graph-view.texts';
import {
  CONNECTION_TYPES,
  GraphPreferencesService,
  type TConnectionType,
} from '../../../../services/graph-preferences';
import {
  LAYOUT_ALGORITHMS,
  LAYOUT_DIRECTIONS,
  algorithmUsesDirection,
  type TLayoutAlgorithm,
  type TLayoutDirection,
} from '../layout-controls';

/**
 * PrimeIcon class for each layout direction. The toolbar button shows
 * the active mode's arrow so the operator sees the flow direction at
 * a glance without opening the popover. Same table is reused inside
 * the popover so each option button paints with its own arrow icon.
 */
const DIRECTION_ICONS: Readonly<Record<TLayoutDirection, string>> = {
  TOP_BOTTOM: 'pi pi-arrow-down',
  BOTTOM_TOP: 'pi pi-arrow-up',
  LEFT_RIGHT: 'pi pi-arrow-right',
  RIGHT_LEFT: 'pi pi-arrow-left',
};

/**
 * SVG `path d` per connector shape preset, drawn into a 16×16 viewBox
 * (`graph__connection-svg`). Each path traces a tiny "edge" from the
 * bottom-left (2,14) to the top-right (14,2) so the four options read
 * as variations of the same connector. Square viewBox lets the toggle
 * sit flush with the sibling PrimeIcons in the toolbar (which are all
 * 16×16). Stroke uses `currentColor` so the glyph picks up the
 * button's hover / active tint automatically.
 *   - `segment` (orthogonal):    Z-shape with two right-angle corners
 *   - `straight`:                single diagonal segment
 *   - `bezier`:                  cubic curve with offset control points
 *   - `adaptive-curve`:          cubic curve whose control tangents
 *                                align with the connector orientation
 * The tooltip carries the real name so a reader who finds the glyph
 * ambiguous can still disambiguate without opening the popover.
 */
const CONNECTION_TYPE_PATHS: Readonly<Record<TConnectionType, string>> = {
  segment: 'M 2 14 L 8 14 L 8 2 L 14 2',
  straight: 'M 2 14 L 14 2',
  bezier: 'M 2 14 C 6 14, 10 2, 14 2',
  'adaptive-curve': 'M 2 14 C 8 14, 8 2, 14 2',
};

@Component({
  selector: 'sm-graph-layout-toolbar',
  imports: [ButtonModule, PopoverModule, TooltipModule],
  templateUrl: './graph-layout-toolbar.html',
  styleUrl: './graph-layout-toolbar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GraphLayoutToolbar {
  private readonly graphPreferences = inject(GraphPreferencesService);

  protected readonly texts = GRAPH_VIEW_TEXTS;

  // Catalogs the popovers iterate over. Same closed enums the Settings
  // modal uses, the toolbar surface keeps both in sync via labels
  // resolved against `SETTINGS_TEXTS`.
  protected readonly layoutAlgorithms = LAYOUT_ALGORITHMS;
  protected readonly layoutDirections = LAYOUT_DIRECTIONS;
  protected readonly connectionTypes = CONNECTION_TYPES;

  // Direct re-exposes of the preferences signals so the template binds
  // to them without a wrapper. Setters delegate to the service, which
  // writes localStorage and notifies every consumer signal.
  protected readonly layoutAlgorithm = this.graphPreferences.layoutAlgorithm;
  protected readonly layoutDirection = this.graphPreferences.layoutDirection;
  protected readonly connectionType = this.graphPreferences.connectionType;

  /**
   * Dynamic PrimeIcon for the direction button: the arrow head points
   * the way the graph flows, so the operator sees the active mode
   * without opening the popover. Keys mirror `EFLayoutDirection`.
   */
  protected readonly directionIcon = computed(
    () => DIRECTION_ICONS[this.layoutDirection()],
  );

  /**
   * Whether the active algorithm honours the `direction` preference.
   * Force-directed layouts don't have a flow direction, the toolbar
   * disables the direction button and swaps its tooltip to explain.
   */
  protected readonly directionAvailable = computed(() =>
    algorithmUsesDirection(this.layoutAlgorithm()),
  );

  protected layoutAlgorithmLabel(value: TLayoutAlgorithm): string {
    return GRAPH_VIEW_TEXTS.layout.algorithm.options[value].label;
  }

  protected layoutDirectionLabel(value: TLayoutDirection): string {
    return GRAPH_VIEW_TEXTS.layout.direction.options[value].label;
  }

  protected connectionTypeLabel(value: TConnectionType): string {
    return GRAPH_VIEW_TEXTS.layout.connection.options[value].label;
  }

  protected setLayoutAlgorithm(value: TLayoutAlgorithm): void {
    this.graphPreferences.setLayoutAlgorithm(value);
  }

  protected setLayoutDirection(value: TLayoutDirection): void {
    this.graphPreferences.setLayoutDirection(value);
  }

  protected setConnectionType(value: TConnectionType): void {
    this.graphPreferences.setConnectionType(value);
  }

  /**
   * Per-value PrimeIcon for the direction popover items, used so the
   * popover renders four arrows instead of "Top to bottom / Bottom
   * to top / ..." text. The label still flows through the
   * `aria-label` and tooltip for screen-reader users.
   */
  protected directionItemIcon(value: TLayoutDirection): string {
    return DIRECTION_ICONS[value];
  }

  /**
   * SVG `path d` for the connection-type popover items. Drawn inline
   * (PrimeIcons has no purpose-built line-shape set; a custom 16×16
   * viewBox shows the actual edge shape the option produces).
   */
  protected connectionTypeItemPath(value: TConnectionType): string {
    return CONNECTION_TYPE_PATHS[value];
  }
}
