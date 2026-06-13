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
      telemetry: {
        label: 'Send anonymous error & usage reports',
        description: 'Report crashes and which features you use. No file contents or paths.',
        hint: 'Restart sm for this to take effect.',
      },
    },
    /**
     * Extra theme selector. Settings-only, overrides the topbar
     * dark/light toggle when set. Clicking the topbar toggle clears
     * it (advances the dark/light cycle one step in the same action),
     * so the user always has a one-click path back out of the
     * specialty themes.
     *
     * The select options are sourced from the registry at
     * `ui/src/themes/registry.ts` (one entry per specialty theme,
     * carries its own `label` + `description`); only the `none`
     * sentinel lives in this catalog because it does not correspond
     * to a registered theme.
     */
    extraTheme: {
      label: 'Theme',
      description: 'Pick a specialty theme.',
      options: {
        none: {
          label: 'None',
          description: 'Use the topbar dark/light toggle.',
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
      'work, nothing from these folders shows up in the map.',
    referencePathsPlaceholder: '~/Documents/research',
    referencePathsInputAriaLabel: 'New folder path',
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
    ignorePatternsInputAriaLabel: 'New ignore pattern',
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
      'Selects which provider sees this project. The map reflects ' +
      'how the chosen provider interprets your files.',
    activeProviderSourceAutodetect:
      'Auto-detected from your files (no value saved yet).',
    activeProviderSourceNone:
      'No provider detected. Install or enable a provider to start.',
    activeProviderDetectedPrefix: 'Detected:',
    activeProviderEmptyOption: '(none)',
    activeProviderDisabledSuffix: '(disabled)',
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
      'Lens switched. Run `sm scan` to populate the map under the new lens.',
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
  aboutWebsiteUrl: 'https://skill-map.ai/',
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
   *  of that kind and hides plugin-granularity rows (which do not
   *  surface a per-row kind in the UI). */
  pluginsKindFilterAll: 'All',
  pluginsKindFilterOptionA11y: (kind: string, willActivate: boolean): string =>
    willActivate ? `Show only ${kind} extensions` : `Show all kinds`,

  /** Source filter, segmented control next to the kind filter. `All` is
   *  the default; `Built-in` shows the plugins that ship with the CLI,
   *  `Project` shows the drop-in plugins under `.skill-map/plugins/`. */
  pluginsSourceFilterOptionA11y: (source: string, willActivate: boolean): string =>
    willActivate ? `Show only ${source} plugins` : `Show all sources`,

  /** Unified filter bar: a single shared "All" reset, the source chips
   *  (built-in / project), and the kind chips, all on one line. The
   *  source and kind axes compose; "All" clears both. */
  pluginsFilterA11y: 'Filter plugins by source and kind',
  pluginsFilterAllA11y: 'Show every plugin (clear the source and kind filters)',
  /** Shown when the Project source filter is active and the project has
   *  no drop-in plugins yet. Points the user at the scaffolder. */
  pluginsProjectEmpty:
    'No project plugins yet. Drop one under .skill-map/plugins/ or create it with sm plugins create <id>.',

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
  applyA11y: 'Apply pending plugin changes and refresh the map',

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

  /**
   * Per-extension lifecycle badge (`IPluginExtensionApi.stability`).
   * Only the non-default values render a badge; a missing field or an
   * explicit `stable` shows nothing, per the spec's "missing == stable"
   * contract (`extensions/base.schema.json#/properties/stability`).
   */
  stability: {
    experimental: 'experimental',
    beta: 'beta',
    deprecated: 'deprecated',
    tooltip: 'Lifecycle stage declared by the extension manifest.',
  },

  /**
   * Runtime contribution errors, per-plugin diagnostics recorded by the
   * last scan when an extension emitted a view contribution the kernel
   * rejected (undeclared slot ref, or a payload that failed the slot's
   * schema). Distinct from a load failure: the plugin loaded fine, but
   * some of its emissions did not land. Surfaced as a warning-toned
   * count badge on the plugin row plus a collapsible list.
   */
  runtimeErrors: {
    /** Count badge on the plugin row (warning tone). */
    badge: (count: number): string =>
      count === 1 ? '1 runtime error' : `${count} runtime errors`,
    /** Badge tooltip / aria, explains what the count means. */
    badgeTooltip:
      'This plugin loaded fine, but some of its contributions were ' +
      'rejected during the last scan. Expand for details.',
    /** Collapsible-section toggle labels (collapsed by default). */
    expandLabel: 'Show runtime errors',
    collapseLabel: 'Hide runtime errors',
    /** Secondary metadata prefixes inside each error row. */
    extensionPrefix: 'Extension:',
    slotPrefix: 'Slot:',
    contributionPrefix: 'Contribution:',
    a11y: {
      /** Aria for the collapsible toggle button. */
      toggle: (pluginId: string, count: number): string =>
        `Runtime errors for plugin ${pluginId} (${count})`,
    },
  },

  /**
   * Per-extension operator settings form. An extension that declares
   * `settings` in its manifest gets an inline collapsible "Options"
   * section below its subrow, rendering one control per declared
   * setting. Values are BUFFERED alongside the enable/disable toggles
   * and shipped in the same bulk Apply (no separate save).
   */
  extensionSettings: {
    /** Collapsible-section toggle labels (collapsed by default). */
    expandLabel: 'Show options',
    collapseLabel: 'Hide options',
    /** Section heading inside the expanded panel. */
    heading: 'Options',
    /** Aria for the collapsible toggle button. */
    toggleA11y: (qualifiedId: string): string => `Options for ${qualifiedId}`,
    /** Aria wrapper for the settings form region. */
    formA11y: (qualifiedId: string): string => `Settings for ${qualifiedId}`,
    /** Secret "set" / "empty" indicator hints (also surfaced inline by
     *  the control; duplicated here for the subrow context). */
    secretSetHint: 'A value is stored. Leave blank to keep it.',
    secretEmptyHint: 'No value stored yet.',
  },

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
