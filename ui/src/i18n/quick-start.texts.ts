/**
 * UI strings for the Quick Start modal (the rocket button in the
 * topbar actions cluster). A single-scroll panel that answers "what do I
 * need to use X?" across three capability groups: Live update, Real Time,
 * and AI Actions.
 *
 * Convention: each component / service owns a `*.texts.ts` file under
 * `src/i18n/`. Strings are English-only, see AGENTS.md §"Externalized
 * texts, not internationalized". Functions carry the parameterised
 * strings.
 */

/**
 * Per-lens shell command that registers skill-map's MCP server in that
 * client. Kept as a plain `Record<string, string>` (not folded into the
 * `as const` catalog below) so the closed provider list stays trivially
 * editable and an arbitrary lens id can index it without a literal-key
 * cast. Only lenses with a project-local MCP config live here; every
 * other lens falls back to `MCP_REGISTER_COMMAND_DEFAULT`.
 */
export const MCP_REGISTER_COMMANDS: Record<string, string> = {
  // Canonical form used by the sm-process-jobs skill template (default
  // port 4242; edit the port if `sm serve` runs elsewhere).
  claude: 'claude mcp add --transport http --scope local skill-map http://127.0.0.1:4242/mcp',
  // TODO verify: codex MCP registration over streamable-http. Codex reads
  // TOML `mcp_servers`; this is the presumed CLI form until confirmed.
  codex: 'codex mcp add skill-map --url http://127.0.0.1:4242/mcp',
};

/** Generic guidance shown for lenses without a project-local MCP config. */
export const MCP_REGISTER_COMMAND_DEFAULT =
  'Run `sm serve --mcp`, then register http://127.0.0.1:4242/mcp in your agent MCP config.';

/**
 * Lenses whose MCP config is project-local, so a scan can materialise an
 * `mcp://skill-map` node the panel can verify against. Every other lens
 * (home-scoped configs like antigravity) shows copy guidance only and
 * never claims verification.
 */
export const MCP_VERIFIABLE_LENSES: readonly string[] = ['claude', 'codex'];

/** The register command for a lens, or the generic guidance fallback. */
export function mcpRegisterCommand(providerId: string | null | undefined): string {
  if (providerId && providerId in MCP_REGISTER_COMMANDS) {
    return MCP_REGISTER_COMMANDS[providerId];
  }
  return MCP_REGISTER_COMMAND_DEFAULT;
}

export const QUICK_START_TEXTS = {
  /** Topbar trigger (rocket button). */
  triggerTooltip: 'Quick Start',
  triggerAriaLabel: 'Open Quick Start',

  /** Modal chrome. */
  modalTitle: 'Quick Start',
  intro: 'Check what each capability needs and switch it on from one place.',
  errorPrefix: 'Something went wrong:',

  /** Shared status words (drive the per-row indicator text). */
  status: {
    on: 'On',
    off: 'Off',
    installed: 'Installed',
    notInstalled: 'Not installed',
    unavailable: 'Not available for this lens',
    unknown: 'Not checked yet',
    checking: 'Checking...',
    live: 'Live',
    optedIn: 'Opted in, restart to apply',
    registered: 'Registered',
    notRegistered: 'Not registered',
    registerManually: 'Register manually',
    updateAvailable: 'Update available',
    attending: 'An agent is answering',
    noAgent: 'No agent answering',
    needsSkill: 'Install the agent skill first',
    noNodeToProbe: 'Scan a file first',
  },

  /** Shared action-button labels. */
  action: {
    enable: 'Enable',
    disable: 'Disable',
    install: 'Install',
    update: 'Update',
    uninstall: 'Uninstall',
    copyCommand: 'Copy command',
    copied: 'Copied',
    check: 'Check',
    recheck: 'Recheck',
  },

  /** The three capability groups. */
  groups: {
    live: { heading: 'Live update' },
    realtime: { heading: 'Real Time' },
    ai: { heading: 'AI Actions' },
  },

  /** Per-row label / description (+ contextual hints). */
  rows: {
    liveUpdates: {
      label: 'Live updates',
      description:
        'Keep the map in sync with sm: scan refreshes, live events, node activity.',
    },
    followSymlinks: {
      label: 'Follow external symlinks',
      description:
        'Follow symbolic links whose target is outside the project. Enabling ' +
        'this asks for confirmation first.',
      confirmHeader: 'Follow links that leave this project?',
      confirmIntro:
        'Security risk: external links can expose files outside the project ' +
        '(e.g. ~/.ssh). Enable only for trees whose links you created.',
      confirmAccept: 'Enable',
      confirmReject: 'Cancel',
    },
    hook: {
      label: 'Real-time hook installed',
      description:
        'Wire the active lens runtime so the map lights up each node the moment it runs.',
      unsupportedHint: 'This lens has no real-time hook yet.',
      installConfirmHeader: 'Install the real-time hook?',
      installConfirmIntroPrefix: 'skill-map will write',
      installConfirmIntroSuffix: 'in this project. Nothing else is touched.',
      uninstallConfirmHeader: 'Uninstall the real-time hook?',
      uninstallConfirmIntroPrefix: 'skill-map will remove its wiring from',
      uninstallConfirmIntroSuffix: 'in this project. Nothing else is touched.',
      confirmAccept: 'Proceed',
      confirmReject: 'Cancel',
    },
    realtime: {
      label: 'Real-time node activity',
      description:
        'Light up nodes on the map the moment your AI assistant invokes them.',
      blockedHint: 'Turn on Live updates and install the real-time hook above first.',
    },
    capture: {
      label: 'Capture conversations',
      description:
        'Record the prompts and responses that flow between your agents, so ' +
        'spawn edges can show what was said.',
      enableConfirmHeader: 'Capture conversation content?',
      enableConfirmIntro:
        'Prompts and responses between agents will be recorded in this ' +
        'session while the gate is on.',
      disableConfirmHeader: 'Stop capturing conversations?',
      disableConfirmIntro: 'Turning this off clears the captured content immediately.',
      enableConfirmAccept: 'Capture',
      disableConfirmAccept: 'Stop',
      confirmReject: 'Cancel',
    },
    mcpLive: {
      label: 'MCP server live',
      description:
        'Expose the read-only MCP endpoint at /mcp so an MCP-capable assistant ' +
        'can query the map and drive the job queue.',
      restartHint: 'Restart sm serve --mcp to apply.',
    },
    mcpInstalled: {
      label: 'MCP installed in project',
      description:
        'Register skill-map as an MCP server in your agent so it can reach ' +
        'the endpoint. Copy the command for your lens and run it.',
      copiedHint: 'Command copied to the clipboard.',
    },
    agentSkill: {
      label: 'Agent skill installed',
      description:
        'Teach your agent to work through the job queue: installs the ' +
        'sm-process-jobs skill in this project.',
      installConfirmHeader: 'Install the agent skill?',
      installConfirmIntroPrefix: 'skill-map will write',
      installConfirmIntroSuffix: 'in this project. Nothing else is touched.',
      updateConfirmHeader: 'Update the agent skill?',
      updateConfirmIntroPrefix: 'skill-map will refresh',
      updateConfirmIntroSuffix: 'to the version this CLI ships.',
      uninstallConfirmHeader: 'Uninstall the agent skill?',
      uninstallConfirmIntroPrefix: 'skill-map will remove',
      uninstallConfirmIntroSuffix: 'from this project. Nothing else is touched.',
      confirmAccept: 'Proceed',
      confirmReject: 'Cancel',
    },
    agentJobs: {
      label: 'Agent attending jobs',
      description:
        'Whether an agent is running the sm-process-jobs skill and answering ' +
        'the queue right now. Depends on the agent skill above being installed.',
      needsSkillHint: 'Install the agent skill above, then check.',
    },
  },
} as const;

/** Row readiness state, drives the status indicator icon + tone. */
export type TQuickStartStatus = 'ready' | 'not-ready' | 'unknown';
