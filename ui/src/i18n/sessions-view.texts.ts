/** UI strings for the SessionsView (the workspace rail's sessions panel). */
export const SESSIONS_VIEW_TEXTS = {
  /** Friendly empty state, mirrors the queue view's "nothing here" tone. */
  empty: 'No sessions recorded yet.',
  emptyHint:
    'Press Record and every AI session this page observes lands here, ready to replay.',
  /** Paginator report, the Queue tab's exact dialect. */
  pageReport: '{first}-{last} of {totalRecords}',
  /** Shown when the ring dropped the oldest frames (see the recorder cap). */
  trimmedNotice: 'Earliest events were trimmed; older sessions may appear incomplete or split.',
  /**
   * Replay scope label for one agent branch. `sessionName` is the
   * session's REAL identity (the runtime session id, or the start time
   * when the runtime reported none): the synthetic "Session N" ordinal
   * died everywhere user-visible on 2026-08-16 (it correlated with
   * nothing; the id matches the journal filenames on disk).
   */
  agentLabel: (sessionName: string, agentName: string): string =>
    `${sessionName}: ${agentName}`,
  /** Fallback for an agent whose runtime never named it. */
  unnamedAgent: 'agent',
  /** Dim parenthetical after every spawned agent's name (user request 2026-08-16). */
  subagentTag: '(subagent)',
  play: 'Replay',
  playTooltip: 'Replay this session on the map',
  playAgentTooltip: 'Replay only this agent and its children',
  playUnavailableTooltip: 'Replay needs Real Time on and the live map available',
  /** The in-flight session while recording cannot replay (collides with the live view). */
  playRecordingTooltip: 'Recording this session now; stop recording to replay it',
  /** `N events · M files · K agents` row stats. */
  stats: (events: number, files: number, agents: number): string =>
    `${events} ${events === 1 ? 'event' : 'events'} · ${files} ${files === 1 ? 'file' : 'files'} · ${agents} ${agents === 1 ? 'agent' : 'agents'}`,
  /** Separator between touched-node names in a session's title. */
  touchedSeparator: ' · ',
  /** Compact per-agent stats (no agent counter, the tree shows them). */
  agentStats: (events: number, files: number): string =>
    `${events} ${events === 1 ? 'event' : 'events'} · ${files} ${files === 1 ? 'file' : 'files'}`,
  expand: (label: string): string => `Expand ${label}`,
  collapse: (label: string): string => `Collapse ${label}`,
  /**
   * One internal step row (same grammar as the replay ticker): a unit's
   * own execution reads `run <name>`; a resource access leads with the
   * reported tool (`Read guide.md`, `notion-create-pages notion`).
   */
  step: (name: string, detail: string | undefined): string =>
    detail === undefined ? `run ${name}` : `${detail} ${name}`,
  /** Step rows are deep links into the replay (land on that frame). */
  stepTooltip: 'Replay this session from this step',
} as const;
