/**
 * UI strings for the Settings modal (gear icon → plugins toggle list).
 *
 * Convention: each component / service owns a `*.texts.ts` file under
 * `src/i18n/`. Strings are English-only, see AGENTS.md §"Externalized
 * texts, not internationalized".
 */
export const SETTINGS_TEXTS = {
  /** Topbar trigger. */
  triggerLabel: 'Settings',
  triggerTooltip: 'Settings',

  /** Modal chrome. */
  modalTitle: 'Settings',
  closeLabel: 'Close',

  /** Sidebar, section labels (kebab-case ids match `TSettingsSection`). */
  sections: {
    plugins: 'Plugins',
    general: 'General',
    project: 'Project',
    changelog: 'Changelog',
    about: 'About',
  },

  /**
   * General section, per-machine toggles persisted at
   * `~/.skill-map/settings.json` (the single documented home-reads
   * exception, see `spec/cli-contract.md` §Scope is always
   * project-local). Today: a single `updateCheck.enabled` row; the
   * section is built around a declarative `GENERAL_TOGGLES` array so a
   * future toggle is one entry rather than a template / component
   * change.
   */
  general: {
    heading: 'General',
    intro: 'Per-machine preferences.',
    loadErrorPrefix: 'Could not load preferences:',
    saveErrorPrefix: 'Could not save preferences:',
    /** Toggle catalogue, keyed by config dot-path. */
    toggles: {
      'updateCheck.enabled': {
        label: 'Check for updates',
        description: 'Check npm for newer @skill-map/cli releases.',
      },
    },
    /**
     * Extra theme selector. Settings-only, overrides the topbar
     * dark/light toggle when set. Clicking the topbar toggle clears
     * it (advances the dark/light cycle one step in the same action),
     * so the user always has a one-click path back out of the
     * specialty themes.
     */
    extraTheme: {
      label: 'Theme',
      description: 'Pick a specialty theme.',
      options: {
        none: {
          label: 'None',
          description: 'Use the topbar dark/light toggle.',
        },
        matrix: {
          label: 'Matrix',
          description: 'Cyber-green retint on the dark palette.',
        },
      },
    },
    /**
     * Footnote rendered at the bottom of the General section, dimmed
     * so it reads as ambient orientation rather than primary copy.
     * Surfaces the storage locations referenced piecemeal above (home
     * settings file + browser localStorage) so the user has one place
     * to confirm where each preference lives.
     */
    storageHintLabel: 'Settings are stored in:',
    storageHintPath: '~/.skill-map/settings.json',
  },

  /**
   * Project section, settings persisted in
   * `<cwd>/.skill-map/settings.local.json`. The privacy-sensitive
   * `referencePaths` key widens the scan's disk-access surface; the
   * section enforces an explicit confirm dialog before any change
   * that exposes new paths.
   */
  project: {
    heading: 'Project',
    introPrefix: 'These settings apply only to this project and are saved in',
    introPath: '.skill-map/settings.local.json',
    introSuffix: '.',
    loadErrorPrefix: 'Could not load project settings:',
    saveErrorPrefix: 'Could not save project settings:',
    referencePathsLabel: 'Folders for link validation',
    referencePathsDescription:
      'If your notes link to files outside this project, list those ' +
      'folders here. Skill-map checks them only to confirm the links ' +
      'work, nothing from these folders shows up in the graph.',
    referencePathsPlaceholder: '~/Documents/research',
    commaForbidden:
      'Add one path at a time, without commas.',
    addPathLabel: 'Add path',
    removePathLabel: 'Remove',
    confirmDialogHeader: 'Allow access to folders outside this project?',
    confirmDialogIntro:
      'This change lets the scan read files in:',
    confirmDialogAccept: 'Allow access',
    confirmDialogReject: 'Cancel',
    /**
     * Ignore-patterns subsection, persists to `<cwd>/.skillmapignore`
     * (gitignore-syntax). Comments and blank lines in the file are
     * preserved on write; the UI only manages active patterns.
     */
    ignorePatternsLabel: 'Ignored patterns',
    ignorePatternsDescriptionPrefix:
      'Patterns that exclude files and folders from the scan, stored in',
    ignorePatternsDescriptionFile: '.skillmapignore',
    ignorePatternsDescriptionMiddle: 'at the project root. Same syntax as',
    ignorePatternsDescriptionGitignore: '.gitignore',
    ignorePatternsDescriptionSuffix: '(one pattern per line).',
    ignorePatternsPlaceholder: 'secrets.md',
    ignorePatternEmpty:
      'Pattern cannot be empty or whitespace-only.',
    ignorePatternHasControlChar:
      'Pattern must be a single line without control characters.',
    ignorePatternDuplicate:
      'This pattern is already in the list.',
    addIgnorePatternLabel: 'Add pattern',
    removeIgnorePatternLabel: 'Remove',

    /**
     * Active provider lens subsection. The lens selects which
     * provider's extractors and resolution rules apply to the whole
     * project. Switching is destructive of the scan_* DB zone
     * (per spec/architecture.md §Active Provider Lens) so the UI
     * gates the change with a confirm dialog and announces what
     * needs to be re-scanned.
     */
    activeProviderLabel: 'Active provider',
    activeProviderDescription:
      'Selects which provider sees this project. The graph reflects ' +
      'how the chosen provider interprets your files.',
    activeProviderSourceAutodetect:
      'Auto-detected from your files (no value saved yet).',
    activeProviderSourceNone:
      'No provider detected. Install or enable a provider to start.',
    activeProviderDetectedPrefix: 'Detected:',
    activeProviderEmptyOption: '(none)',
    activeProviderConfirmHeader: 'Switch the active provider?',
    activeProviderConfirmIntro:
      'Switching will clear the persisted scan (nodes, links, ' +
      'issues). Jobs and history are kept. You will need to run ' +
      '`sm scan` after the switch.',
    activeProviderConfirmAccept: 'Switch and clear scan',
    activeProviderConfirmReject: 'Cancel',
    activeProviderSwitchedPrefix: 'Lens switched. Cleared',
    activeProviderSwitchedSuffix: 'scan table(s). Run `sm scan` to repopulate.',
    activeProviderSwitchedNoDb:
      'Lens switched. Run `sm scan` to populate the graph under the new lens.',
  },

  /** Changelog section. */
  changelogHeading: 'Changelog',
  changelogIntro:
    "What's new in skill-map. Each entry covers a release of @skill-map/cli (the CLI + bundled UI) and lists the user-facing changes plus the workspace(s) each one affects.",
  changelogEmpty:
    'No release notes yet. Future releases will populate this list automatically from the changesets shipped in each PR.',
  changelogInternalRelease:
    'Internal release. Focus on stability, infra, and refactors. No user-facing changes this time.',
  changelogAffectedPackages: 'Affected packages',
  changelogFooterText: 'Want the full changelog?',
  changelogFooterLinkLabel: 'See it on GitHub →',
  changelogFooterUrl:
    'https://github.com/crystian/skill-map/blob/main/src/CHANGELOG.md',

  /** About section. */
  aboutHeading: 'About',
  aboutIntro: 'Version information for the running CLI / server.',
  aboutCliLabel: 'skill-map CLI',
  aboutSpecLabel: 'Spec version',
  aboutSchemaLabel: 'Schema version',
  aboutFolderLabel: 'Project folder',
  aboutDbLabel: 'Project DB',
  /** Two-line value cell for db. `present` → path only (the path
   *  alone is enough to confirm the DB is wired up); other states
   *  (e.g. `missing`) keep the `<state> · <path>` form so the user
   *  sees the indicator. */
  aboutDbValue: (state: string, path: string): string =>
    state === 'present' ? path : `${state} · ${path}`,
  aboutLoading: 'Loading…',
  /** Em dash here is the missing-value glyph, not narrative punctuation: kept verbatim. */
  aboutUnknown: '-',
  aboutErrorPrefix: 'Could not read health endpoint:',
  aboutLinksHeading: 'Links',
  aboutWebsiteLabel: 'Website',
  aboutGithubLabel: 'GitHub',
  /** Canonical project URLs, surfaced in About and used as the
   *  authoritative externals (e.g. CLI's update-check banner already
   *  points to npm; these are the human-readable surfaces). */
  aboutWebsiteUrl: 'https://skill-map.dev/',
  aboutGithubUrl: 'https://github.com/crystian/skill-map',

  /** GitHub-star callout, friendly nudge under the version list. */
  aboutStarHeading: 'Enjoying skill-map?',
  aboutStarBody:
    "If it's useful to you, drop us a star on GitHub, it helps a lot " +
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

  /** Kind filter, segmented control above the list. `All` is the
   *  default and shows every row; picking a kind narrows to extensions
   *  of that kind and hides bundle-granularity rows (which do not
   *  surface a per-row kind in the UI). */
  pluginsKindFilterAll: 'All',
  pluginsKindFilterA11y: 'Filter plugins by kind',
  pluginsKindFilterOptionA11y: (kind: string, willActivate: boolean): string =>
    willActivate ? `Show only ${kind} extensions` : `Show all kinds`,

  /**
   * Buffered-edit feedback, replaces the historic "Restart required"
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
   * runtime, re-engaging needs an `sm serve` restart. Lives per-row
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
    'Some plugins were disabled when the server started. Consider restarting `sm serve` so they take effect.',

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
  enabledLabel: 'Enabled',
  disabledLabel: 'Disabled',
  lockedLabel: 'Locked',
  lockedTooltip: 'Locked by the host (cannot be toggled).',
  expandLabel: 'Show extensions',
  collapseLabel: 'Hide extensions',

  /** Status overrides, non-toggleable rows surface their failure mode. */
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
    pluginRow: (id: string): string => `Plugin ${id} row`,
    extensionRow: (qualifiedId: string): string => `Extension ${qualifiedId} row`,
  },
} as const;
