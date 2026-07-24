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
    /**
     * Semantic-analysis affordance (user shape 2026-07-21): the
     * magic (sparkles) button beside the title, and the
     * expandable analysis block it reveals once the summarizer's
     * judgment lands.
     */
    summary: {
      tooltipIdle: 'Analyze and summarize this file',
      tooltipQueued: 'Analysis queued',
      tooltipRunning: 'Analyzing…',
      tooltipReady: 'Show / hide the semantic analysis',
      tooltipReadyStale: 'Show / hide the semantic analysis (outdated: the file changed since)',
      staleTag: 'stale',
      staleTooltip: 'The file changed since this analysis; re-run it to refresh.',
      refreshTooltip: 'Analyze again',
      deleteTooltip: 'Delete this analysis',
      confidenceTooltip: 'Confidence',
      qualityLabel: 'Quality notes',
    },
    /** The stability chip doubles as the Set stability affordance. */
    stabilityTooltip: 'Set stability',
    /**
     * The version chip doubles as the Bump affordance (user call
     * 2026-07-21): `placeholder` is the short label for a versionless
     * file while the plugin is enabled, with its own invitation tooltip.
     */
    bump: {
      placeholder: 'v?',
      placeholderTooltip: 'Stamp the version?',
      tooltip: 'Bump the version',
    },
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
    /**
     * The run-all affordance: a quiet parenthesised link right after each
     * group title (user pick 2026-07-23, replacing the "ALL finders" /
     * "ALL standalone" buttons). Queues every entry of ITS group only.
     */
    runAll: '(run all)',
    allFindersTooltip: 'Queue every finder on this node at once.',
    allStandaloneTooltip: 'Queue every standalone action on this node at once.',
    /**
     * Automatic toggle (Step 16): when on, one click on a finder button
     * runs the finder AND auto-chains its fixers (the finder submit
     * carries `autoFix: true`); when off, it just detects. Fixing an
     * already-open finding lives on the finding row (user call
     * 2026-07-20), so the button never morphs.
     */
    autoFix: {
      label: 'Auto-fixer',
      tooltip:
        'When on, one click runs the finder and auto-fixes its findings. When off, it just detects; fix each finding from its row.',
    },
    /**
     * Finder button action names (tooltip prefix): Detect runs the
     * finder, Detect + fix runs it with the fixer chain (automatic
     * toggle on). Standalone entries use their short extension name
     * instead. The old third `Fix` state moved into the finding rows.
     */
    buttons: {
      detect: 'Detect',
      detectAndFix: 'Detect + fix',
    },
    /**
     * Per-row AI-action provenance: the confidence percent alone (the
     * recording model was dropped from the row, user call 2026-07-20;
     * `sm findings` in the terminal still shows it).
     */
    confidence: (pct: number): string => `(${pct}%)`,
    /** Submit-failure banner, prefix + envelope message. */
    errorPrefix: 'Submit failed:',
    dismissErrorAriaLabel: 'Dismiss submit error',
    /**
     * Friendly `no-processing-agent` refusal (user wording 2026-07-22:
     * the server message names the CLI verb, the UI points at its own
     * path): the strip swaps the envelope message for `noAgentMessage`,
     * and the hint names the Settings install row plus the skill
     * invocation the agent runs.
     */
    /**
     * Non-blocking heads-up when the active lens supports a processing
     * skill that is not installed, so no agent is set up to drain launched
     * jobs. Points at Quick Start or Settings > Project for setup. Shown
     * only on a confirmed missing skill, never while unknown.
     */
    noProcessingAgentWarning:
      'No agent is set up to process jobs. Install the processing skill (Quick Start, or Settings > Project) so launched actions actually run.',
    /**
     * Secondary heads-up: the processing skill IS installed, but no agent
     * is connected to the MCP server yet. Clears once the agent runs the
     * skill and opens an MCP session. Shown only when `skillMissing` is a
     * confirmed `false` and `mcpConnected` a confirmed `false`.
     */
    mcpDisconnectedWarning:
      'Skill installed, but no agent is connected to the MCP yet. Start your agent (run the skill) and it will connect.',
    noAgentMessage: 'no agent is set up to process jobs.',
    agentInstallHint:
      'Install the processing skill from Settings, Project section ("Agent process skill"), then run it from your agent\'s terminal: "/sm-process-jobs".',
    /** Launcher button state tooltips (appended after the description). */
    stateQueued: 'queued',
    stateRunning: 'running',
    /** Column headers of the launcher columns (user pick 2026-07-22). */
    groupTitles: {
      finders: 'Finders',
      standalone: 'Standalone',
    },
    /**
     * Disabled-reason suffix on a finder whose findings are still open
     * (user call 2026-07-20: re-running it makes no sense; handle the
     * findings first and the button re-enables).
     */
    stateOpenFindings: 'findings open, handle them first',
    /**
     * Icon-only stop / restart companions beside an active launcher
     * (user decision 2026-07-17). Each string doubles as the tooltip
     * and the accessible label.
     */
    stopTooltip: 'Stop this job',
    /** Per-finding actions (the read-time suppression lens). */
    finding: {
      /** The AUTOMATIC fix: queue the finder's fixer(s) for this class. */
      fixTooltip: 'Auto-fix',
      fixAriaLabel: (id: number) => `Queue the fixer for finding ${id}`,
      dismissTooltip: 'Dismiss',
      dismissAriaLabel: (id: number) => `Dismiss finding ${id}`,
      resolveTooltip: 'Mark fixed (I handled this)',
      resolveAriaLabel: (id: number) => `Mark finding ${id} fixed`,
      restoreTooltip: 'Restore',
      restoreAriaLabel: (id: number) => `Restore finding ${id}`,
      deleteTooltip: 'Delete',
      deleteAriaLabel: (id: number) => `Delete finding ${id}`,
      /**
       * Inline per-row mark on a stale finding (the node body changed
       * since the judgment); stale rows ride the tray, never a hidden
       * bucket (user call 2026-07-20).
       */
      staleTag: 'stale',
      staleTagTooltip: 'The node body changed since this judgment; re-run the finder to re-check.',
      /**
       * Inline per-row mark on a `human-decision` finding: the fixer
       * deliberately left it to the author, so the row shows no fix
       * button (the submit gate refuses to re-inject decided work) and
       * this mark explains the two valid exits.
       */
      decisionTag: 'needs decision',
      decisionTagTooltip:
        'The fixer left this one to you: fix it yourself, then mark it fixed, or dismiss it.',
    },
    /** The hidden-buckets reveal chips under the tray (dismissed / fixed). */
    hidden: {
      dismissed: (count: number) => `${count} dismissed`,
      fixed: (count: number) => `${count} fixed`,
      chipTooltip: 'Show / hide this bucket',
    },
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
   * Per-issue AI fix button (deterministic findings card): rendered on
   * each issue row a probabilistic issue-fixer matches. The tooltip is
   * the action manifest's own description; only the aria label lives
   * here.
   */
  issueFixAriaLabel: (actionId: string) => `Queue ${actionId} to fix the matching findings`,
  /**
   * Metadata section (the `audit:` sidecar block). Field labels for the
   * panel body; the section no longer shows an inline summary next to
   * the title.
   */
  audit: {
    fields: {
      lastBumpedAt: 'Last bumped',
      lastBumpedBy: 'by',
      createdAt: 'Created',
      createdBy: 'by',
    },
  },
} as const;
