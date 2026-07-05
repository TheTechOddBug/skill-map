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
  /** a11y labels for the chat bubbles (parent asks, child answers). */
  promptLabel: 'Prompt',
  responseLabel: 'Response',
  /**
   * Per-turn execution summary segments, appended to the turn head when
   * the record carries an `execution` block (sync completions only).
   * The component joins the present segments with " · ".
   */
  executionDuration: (ms: number): string => `${(ms / 1000).toFixed(1).replace(/\.0$/, '')}s`,
  executionTools: (n: number): string => (n === 1 ? '1 tool' : `${n} tools`),
  /** Takes the already-compacted count (`compactNumber`), e.g. `4.1k`. */
  executionTokens: (compact: string): string => `${compact} tokens`,
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
  /**
   * Shown when the thread has NO records while the capture gate is on
   * (historical edge click after a server restart, or the pair has not
   * spawned since capture was enabled): the blank is expected and new
   * exchanges will land here.
   */
  emptyThreadNote:
    'No exchanges retained yet. New conversations of this pair will show up here while the server runs.',
} as const;
