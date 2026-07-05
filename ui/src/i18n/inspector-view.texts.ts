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
    metadata: 'Metadata',
    plugins: 'Plugin contributions',
    body: 'Body',
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
    /** Header chip while the conversation-capture gate is on. */
    captureOnChip: 'capture on',
    captureOnChipTooltip:
      'Conversation capture is enabled: spawn prompts and responses are kept in memory while sm serve runs.',
    stats: {
      count: 'Executions',
      lastStart: 'Last start',
      contexts: 'Contexts',
    },
    recentHeading: 'Recent executions',
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
