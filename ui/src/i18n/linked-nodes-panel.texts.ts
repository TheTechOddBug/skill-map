/** UI strings for the LinkedNodesPanel (Step 14.5.b). */
export const LINKED_NODES_PANEL_TEXTS = {
  outgoingHeader: 'Outgoing',
  incomingHeader: 'Incoming',
  loading: 'Loading links…',
  error: 'Failed to load links.',
  /** Per-link metadata labels, small, used inline next to chips. */
  confidence: {
    high: 'high',
    medium: 'medium',
    low: 'low',
  },
  /** Tooltip on the confidence chip, e.g. "confidence: high". */
  confidenceTooltip: (tier: string): string => `confidence: ${tier}`,
  /** Inline per-row issue indicators (tooltip shows the full message). */
  issueOnTargetTooltip: 'Target has an issue: ',
  issueOnSourceTooltip: 'Source has an issue: ',
  externalRefsHeader: 'External',
} as const;
