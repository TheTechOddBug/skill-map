/** UI strings for the capture-level selector (`sm-capture-level-selector`). */
export const CAPTURE_LEVEL_TEXTS = {
  /** Row / control label (Sessions rail + the Settings mirror). */
  label: 'Capture level',
  /** Tooltip while a recording locks the selector. */
  lockedWhileRecording: 'Stop the recording to change the capture level',
  description:
    "Sets how much of the agent's activity reaches the map and recordings. " +
    'Each level includes the ones before it; anything above is discarded on arrival.',
  /**
   * Settings-only second sentence: the row has room the tooltip lacks,
   * so the mirror spells out the live + lock behaviour there.
   */
  settingsNote:
    'The level applies live to both Real Time and recordings; it locks while a recording runs.',
  /** Per-level option labels (the ladder is cumulative, left to right). */
  levels: {
    executions: 'Runs',
    reads: '+Reads',
    writes: '+Writes',
    mcp: '+MCP',
    shell: '+Shell',
  },
  /** Per-level option tooltips (what you SEE at each rung, not the mechanism). */
  tooltips: {
    executions:
      'Only what runs: skills, agents and commands lighting up, spawns, session start and end',
    reads: 'Adds which docs the agent opens: scanned .md files it reads show up as activity',
    writes: 'Adds which docs the agent modifies: writes and edits to scanned .md files',
    mcp: 'Adds MCP tool calls. The default, everything the hooks capture',
    shell:
      'Adds .md files spotted inside shell commands (cat, grep...). ' +
      'Only the paths are kept, never the commands',
  },
  /**
   * Shell unlock block (Settings mirror only): the install-side half of
   * the double opt-in happens in the terminal, so the row hands the
   * operator the exact command, copy-command style like the MCP row.
   */
  shellUnlock: {
    hint: 'To unlock the Shell level, opt in from the terminal and restart claude:',
    command: 'sm activity install claude --shell',
    /**
     * Opted-in state: the line stays (its absence read as a bug in the
     * field, 2026-08-17) and keeps showing the OPT-IN command (the
     * revert flag rides the prose; a `--no-shell` snippet under an
     * enabled rung read backwards, user call same day).
     */
    hintOn:
      'Shell capture is opted in with this command; for your privacy, ' +
      'turn it off any time with --no-shell:',
    copyLabel: 'Copy command',
    copiedLabel: 'Copied',
  },
} as const;
