/**
 * UI strings for the Settings modal (gear icon → plugins toggle list).
 *
 * Convention: each component / service owns a `*.texts.ts` file under
 * `src/i18n/`. Strings are English-only — see AGENTS.md §"Externalized
 * texts, not internationalized".
 */
export const SETTINGS_TEXTS = {
  /** Topbar trigger. */
  triggerLabel: 'Settings',
  triggerTooltip: 'Settings',

  /** Modal chrome. */
  modalTitle: 'Settings',
  closeLabel: 'Close',

  /** Sidebar — section labels (kebab-case ids match `TSettingsSection`). */
  sections: {
    plugins: 'Plugins',
    general: 'General',
    changelog: 'Changelog',
    about: 'About',
  },

  /** Coming-soon placeholder body shown for not-yet-implemented sections. */
  comingSoonTitle: 'Coming soon',
  comingSoonBody: (section: string): string =>
    `${section} settings will land in a future release. The section is reserved here so you know where to look when it ships.`,

  /** About section. */
  aboutHeading: 'About',
  aboutIntro: 'Version information for the running CLI / server.',
  aboutCliLabel: 'skill-map CLI',
  aboutSpecLabel: 'Spec version',
  aboutSchemaLabel: 'Schema version',
  aboutScopeLabel: 'Scope',
  aboutFolderLabel: 'Project folder',
  aboutDbLabel: 'Project DB',
  /** Two-line value cell for db: status word on top, path below. */
  aboutDbValue: (state: string, path: string): string => `${state} · ${path}`,
  aboutLoading: 'Loading…',
  aboutUnknown: '—',
  aboutErrorPrefix: 'Could not read health endpoint:',
  aboutLinksHeading: 'Links',
  aboutWebsiteLabel: 'Website',
  aboutGithubLabel: 'GitHub',
  /** Canonical project URLs — surfaced in About and used as the
   *  authoritative externals (e.g. CLI's update-check banner already
   *  points to npm; these are the human-readable surfaces). */
  aboutWebsiteUrl: 'https://skill-map.dev/',
  aboutGithubUrl: 'https://github.com/crystian/skill-map',

  /** Section heading + intro. */
  pluginsHeading: 'Plugins',
  pluginsIntro: 'Enable or disable installed plugins.',
  pluginsSearchPlaceholder: 'Filter by name…',
  pluginsSearchA11y: 'Filter plugins by name',
  pluginsSearchEmpty: (query: string): string =>
    `No plugins match "${query}".`,

  /** Restart-required banner. */
  restartBannerTitle: 'Restart required',
  restartBannerBody:
    'Toggles are persisted instantly, but the loaded plugin runtime is cached at boot. Run `sm scan` or restart `sm serve` to apply.',

  /** Per-row labels. */
  sourceBuiltIn: 'Built-in',
  sourceProject: 'Project',
  sourceGlobal: 'Global',
  granularityExtension: 'Per-extension',
  enabledLabel: 'Enabled',
  disabledLabel: 'Disabled',
  expandLabel: 'Show extensions',
  collapseLabel: 'Hide extensions',

  /** Status overrides — non-toggleable rows surface their failure mode. */
  statusFailure: {
    'incompatible-spec': 'Incompatible spec version',
    'invalid-manifest': 'Invalid manifest',
    'load-error': 'Failed to load',
    'id-collision': 'Plugin id collision',
  } as Record<string, string>,

  /** Empty / loading / error states. */
  loading: 'Loading plugins…',
  empty: 'No plugins installed.',
  errorPrefix: 'Could not load plugins:',
  toggleErrorPrefix: 'Toggle failed:',

  a11y: {
    triggerLabel: 'Open settings',
    pluginToggle: (id: string, willEnable: boolean): string =>
      willEnable ? `Enable plugin ${id}` : `Disable plugin ${id}`,
    extensionToggle: (qualifiedId: string, willEnable: boolean): string =>
      willEnable ? `Enable ${qualifiedId}` : `Disable ${qualifiedId}`,
  },
} as const;
