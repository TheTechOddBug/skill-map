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
  /**
   * Topbar chip rendered next to the version when `/api/health.dev` is
   * `true` (BFF launched from a local checkout, see
   * `src/kernel/util/dev-mode.ts`). Quick visual cue so the operator
   * cannot confuse the dev build with an npm-installed one.
   */
  devChip: 'dev',
  devChipTooltip: 'BFF launched from a local checkout (not the npm install).',
  devChipA11y: 'Development build: BFF is running from a local checkout.',
  nav: {
    map: 'Map',
    files: 'Files',
    searchLabel: 'Search nodes by name or tag',
    searchTooltip: 'Search',
    searchPlaceholder: 'Search by name or tag...',
    searchAriaLabel: 'Search nodes by name or tag',
    searchClearLabel: 'Clear search',
  },
  actions: {},
  badge: {
    nodes: 'nodes',
    /**
     * Multi-line tooltip on the topbar scan trigger. First line is the
     * action verb (the button click runs a scan), then the scope stats:
     * nodes + raw link count (matches what `sm scan` prints in the CLI
     * and what the kernel persists). When the drawn-edge count differs
     * from the raw count, a third line breaks down where the gap goes
     * (broken refs / self-loops / duplicates) so the operator can see
     * why the canvas shows fewer arrows than the CLI announced. PrimeNG's
     * `[pTooltip]` honours `\n` as a line break.
     */
    mapInfo: (
      nodes: number,
      analysis: {
        raw: number;
        drawn: number;
        brokenSource: number;
        brokenTarget: number;
        selfLoops: number;
        duplicates: number;
      },
    ): string => {
      const base = `Run scan\n${nodes.toLocaleString()} nodes · ${analysis.raw.toLocaleString()} links`;
      if (analysis.raw === analysis.drawn) return base;
      const parts: string[] = [];
      const broken = analysis.brokenSource + analysis.brokenTarget;
      if (broken > 0) parts.push(`${broken} broken`);
      if (analysis.selfLoops > 0) parts.push(`${analysis.selfLoops} self-loop${analysis.selfLoops === 1 ? '' : 's'}`);
      if (analysis.duplicates > 0) parts.push(`${analysis.duplicates} duplicate${analysis.duplicates === 1 ? '' : 's'}`);
      return `${base}\n${analysis.drawn.toLocaleString()} drawn (${parts.join(', ')})`;
    },
    mapInfoA11y: (
      nodes: number,
      analysis: {
        raw: number;
        drawn: number;
      },
    ): string =>
      `Map contains ${nodes} nodes and ${analysis.raw} links; ${analysis.drawn} drawn on the canvas`,
  },
  a11y: {
    viewSwitcher: 'View switcher',
  },
  viewportWarning: {
    title: "Looks like you're on a small screen",
    subtitle: 'skill-map is built for desktop',
    body: 'The map and inspector need room to breathe. Pop this open on a screen at least 768px wide. See you there.',
  },
  /**
   * `document.title` composer used by the custom `TitleStrategy`. Reads
   * as `{projectName} - {brand} v{version}` so the user can spot the
   * working project at a glance when several tabs are open. The
   * project name is the last segment of `/api/health.cwd`; the version
   * is the running CLI. Both are nullable until the health probe
   * resolves (or in demo mode), the composer drops the missing pieces.
   */
  documentTitle: (projectName: string | null, version: string | null): string => {
    const base = projectName ? `${projectName} - ${BRAND_NAME}` : BRAND_NAME;
    return version ? `${base} v${version}` : base;
  },
} as const;
