/** UI strings for the capture-level selector (`sm-capture-level-selector`). */
export const CAPTURE_LEVEL_TEXTS = {
  /** Row / control label (Sessions rail + the Settings mirror). */
  label: 'Capture level',
  /** Tooltip while a recording locks the selector. */
  lockedWhileRecording: 'Stop the recording to change the capture level',
  description:
    'How much runtime activity skill-map keeps, live: below the level, ' +
    'events are not shown on the map nor recorded.',
  /** Per-level option labels (the ladder is cumulative, left to right). */
  levels: {
    executions: 'Executions',
    reads: '+Reads',
    writes: '+Writes',
    mcp: '+MCP',
    shell: '+Shell',
  },
  /** Per-level tooltips. */
  tooltips: {
    executions: 'Skills, agents and commands running, spawns, session bounds',
    reads: 'Also file reads',
    writes: 'Also file writes and edits',
    mcp: 'Also MCP tool calls (the full surface, default)',
    shell: 'Reserved: shell-command capture is not available yet',
  },
} as const;
