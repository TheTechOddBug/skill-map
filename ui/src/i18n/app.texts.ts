/**
 * UI strings for the App shell (top-level chrome: brand, nav, theme toggle,
 * scan trigger, node count badge).
 *
 * Convention: each component / service owns a `*.texts.ts` file under
 * `src/i18n/`. Keys group by surface (nav, actions, a11y, …). Functions
 * are used for parameterised strings, Transloco-ready when we eventually
 * migrate to a real i18n library.
 */
const BRAND_NAME = 'skill-map';

export const APP_TEXTS = {
  brand: BRAND_NAME,
  alpha: 'ALPHA - do not use in production',
  nav: {
    graph: 'Graph',
    list: 'List',
    searchLabel: 'Search nodes (coming soon)',
    searchTooltip: 'Search (coming soon)',
    listLabel: 'List view (coming soon)',
    listTooltip: 'List (coming soon)',
  },
  actions: {},
  badge: {
    nodes: 'nodes',
    /** Two-line tooltip on the topbar scan trigger: action verb on top,
     *  the current scope stats (nodes / links) underneath. PrimeNG's
     *  `[pTooltip]` honours `\n` as a line break. */
    graphInfo: (nodes: number, links: number): string =>
      `Run scan\n${nodes.toLocaleString()} nodes · ${links.toLocaleString()} links`,
    graphInfoA11y: (nodes: number, links: number): string =>
      `Graph contains ${nodes} nodes and ${links} links`,
  },
  a11y: {
    viewSwitcher: 'View switcher',
  },
  viewportWarning: {
    title: "Looks like you're on a small screen",
    subtitle: 'skill-map is built for desktop',
    body: 'The graph and inspector need room to breathe. Pop this open on a screen at least 768px wide. See you there.',
  },
  /**
   * `document.title` composer used by the custom `TitleStrategy`. The
   * route-specific title comes first, the brand and version follow so
   * the browser tab reads at a glance and tester screenshots are
   * self-identifying. `version` is null until `/api/health` resolves.
   */
  documentTitle: (routeTitle: string, version: string | null): string =>
    version
      ? `${routeTitle} - ${BRAND_NAME} v${version}`
      : `${routeTitle} - ${BRAND_NAME}`,
} as const;
