/** UI strings for the InspectorView. */
export const INSPECTOR_VIEW_TEXTS = {
  emptyNoSelection: {
    title: 'No node selected',
    desc: 'Select a node to inspect it.',
  },
  emptyNotFound: {
    title: 'Node not found',
    descSuffix: ' This node is no longer in the scan.',
  },
  /**
   * Header badge shown when a node's frontmatter failed to parse (the
   * `frontmatter-parse-error` analyzer fired). The title falls back to
   * the file name and this badge explains why name / description /
   * metadata are missing.
   */
  header: {
    invalidFrontmatter: 'invalid frontmatter',
    invalidFrontmatterTooltip:
      'The YAML frontmatter could not be parsed, so name, description and other metadata are unavailable. Check the Findings section for the parser error.',
  },
  /**
   * Section headers the inspector body renders directly. Vendor-frontmatter
   * sub-sections (Behavior / Capabilities / Initial prompt) own their own
   * catalog so each renderer stays self-contained.
   */
  sections: {
    actions: 'Actions',
    activity: 'Activity',
    annotations: 'Annotations',
    connections: 'Connections',
    findings: 'Findings',
    aiActions: 'AI actions',
    metadata: 'Metadata',
    plugins: 'Plugin contributions',
    body: 'Body',
  },
  /**
   * AI actions section (Step 16 piece 1, the findings workbench): the
   * per-node probabilistic findings tray plus the launcher buttons for
   * finder / fixer / standalone extensions. Distinct from the
   * deterministic "Findings" section above (analyzer issues).
   */
  aiActions: {
    /** Launcher group headings, classified manifest-mechanically. */
    groups: {
      finders: 'Finders',
      standalone: 'Standalone',
    },
    /**
     * Automatic toggle (Step 16): when on, one click on a finder button
     * runs the finder AND auto-chains its fixers (the finder submit
     * carries `autoFix: true`); when off, the button morphs Detect ⇄ Fix.
     */
    autoFix: {
      label: 'Auto-fixer',
      tooltip:
        'When on, one click runs the finder and auto-fixes its findings. When off, the button switches between Detect and Fix.',
    },
    /**
     * Two-state finder button labels (a finder that has a fixer): Detect
     * runs the finder, Fix runs its fixer(s), Detect + fix runs both in
     * one click (automatic toggle on). Standalone entries use their short
     * extension name instead.
     */
    buttons: {
      detect: 'Detect',
      fix: 'Fix',
      detectAndFix: 'Detect + fix',
    },
    /**
     * Per-row AI-action provenance: confidence percent plus the
     * recording model when the agent declared one.
     */
    confidenceModel: (pct: number, model: string | null): string =>
      model === null ? `(${pct}%)` : `(${pct}% · ${model})`,
    /** Submit-failure banner, prefix + envelope message. */
    errorPrefix: 'Submit failed:',
    dismissErrorAriaLabel: 'Dismiss submit error',
    /**
     * Extra hint under a `no-processing-agent` refusal: the queue works
     * pull-only, so the operator needs the processing skill installed.
     */
    agentInstallHint:
      'Run "sm agent install" to install the processing skill, then ask your agent to process the queue.',
    /** Launcher button state tooltips (appended after the description). */
    stateQueued: 'queued',
    stateRunning: 'running',
    /**
     * Icon-only stop / restart companions beside an active launcher
     * (user decision 2026-07-17). Each string doubles as the tooltip
     * and the accessible label.
     */
    stopTooltip: 'Stop this job',
  },
  /**
   * Activity section (spec/provider-activity.md §Execution stats /
   * §Conversation capture): per-node execution counters, the recent
   * ring, and the spawn records touching the node. All values are
   * ephemeral (reset when `sm serve` restarts).
   */
  activity: {
    loading: 'Loading activity…',
    empty: 'No executions recorded since the server started.',
    /** Header chip while capture is on AND this node has captured conversations. */
    captureOnChip: 'capture on',
    captureOnChipTooltip:
      'Conversation capture is enabled: spawn prompts and responses are kept in memory while sm runs.',
    recentHeading: 'Recent executions',
    /**
     * Type-icon label for the directional recent rows
     * (spec/provider-activity.md §WS event: node.activity, kind): an MCP
     * tool call vs a file read. Doubles as the icon tooltip and its
     * screen-reader label.
     */
    recentKind: {
      mcp: 'MCP tool call',
      read: 'File read',
    },
    /**
     * Three-state provenance filter over the merged timeline (user
     * decision 2026-07-17): runtime executions vs skill-map's own
     * AI-run history, or both interleaved. Persisted at inspector
     * level, see `inspector-activity-filter.controller.ts`.
     */
    filter: {
      all: 'All',
      runtime: 'Runtime',
      ai: 'AI runs',
      /** Muted line when the active filter matches no timeline entry. */
      empty: 'Nothing recorded for this filter.',
    },
    /**
     * Icon label for AI-run rows (skill-map's own `state_executions`
     * history). Doubles as tooltip and screen-reader label, like
     * `recentKind`.
     */
    runKind: 'AI run',
    /** Compact run duration, mirrors the conversation dialog's format. */
    runDuration: (ms: number): string => `${(ms / 1000).toFixed(1).replace(/\.0$/, '')}s`,
    spawnsHeading: 'Agent spawns',
    /** Thread-row turn counter: every Task call of the pair is one exchange. */
    exchangeCount: (n: number): string => (n === 1 ? '1 exchange' : `${n} exchanges`),
    viewConversation: 'View conversation',
    viewConversationA11y: (child: string): string => `View the conversation with ${child}`,
    /** Parent label for spawns whose spawner is the main session. */
    spawnParentSession: 'session',
    /** Row shape: `<parent> -> <child>`. */
    spawnPair: (parent: string, child: string): string => `${parent} -> ${child}`,
    captureOffHint: 'Conversation capture is off. Enable it in Settings > Project.',
  },
  body: {
    // The body section is hidden entirely when there is nothing to
    // render (empty / unavailable / error states), so only the
    // transient loading line survives in the catalog.
    loading: 'Loading body…',
    /**
     * Raw / Rendered toggle shown at the top of the expanded Body section.
     * The label names the view the button switches TO; the tooltip spells
     * it out.
     */
    view: {
      showRaw: 'Raw',
      showRendered: 'Rendered',
      showRawTooltip: 'Show the raw source',
      showRenderedTooltip: 'Show the rendered Markdown',
    },
  },
  /** Findings list, fix hint label rendered before the per-issue summary. */
  findingHintLabel: 'Hint:',
  /**
   * Metadata section (the `audit:` sidecar block). Field labels for the
   * panel body; the section no longer shows an inline summary next to
   * the title.
   */
  audit: {
    /** Empty-state line shown by the Metadata panel when no audit data. */
    headerEmpty: 'never bumped',
    fields: {
      lastBumpedAt: 'Last bumped',
      lastBumpedBy: 'by',
      createdAt: 'Created',
      createdBy: 'by',
    },
  },
} as const;
