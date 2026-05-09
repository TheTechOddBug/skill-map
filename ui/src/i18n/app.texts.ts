/**
 * UI strings for the App shell (top-level chrome: brand, nav, theme toggle,
 * scan trigger, node count badge).
 *
 * Convention: each component / service owns a `*.texts.ts` file under
 * `src/i18n/`. Keys group by surface (nav, actions, a11y, …). Functions
 * are used for parameterised strings — Transloco-ready when we eventually
 * migrate to a real i18n library.
 */
export const APP_TEXTS = {
  brand: 'skill-map',
  beta: 'Beta',
  nav: {
    graph: 'Graph',
    list: 'List',
    searchLabel: 'Search nodes (coming soon)',
    searchTooltip: 'Search — coming soon',
  },
  actions: {},
  badge: {
    nodes: 'nodes',
    /** Single line shown by the topbar info-icon tooltip. */
    graphInfo: (nodes: number, links: number): string =>
      `${nodes.toLocaleString()} nodes · ${links.toLocaleString()} links`,
    graphInfoA11y: (nodes: number, links: number): string =>
      `Graph contains ${nodes} nodes and ${links} links`,
  },
  a11y: {
    viewSwitcher: 'View switcher',
  },
  viewportWarning: {
    title: "Looks like you're on a small screen",
    subtitle: 'skill-map is built for desktop',
    body: 'The graph and inspector need room to breathe. Pop this open on a screen at least 768px wide — see you there.',
  },
} as const;
