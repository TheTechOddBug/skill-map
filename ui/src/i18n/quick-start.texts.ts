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
 * What the "MCP installed on your agent" Copy affordance puts on the
 * clipboard for the active lens. Two flavours, because only some runtimes
 * ship an `mcp` CLI verb: the rest are configured by editing a JSON file.
 */
export interface IMcpRegisterSnippet {
  /** Text the Copy button puts on the clipboard. */
  payload: string;
  /** `command` = a shell command to run; `config` = a snippet to paste into a config file. */
  kind: 'command' | 'config';
  /** For `config`, where the snippet goes (block + file), shown as the row hint. */
  target?: string;
}

/**
 * A COMPLETE config document declaring the skill-map server, ready to save
 * as a brand-new file. Deliberately not a bare entry: every `config` target
 * is the operator's PERSONAL config (see the per-lens targets below), and
 * the common case is that it does not exist yet, so a fragment would leave
 * a first-time user assembling JSON by hand. The row's paste hint covers
 * the other case in one line (a file that already exists takes only the
 * `skill-map` entry, so the servers already declared there survive).
 */
function mcpConfigDocument(document: Record<string, unknown>): string {
  return JSON.stringify(document, null, 2);
}

/**
 * Per-lens register snippet, as a function of the LIVE MCP endpoint. The URL
 * comes from `GET /api/mcp/status` (`url`), built by the server from its own
 * bind: the page origin is NOT a substitute, because under the dev setup the
 * SPA is served by a proxy whose port is not the one `/mcp` listens on.
 * Kept as a plain `Record` (not folded into the `as const` catalog below) so
 * the closed provider list stays trivially editable and an arbitrary lens id
 * can index it without a literal-key cast. Every other lens falls back to
 * `MCP_REGISTER_SNIPPET_DEFAULT`.
 */
export const MCP_REGISTER_SNIPPETS: Record<
  string,
  (mcpUrl: string) => IMcpRegisterSnippet
> = {
  claude: (mcpUrl) => ({
    kind: 'command',
    payload: `claude mcp add --transport http --scope local skill-map ${mcpUrl}`,
  }),
  // Codex supports streamable-HTTP MCP via `codex mcp add <name> --url <url>`
  // (usage: `codex mcp add [OPTIONS] <NAME> (--url <URL> | -- <COMMAND>...)`,
  // verified against codex-rs cli/src/mcp_cmd.rs). Writes ~/.codex/config.toml.
  codex: (mcpUrl) => ({
    kind: 'command',
    payload: `codex mcp add skill-map --url ${mcpUrl}`,
  }),
  // No command flavour on purpose: the Antigravity CLI (`agy`) exposes no
  // `mcp` subcommand, and its MCP config is home-global
  // (`~/.gemini/config/mcp_config.json`, key `serverUrl`), with no
  // project-local counterpart. Editing that file is the only way in.
  antigravity: (mcpUrl) => ({
    kind: 'config',
    target: '~/.gemini/config/mcp_config.json',
    payload: mcpConfigDocument({ mcpServers: { 'skill-map': { serverUrl: mcpUrl } } }),
  }),
  // Config-file based too (opencode has no `mcp` CLI verb), and aimed at the
  // operator's GLOBAL config on purpose. OpenCode also reads a project
  // `opencode.json`, but its docs call that one "safe to commit to Git": it
  // is the team's file, and skill-map is a per-developer tool, so putting
  // its server there would push the whole team into an MCP they never asked
  // for. The global config keeps the registration where the other three
  // lenses already keep theirs, out of the repository.
  opencode: (mcpUrl) => ({
    kind: 'config',
    target: '~/.config/opencode/opencode.json',
    payload: mcpConfigDocument({
      $schema: 'https://opencode.ai/config.json',
      mcp: { 'skill-map': { type: 'remote', url: mcpUrl, enabled: true } },
    }),
  }),
};

/**
 * Fallback for lenses with no known MCP config shape: the bare endpoint, so
 * Copy still hands the operator the one thing every MCP client asks for.
 */
export const MCP_REGISTER_SNIPPET_DEFAULT = (mcpUrl: string): IMcpRegisterSnippet => ({
  kind: 'config',
  payload: mcpUrl,
});

/** The register snippet for a lens (given the live MCP URL), or the bare-URL fallback. */
export function mcpRegisterSnippet(
  providerId: string | null | undefined,
  mcpUrl: string,
): IMcpRegisterSnippet {
  if (providerId && providerId in MCP_REGISTER_SNIPPETS) {
    return MCP_REGISTER_SNIPPETS[providerId](mcpUrl);
  }
  return MCP_REGISTER_SNIPPET_DEFAULT(mcpUrl);
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
    connected: 'Connected',
    notConnected: 'Not connected yet',
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
    copyConfig: 'Copy config',
    copied: 'Copied',
    check: 'Check',
    recheck: 'Recheck',
  },

  /**
   * Per-group pointer to the guided tutorial (the `sm-tutorial` book).
   * Each Quick Start group has a matching part of the book; the note
   * names it and says how to launch it. The book runs in an EMPTY
   * folder, never this project, so the note spells that out.
   * `invocation` is the skill handle joined against the active lens's
   * `invocationSigil`, mirroring `rows.agentJobs.description`.
   */
  tutorial: {
    // The note renders as prefix + a code-styled invocation chip +
    // suffix, so the segments live separately.
    notePrefix: (part: string): string =>
      `Prefer a guided walkthrough? The tutorial covers this in "${part}". In an empty folder, run `,
    noteSuffix: ' in your agent and pick that part from the menu.',
    parts: {
      live: 'The live map (prologue)',
      realtime: 'Real time: watch your agent run',
      ai: 'The AI layer: your agent works the map',
    },
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
      // Gated on the HOOK alone (not on Live updates): without the hook no
      // activity event ever reaches skill-map, so the gate would capture
      // nothing at all.
      blockedHint: 'Install the real-time hook above first.',
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
      // The toggle writes `mcp.server.enabled`, and the server resolves
      // `flag ?? config ?? off`, so a plain restart picks it up: naming the
      // `--mcp` flag here implied it was required, which it is not.
      restartHint: 'Saved. Restart sm to apply.',
    },
    mcpInstalled: {
      label: 'MCP installed on your agent',
      // Deliberately flavour-neutral: some runtimes register MCP with a
      // command, others only by editing a config file, so the row copy has
      // to fit both (the hint below names the file when there is one).
      description:
        'Copy what your agent needs and apply it there, approve the MCP connection when your ' +
        'agent prompts you, then click Check to confirm the live connection. It belongs in ' +
        'your own config.',
      /**
       * Hint under a "Not connected yet" verdict. The row reports the one
       * thing it can observe, a live MCP session, and an agent that drains
       * the queue over the CLI never opens one, so the absence of a session
       * is not necessarily a broken setup and nothing gates on this row.
       */
      unconnectedHint: 'An agent that works the queue over the CLI never opens a session.',
      copiedHint: 'Copied to the clipboard.',
      /**
       * Where a `config` snippet goes, shown while nothing else occupies
       * the hint line. The payload is a whole document (the target usually
       * does not exist yet), so the second sentence covers the operator who
       * already has that file: only the entry goes in, their other servers
       * stay.
       */
      pasteHint: (target: string): string =>
        `Paste it into ${target}. If that file exists, add only the "skill-map" entry.`,
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
