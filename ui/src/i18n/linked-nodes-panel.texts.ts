/** UI strings for the LinkedNodesPanel (Step 14.5.b). */
export const LINKED_NODES_PANEL_TEXTS = {
  cardHeader: 'Linked nodes',
  refreshLabel: 'Refresh links',
  outgoingHeader: 'Outgoing',
  incomingHeader: 'Incoming',
  findingsHeader: 'Findings',
  emptyFindings: 'No findings on this node.',
  loading: 'Loading links…',
  error: 'Failed to load links.',
  emptyOutgoing: 'No outgoing links from this node.',
  emptyIncoming: 'No incoming links to this node.',
  /** Per-link metadata labels, small, used inline next to chips. */
  confidence: {
    high: 'high',
    medium: 'medium',
    low: 'low',
  },
  sourcesPrefix: 'detected by ',
  sourcesSeparator: ', ',
  /** Inline per-row issue indicators (tooltip shows the full message). */
  issueOnTargetTooltip: 'Target has an issue: ',
  issueOnSourceTooltip: 'Source has an issue: ',
  /** Per-row occurrences sub-list (shown only when `>= 1` site exists). */
  occurrencesHeader: 'Occurs at:',
  occurrencesItem: 'line {{line}} · `{{trigger}}` ({{extractor}})',
  occurrencesItemUnknownLine: '`{{trigger}}` ({{extractor}})',
  externalRefsHeader: 'External references',
  emptyExternalRefs: 'No external URLs in this node\'s body.',
  externalRefsItemLine: (line: number): string => `line ${line}`,
  externalRefsItemUnknownLine: 'unknown line',
} as const;
