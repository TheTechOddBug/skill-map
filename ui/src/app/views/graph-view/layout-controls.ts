/**
 * Layout preference catalogues for the graph view. Mirrors the helpers
 * the Foblex team ships in `libs/f-examples/plugins/f-layout/utils/`
 * (their f-flow demo), reshaped to skill-map conventions:
 *
 *   - Plain string unions instead of re-exporting Foblex enums, so the
 *     wire literal lives in localStorage and config files without an
 *     enum bridge.
 *   - `option` arrays carry `labelKey` (i18n catalogue key) rather than
 *     a baked-in label, the Settings UI resolves the label at template
 *     time against `SETTINGS_TEXTS`.
 *
 * The catalogue is intentionally closed: every value the user can pick
 * has a normaliser in `graph-preferences.ts` so a stale localStorage
 * value from a previous version falls back to the default rather than
 * crashing the dagre call.
 */

import { EFLayoutDirection } from '@foblex/flow';
import { EDagreLayoutAlgorithm } from '@foblex/flow-dagre-layout';

/**
 * Closed catalogue of layout algorithms surfaced in Settings + the
 * bottom toolbar. Two engines feed this catalogue:
 *
 *   - `network-simplex` and `longest-path`, dagre rankers. The wire
 *     literal matches the Foblex `EDagreLayoutAlgorithm` enum value,
 *     so the string we store in localStorage flows straight into the
 *     dagre engine options.
 *   - `force`, our local d3-force simulation. Not a dagre algorithm,
 *     branched in `graph-layout.ts`'s `computeLayoutPositions` to
 *     `computeForceLayoutPositions`. `direction` has no meaning under
 *     this layout (no layers, no flow), so the toolbar disables the
 *     direction button when it is active and the connection sides
 *     fall back to Foblex's `CALCULATE` mode so arrow heads orient
 *     themselves.
 *   - `filesystem`, our local path-derived layout. Also not dagre:
 *     the column of a node comes from how deep its path sits, not
 *     from its edges, which is the only thing that arranges a corpus
 *     whose nodes barely reference each other. See
 *     `computeFilesystemLayoutPositions`.
 *
 * Dagre also exposes `tight-tree`; it is intentionally NOT in this
 * catalogue. On our typical skill-map graphs (small, mostly tree-shaped),
 * tight-tree converges to the same layout as network-simplex because
 * the greedy ranker happens to find the optimum, the result is two
 * options that look identical to the user. A stored `tight-tree`
 * value from a previous version fails the `isLayoutAlgorithm` guard
 * and falls back to the default on the next read.
 */
export type TLayoutAlgorithm = 'network-simplex' | 'longest-path' | 'force' | 'filesystem';

export const LAYOUT_ALGORITHMS: ReadonlyArray<TLayoutAlgorithm> = [
  'network-simplex',
  'longest-path',
  'force',
  'filesystem',
];

/**
 * Whether the algorithm honours the `direction` preference. False for
 * the two layouts that own their own axes: the d3-force simulation
 * (no layers, no flow) and the filesystem layout, whose whole point is
 * that depth runs left to right.
 */
export function algorithmUsesDirection(value: TLayoutAlgorithm): boolean {
  return value !== 'force' && value !== 'filesystem';
}

/**
 * Whether the algorithm honours the `spacing` preset. False for
 * d3-force: the `nodeGap` / `layerGap` numbers are dagre-only
 * (they feed `IDagreLayoutEngineOptions`); the force simulation
 * uses its own hardcoded collision radius + link distance. Until
 * we wire spacing into the force tuning, the UI dims the spacing
 * control when force is active. The filesystem layout reads the same
 * two numbers directly (row pitch + column pitch), so it keeps the
 * control live.
 */
export function algorithmUsesSpacing(value: TLayoutAlgorithm): boolean {
  return value !== 'force';
}

/**
 * Closed catalogue of layout directions. Matches Foblex's
 * `EFLayoutDirection` enum values verbatim so the same literal feeds
 * both the dagre engine and the `<f-connection>` connector-side
 * resolver.
 */
export type TLayoutDirection = 'TOP_BOTTOM' | 'BOTTOM_TOP' | 'LEFT_RIGHT' | 'RIGHT_LEFT';

export const LAYOUT_DIRECTIONS: ReadonlyArray<TLayoutDirection> = [
  'TOP_BOTTOM',
  'BOTTOM_TOP',
  'LEFT_RIGHT',
  'RIGHT_LEFT',
];

/**
 * Spacing preset. Two tiers keep the Settings UI simple; the
 * underlying gap numbers come from Foblex's own demo presets so the
 * canvas density matches what users see on the upstream playground.
 */
export type TLayoutSpacing = 'compact' | 'normal' | 'spacious';

export const LAYOUT_SPACINGS: ReadonlyArray<TLayoutSpacing> = [
  'compact',
  'normal',
  'spacious',
];

export interface ILayoutSpacingValues {
  readonly nodeGap: number;
  readonly layerGap: number;
}

/**
 * Compact / spacious match Foblex's published presets verbatim;
 * "normal" is the midpoint we add so the operator has a sensible
 * default that is neither cramped nor wasteful. The values are
 * intentionally a bit larger than the d3-force collision radius
 * (`NODE_WIDTH/2 + 12`) we used before, dagre's hierarchical packing
 * is tighter than force layout, so the gaps need to be wider to
 * preserve visual breathing room around our 260px-wide cards.
 */
export const LAYOUT_SPACING_VALUES: Readonly<Record<TLayoutSpacing, ILayoutSpacingValues>> = {
  compact: { nodeGap: 40, layerGap: 56 },
  normal: { nodeGap: 64, layerGap: 96 },
  spacious: { nodeGap: 96, layerGap: 144 },
};

/** Default algorithm, matches Foblex's own default for the dagre engine. */
export const DEFAULT_LAYOUT_ALGORITHM: TLayoutAlgorithm = 'network-simplex';

/**
 * Default direction is left-to-right. Skill graphs are wide and
 * shallow (a handful of stages, many leaf skills per stage), so a
 * horizontal flow reads the dependency chain along the natural
 * left-to-right reading axis and keeps the 260px-wide cards from
 * stacking into a tall, scroll-heavy column.
 */
export const DEFAULT_LAYOUT_DIRECTION: TLayoutDirection = 'LEFT_RIGHT';

export const DEFAULT_LAYOUT_SPACING: TLayoutSpacing = 'normal';

/** Map our wire literal to the Foblex enum value (string-equal). */
export function toFoblexAlgorithm(value: TLayoutAlgorithm): EDagreLayoutAlgorithm {
  return value as EDagreLayoutAlgorithm;
}

export function toFoblexDirection(value: TLayoutDirection): EFLayoutDirection {
  return value as EFLayoutDirection;
}

export function isLayoutAlgorithm(value: unknown): value is TLayoutAlgorithm {
  return typeof value === 'string' && (LAYOUT_ALGORITHMS as ReadonlyArray<string>).includes(value);
}

export function isLayoutDirection(value: unknown): value is TLayoutDirection {
  return typeof value === 'string' && (LAYOUT_DIRECTIONS as ReadonlyArray<string>).includes(value);
}

export function isLayoutSpacing(value: unknown): value is TLayoutSpacing {
  return typeof value === 'string' && (LAYOUT_SPACINGS as ReadonlyArray<string>).includes(value);
}
