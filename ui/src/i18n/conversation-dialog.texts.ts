/**
 * UI strings for `<sm-conversation-dialog>` (the inter-agent
 * conversation thread viewer, opened from the inspector's spawn-thread
 * list and from a spawn-edge click on the graph).
 */
export const CONVERSATION_DIALOG_TEXTS = {
  header: (child: string): string => `Conversation with ${child}`,
  ariaLabel: 'Inter-agent conversation',
  /** Fallback child label when the runtime named nothing resolvable. */
  unknownChild: 'agent',
  /** Parent naming: a scanned agent node, or the anonymous session. */
  spawnedByNode: (parent: string): string => `Spawned by ${parent}`,
  spawnedBySession: 'Spawned by the main session',
  ownerPrefix: 'Owner:',
  childOwnerPrefix: 'Child owner:',
  /** Header turn counter: every Task call of the pair is one exchange. */
  exchangeCount: (n: number): string => (n === 1 ? '1 exchange' : `${n} exchanges`),
  /** Per-turn heading inside the thread (1-based). */
  turnLabel: (n: number): string => `Turn ${n}`,
  /** a11y labels for the chat bubbles (parent asks, child answers). */
  promptLabel: 'Prompt',
  responseLabel: 'Response',
  /**
   * Shown under a turn whose response is still missing: the child is
   * running, or its terminal stop never arrived (crashed runtime).
   * The final report attaches from the child's stop event when it
   * lands (spec §Conversation capture, response sources).
   */
  asyncGapNote: 'No reply yet. The response arrives when this agent finishes its run.',
  /** Shown when the thread carries metadata only (gate off). */
  captureOffNote:
    'Conversation capture is off, so only metadata is available. Enable it in Settings > Project.',
} as const;
