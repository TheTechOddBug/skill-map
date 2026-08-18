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
    /** The LOCKED shell position: why it is off and where to fix it. */
    shellLocked: 'Disabled: see Settings > Project > Capture level for how to enable it',
  },
  /**
   * Shell unlock block (Settings mirror only): the install-side half of
   * the double opt-in happens in the terminal, so the row hands the
   * operator the exact command, copy-command style like the MCP row.
   * Lens-conditioned (user report 2026-08-18: the line hardcoded
   * claude regardless of the active lens): the provider id comes from
   * the readiness probe, and a lens whose provider declares no shell
   * opt-in event gets the `unavailable` line instead of a command that
   * would only be refused.
   */
  shellUnlock: {
    hint: (provider: string): string =>
      `To unlock the Shell level, opt in from the terminal and restart ${provider}:`,
    command: (provider: string): string => `sm activity install ${provider} --shell`,
    /**
     * Opted-in state: the line stays (its absence read as a bug in the
     * field, 2026-08-17) and keeps showing the OPT-IN command (the
     * revert flag rides the prose; a `--no-shell` snippet under an
     * enabled rung read backwards, user call same day).
     */
    hintOn:
      'Shell capture is opted in with this command; for your privacy, ' +
      'turn it off any time with --no-shell:',
    /** Lens without the shell opt-in event: no command to hand over. */
    unavailable: (provider: string): string =>
      `The ${provider} runtime exposes no shell hook, so the Shell level is unavailable on this lens.`,
    copyLabel: 'Copy command',
    copiedLabel: 'Copied',
  },
} as const;
