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
 * client, as a function of the LIVE server URL (the MCP endpoint rides the
 * same single `sm serve` listener the UI is served from, so the caller
 * passes the page origin + `/mcp`, never a hardcoded port: a server started
 * with `--port N` must show `N`, not the 4242 default). Kept as a plain
 * `Record` (not folded into the `as const` catalog below) so the closed
 * provider list stays trivially editable and an arbitrary lens id can index
 * it without a literal-key cast. Only lenses with a project-local MCP config
 * live here; every other lens falls back to `MCP_REGISTER_COMMAND_DEFAULT`.
 */
export const MCP_REGISTER_COMMANDS: Record<string, (mcpUrl: string) => string> = {
  claude: (mcpUrl) => `claude mcp add --transport http --scope local skill-map ${mcpUrl}`,
  // Codex supports streamable-HTTP MCP via `codex mcp add <name> --url <url>`
  // (usage: `codex mcp add [OPTIONS] <NAME> (--url <URL> | -- <COMMAND>...)`,
  // verified against codex-rs cli/src/mcp_cmd.rs). Writes ~/.codex/config.toml.
  codex: (mcpUrl) => `codex mcp add skill-map --url ${mcpUrl}`,
};

/** Generic guidance shown for lenses without a project-local MCP config. */
export const MCP_REGISTER_COMMAND_DEFAULT = (mcpUrl: string): string =>
  `Run \`sm serve --mcp\`, then register ${mcpUrl} in your agent MCP config.`;

/** The register command for a lens (given the live MCP URL), or the generic fallback. */
export function mcpRegisterCommand(
  providerId: string | null | undefined,
  mcpUrl: string,
): string {
  if (providerId && providerId in MCP_REGISTER_COMMANDS) {
    return MCP_REGISTER_COMMANDS[providerId](mcpUrl);
  }
  return MCP_REGISTER_COMMAND_DEFAULT(mcpUrl);
}

export const QUICK_START_TEXTS = {
  /** Topbar trigger (rocket button). */
  triggerTooltip: 'Quick Start',
  triggerAriaLabel: 'Open Quick Start',
  /**
   * Persistent callout pointing at the trigger while the tutorial
   * reminder's step-0 message (the one that names Quick Start) is
   * showing (`TutorialReminderBanner`'s `quickStartMentioned` output).
   * Always visible, no hover needed, unlike the trigger's own tooltip.
   */
  calloutLabel: 'Try Quick Start',

  /** Modal chrome. */
  modalTitle: 'Quick Start',
  /** Dimmed subtitle: signals these are shortcuts to Settings controls. */
  modalSubtitle: 'A shortcut to what also lives in Settings.',
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
    connected: 'Connected',
    notConnected: 'Not connected yet',
    notChecked: 'Not checked yet',
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

  /** The three capability groups (rail label + its own panel description). */
  groups: {
    live: {
      heading: 'Live update',
      description: 'See the map update instantly as files change in your project.',
    },
    realtime: {
      heading: 'Real Time',
      description: 'Watch the map light up as your AI assistant works, and capture what agents say.',
    },
    ai: {
      heading: 'AI Actions',
      description: 'Connect an AI agent to improve your nodes semantically, probabilistically.',
    },
  },

  /** Per-row label / description (+ contextual hints). */
  rows: {
    liveUpdates: {
      label: 'Live updates',
      description:
        'Keep the map in sync with your file system. Change a file and you see it update instantly.',
    },
    followSymlinks: {
      label: 'Follow external symlinks',
      description: 'Follow symbolic links even outside the project. Note this carries a risk.',
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
        'Install the hooks to connect your agent with the map and see it in real time. After installing, restart your agent (it loads hooks at session start) and restart sm so the wiring takes effect.',
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
        'Connect the map with your agent and watch the nodes light up as they run.',
      blockedHint: 'Turn on Live updates and install the real-time hook above first.',
    },
    capture: {
      label: 'Capture conversations',
      description:
        'Inspect what your agents say to each other (click a connector to see it).',
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
        'Expose skill-map so another agent can read the map, and you can manage the job queue too.',
      restartHint: 'Restart sm serve --mcp to apply.',
    },
    mcpInstalled: {
      label: 'MCP installed on your agent',
      description:
        'Copy the command and run it in your agent, approve the MCP connection when your ' +
        'agent prompts you, then click Check to confirm the live connection.',
      copiedHint: 'Command copied to the clipboard.',
    },
    agentSkill: {
      label: 'Agent skill installed',
      description: 'Install the skill that will process the queue.',
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
      label: 'Agent waiting for jobs',
      /**
       * The row's whole point: nothing drains the queue until the operator
       * RUNS the processing skill in their agent. `invocation` is the
       * skill handle joined against the active lens's `invocationSigil`
       * (`/sm-process-jobs` on claude / antigravity / opencode,
       * `$sm-process-jobs` on codex).
       */
      description: (invocation: string): string =>
        `Run ${invocation} in your agent so it processes every job skill-map queues up.`,
      needsSkillHint: 'Install the agent skill above, then check.',
    },
  },
} as const;

/** Row readiness state, drives the status indicator icon + tone. */
export type TQuickStartStatus = 'ready' | 'not-ready' | 'unknown';
