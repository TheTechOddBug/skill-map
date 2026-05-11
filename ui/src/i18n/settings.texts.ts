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
    project: 'Project',
    changelog: 'Changelog',
    about: 'About',
  },

  /** Coming-soon placeholder body shown for not-yet-implemented sections. */
  comingSoonTitle: 'Coming soon',
  comingSoonBody: (section: string): string =>
    `${section} settings will land in a future release. The section is reserved here so you know where to look when it ships.`,

  /**
   * General section — user-scope toggles persisted in
   * `~/.skill-map/settings.json`. Today: a single `updateCheck.enabled`
   * row; the section is built around a declarative `GENERAL_TOGGLES`
   * array so a future toggle is one entry rather than a template /
   * component change.
   */
  general: {
    heading: 'General',
    intro:
      'User-scope preferences. These settings live in your home directory ' +
      '(`~/.skill-map/settings.json`) and follow you across projects.',
    loadErrorPrefix: 'Could not load preferences:',
    saveErrorPrefix: 'Could not save preferences:',
    /** Toggle catalogue — keyed by config dot-path. */
    toggles: {
      'updateCheck.enabled': {
        label: 'Check for updates',
        description: 'Check npm for newer @skill-map/cli releases.',
      },
    },
  },

  /**
   * Project section — settings persisted in
   * `<cwd>/.skill-map/settings.json`. The three privacy-sensitive
   * scan keys (`includeHome`, `extraRoots`, `referencePaths`) all
   * widen the scan's disk-access surface; the section enforces an
   * explicit confirm dialog before any change that exposes new
   * paths.
   */
  project: {
    heading: 'Project',
    intro:
      'These settings apply only to this project and are saved in ' +
      'its `.skill-map/settings.json` file.',
    loadErrorPrefix: 'Could not load project settings:',
    saveErrorPrefix: 'Could not save project settings:',
    includeHomeLabel: 'Include your HOME folders',
    includeHomeDescription:
      'Also scan typical AI-assistant folders in your HOME ' +
      '(like ~/.claude, ~/.gemini, ~/.agents) alongside this ' +
      'project. Off by default — turning this on lets the scan ' +
      'read those folders.',
    extraRootsLabel: 'Extra folders to scan',
    extraRootsDescription:
      'Additional folders included in the scan. Their files show ' +
      'up in the graph next to this project. Use ~/ for paths ' +
      'inside your home folder.',
    extraRootsPlaceholder: '~/notes, /path/to/another/folder',
    referencePathsLabel: 'Folders for link validation',
    referencePathsDescription:
      'Folders checked only to validate links. Files here are not ' +
      'indexed and do not appear in the graph — they just stop ' +
      '"broken link" warnings when a link points to a real file ' +
      'outside this project.',
    referencePathsPlaceholder: '~/Documents/research, ~/.claude',
    addPathLabel: 'Add path',
    removePathLabel: 'Remove',
    confirmDialogHeader: 'Allow access to folders outside this project?',
    confirmDialogIntro:
      'This change lets the scan read files in:',
    confirmDialogAccept: 'Allow access',
    confirmDialogReject: 'Cancel',
  },

  /** Changelog section. */
  changelogHeading: 'Changelog',
  changelogIntro:
    "What's new in skill-map. Each entry covers a release of @skill-map/cli (the CLI + bundled UI) and lists the user-facing changes plus the workspace(s) each one affects.",
  changelogEmpty:
    'No release notes yet. Future releases will populate this list automatically from the changesets shipped in each PR.',
  changelogInternalRelease:
    'Internal release — focus on stability, infra, and refactors. No user-facing changes this time.',
  changelogAffectedPackages: 'Affected packages',

  /** About section. */
  aboutHeading: 'About',
  aboutIntro: 'Version information for the running CLI / server.',
  aboutCliLabel: 'skill-map CLI',
  aboutSpecLabel: 'Spec version',
  aboutSchemaLabel: 'Schema version',
  aboutScopeLabel: 'Scope',
  aboutFolderLabel: 'Project folder',
  aboutDbLabel: 'Project DB',
  aboutHomeLabel: 'Skill-map home',
  /** Two-line value cell for db. `present` → path only (the path
   *  alone is enough to confirm the DB is wired up); other states
   *  (e.g. `missing`) keep the `<state> · <path>` form so the user
   *  sees the indicator. */
  aboutDbValue: (state: string, path: string): string =>
    state === 'present' ? path : `${state} · ${path}`,
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

  /** GitHub-star callout — friendly nudge under the version list. */
  aboutStarHeading: 'Enjoying skill-map?',
  aboutStarBody:
    "If it's useful to you, drop us a star on GitHub — it helps a lot " +
    'and keeps the project alive.',
  aboutStarCta: 'Star on GitHub',
  aboutStarA11y: 'Open the skill-map repository on GitHub to give it a star',

  /** Section heading + intro. */
  pluginsHeading: 'Plugins',
  pluginsIntro: 'Enable or disable installed plugins.',
  pluginsSearchPlaceholder: 'Filter by name…',
  pluginsSearchA11y: 'Filter plugins by name',
  pluginsSearchEmpty: (query: string): string =>
    `No plugins match "${query}".`,

  /** Kind filter — segmented control above the list. `All` is the
   *  default and shows every row; picking a kind narrows to extensions
   *  of that kind and hides bundle-granularity rows (which do not
   *  surface a per-row kind in the UI). */
  pluginsKindFilterAll: 'All',
  pluginsKindFilterA11y: 'Filter plugins by kind',
  pluginsKindFilterOptionA11y: (kind: string, willActivate: boolean): string =>
    willActivate ? `Show only ${kind} extensions` : `Show all kinds`,

  /**
   * Buffered-edit feedback — replaces the historic "Restart required"
   * banner. Plugin toggles are now staged in the modal and applied as
   * a bulk PATCH on confirm; while edits are pending, the message
   * below sits above the list so the user knows nothing has been
   * persisted yet.
   */
  unsavedChangesMessage: (count: number): string =>
    count === 1
      ? '1 unsaved change. Click "Apply" to persist it.'
      : `${count} unsaved changes. Click "Apply" to persist them.`,

  /**
   * Per-row hint shown when the user toggles a plugin BACK on whose
   * boot snapshot reports `startsAsDisabled: true`. The override is
   * persisted, but the plugin's handlers were never loaded into the
   * runtime — re-engaging needs an `sm serve` restart. Lives per-row
   * (next to the toggle) instead of as a global banner so the warning
   * is local to the affected plugin.
   */
  startsAsDisabledRowHint:
    'This plugin started disabled and is not loaded in memory. ' +
    'Restart `sm serve` for the change to take effect.',

  /**
   * Footer-level companion to `startsAsDisabledRowHint`, rendered in
   * italics next to the Discard / Apply buttons when at least one
   * dirty row is re-enabling a `startsAsDisabled` plugin. Duplicates
   * the warning so a user looking at the footer (the natural last
   * stop before Apply) sees the restart recommendation without
   * scanning the list for the per-row hint.
   */
  startsAsDisabledFooterHint:
    'Some plugins were disabled when the server started — consider restarting `sm serve` so they take effect.',

  /** Footer actions for the buffered modal. */
  discardChanges: 'Discard',
  applyAndClose: 'Apply',
  discardA11y: 'Discard pending plugin changes',
  applyA11y: 'Apply pending plugin changes and refresh the graph',

  /**
   * Confirm dialog presented when the user tries to close the modal
   * with pending changes. Mirrors the project-settings confirm-dialog
   * shape: title + intro + three actions. The dialog is opened by the
   * shell that wraps `<sm-settings-plugins>`, not by this component
   * itself.
   */
  confirmCloseTitle: 'Apply pending changes?',
  confirmCloseBody: (count: number): string =>
    count === 1
      ? 'You have 1 unsaved change.'
      : `You have ${count} unsaved changes.`,
  keepEditing: 'Keep editing',

  /** Per-row labels. */
  sourceBuiltIn: 'Built-in',
  sourceProject: 'Project',
  sourceGlobal: 'Global',
  enabledLabel: 'Enabled',
  disabledLabel: 'Disabled',
  lockedLabel: 'Locked',
  lockedTooltip: 'Locked by the host — cannot be toggled.',
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
