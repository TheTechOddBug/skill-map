/**
 * Strings emitted by `cli/commands/help.ts`.
 *
 * Convention: flat string templates with `{{name}}` placeholders. The
 * `tx` helper at `kernel/util/tx.ts` does the interpolation.
 *
 * Markdown structural pieces (code-fence backticks `\`\`\``, leading
 * pipes, blockquote markers) stay inline in the renderer, they are
 * markdown syntax, not user-facing prose. Everything that a translator
 * would touch (headings, labels, the "Generated from..." notice, the
 * version-line copy) lives here.
 */

export const HELP_TEXTS = {
  // --- format / verb validation --------------------------------------------
  /**
   * §3.1b error block per `context/cli-output-style.md`. Headline
   * names the offending value, hint lists the closed catalog of
   * accepted formats. The caller renders `{{glyph}}` as red `✕` and
   * dims the hint.
   */
  invalidFormat:
    '{{glyph}}  --format: invalid value "{{format}}".\n' +
    '   {{hint}}\n',
  invalidFormatHint: 'Allowed: human, md, json.',
  /** Same §3.1b shape for an unknown verb name. */
  unknownVerb:
    '{{glyph}}  sm help: unknown verb "{{verb}}".\n' +
    '   {{hint}}\n',
  unknownVerbHint: 'Run `sm help` (no argument) to list every verb.',

  // --- markdown header -----------------------------------------------------
  mdReferenceTitle: '# `sm` CLI reference',
  mdGeneratedNotice:
    'Generated from `sm help --format md`. Do not hand-edit; CI regenerates this file from the live command surface.',
  mdCliVersionLine: '- CLI version: `{{version}}`',
  mdSpecVersionLine: '- Spec version: `{{version}}`',

  // --- global flags section ------------------------------------------------
  mdHeaderGlobalFlags: '## Global flags',
  mdGlobalFlagBullet: '- `{{name}}`: {{description}}',
  /** Description copy for the `--help` global flag in the JSON / md output. */
  globalFlagHelpDescription: 'Print usage and exit.',
  /**
   * Description copy for the boot-level `--log` global flag in the
   * JSON / md output. Named here (not in `util.texts.ts` next to the
   * `SmCommand` four) because the flag is not an `Option.*` on any
   * command class; `entry.ts` extracts it from argv before Clipanion
   * parses, so only the published catalog ever renders this string.
   */
  globalFlagLogDescription:
    'Set the log level (trace / debug / info / warn / error / silent). Equivalent spelling: --log-level. Resolved at process boot.',

  // --- per-category / per-verb (md) ----------------------------------------
  mdCategoryHeading: '## {{category}}',
  mdVerbHeading: '### `sm {{name}}`',
  mdLabelFlags: '**Flags:**',
  /** Per-verb exit-code line; `{{codes}}` arrives pre-formatted as `` `0`, `2`, `5` ``. */
  mdLabelExitCodes: '**Exit codes:** {{codes}}',
  mdLabelExamples: '**Examples:**',
  mdFlagBullet: '- {{names}} `{{type}}`{{required}}{{description}}',
  /** Trailing fragment for `mdFlagBullet`'s `{{required}}` slot. */
  mdFlagBulletRequiredFragment: ' (required)',
  /** Trailing fragment for `mdFlagBullet`'s `{{description}}` slot (with leading colon). */
  mdFlagBulletDescriptionFragment: ': {{description}}',
  mdExampleBullet: '- {{title}}',

  // --- human single-verb renderer ------------------------------------------
  /** Header line for `sm help <verb>` and `sm <verb> --help`. */
  humanVerbHeader: 'sm {{name}}:  {{description}}',
  humanDescriptionHeading: 'DESCRIPTION',
  humanUsageHeading: 'USAGE',
  /**
   * Single-line USAGE row. `{{positionals}}` is the trailing portion of
   * the Clipanion path (e.g. `<orphanPath>` or `[roots...]`); empty when
   * the command takes no positionals.
   */
  humanUsageRow: '  sm {{name}} [options]{{positionals}}',
  humanFlagsHeading: 'FLAGS',
  /** Aligned flag row inside the FLAGS block; `{{padding}}` keeps the description column flush. */
  humanFlagRow: '  {{names}}{{padding}}  {{description}}{{required}}',
  /** Trailing fragment for `humanFlagRow`'s `{{required}}` slot. */
  humanFlagRowRequiredFragment: ' (required)',
  humanFooter: 'Run `sm help {{name}} --format md` for the full reference.',

  // --- human group renderer (sm <namespace> --help, sm help <namespace>) ---
  /**
   * USAGE row for a command namespace (a prefix that owns subcommands but
   * is not itself a runnable verb, e.g. `plugins`, `db`). Mirrors
   * `humanUsageRow` but advertises the `<command>` slot instead of
   * positionals.
   */
  humanGroupUsageRow: '  sm {{name}} <command> [options]',
  /** Section heading listing the subcommands of a namespace. */
  humanCommandsHeading: 'COMMANDS',
  /** Aligned subcommand row; `{{name}}` is the subcommand relative to the namespace. */
  humanCommandRow: '  {{name}}{{padding}}  {{description}}',
  /** Footer for the namespace overview, points at per-subcommand help. */
  humanGroupFooter: 'Run `sm {{name}} <command> --help` for flags and arguments.',
  /** Fallback header description when a namespace has no curated entry in `HELP_GROUPS`. */
  groupFallbackDescription: '{{category}} commands',

  // --- human compact overview (sm / sm --help / sm help, no verb) ---------
  /**
   * Compact-overview header. Replaces the Clipanion default ANSI banner.
   * Tagline mirrors README.md "In a sentence", keep them in sync.
   */
  compactHeader: '{{binary}} {{version}}:  the missing map for Markdown-based generative-AI ecosystems',
  /**
   * Tutorial call-to-action rendered at the very top of the compact
   * overview, directly under the header and above USAGE, to point new
   * users at `sm tutorial`. `{{glyph}}` is a green `▶` when color is on,
   * a bare `▶` otherwise.
   */
  compactTutorialCta:
    '{{glyph}}  New to skill-map? Run `sm tutorial` for a hands-on, guided walkthrough.',
  compactUsageHeading: 'USAGE',
  compactUsageLine: '  sm <command> [options]',
  compactExamplesHeading: 'EXAMPLES',
  compactExampleInit: 'Bootstrap a project scope',
  compactExampleScanCheck: 'Scan and review issues',
  compactExampleOrphans: 'Pipe orphans to jq',
  /**
   * Marker prepended to the description column for not-yet-implemented
   * verbs (those whose registered description carries `(planned)`).
   * Trailing space is intentional, the marker is concatenated before
   * the rest of the description.
   */
  compactStubMarker: '[stub] ',
  /** Per-category section heading (uppercased from the registered category). */
  compactCategoryHeading: '{{category}}',
  /**
   * Single command row. The renderer pads `{{name}}` to the category's
   * widest verb so descriptions align in a column.
   */
  compactVerbRow: '  {{name}}{{padding}}  {{description}}',
  /** Same row shape for example rows; padding aligned across the EXAMPLES block. */
  compactExampleRow: '  {{command}}{{padding}}  {{description}}',
  compactFooter: 'Run `sm <command> --help` for flags and arguments.',
} as const;

/**
 * Curated copy for command namespaces, the prefixes that own subcommands
 * but are not themselves runnable verbs (`plugins`, `db`, `config`, ...).
 * Consumed by the group overview rendered for `sm <namespace> --help` and
 * `sm help <namespace>`. `description` is the one-line header; the optional
 * `details` paragraph renders as the DESCRIPTION block (omit it to keep the
 * overview to header + COMMANDS list). Namespaces missing here still render,
 * falling back to `groupFallbackDescription` and no DESCRIPTION block.
 */
export const HELP_GROUPS: Record<string, { description: string; details?: string }> = {
  plugins: {
    description: 'Discover, inspect, and toggle plugins',
    details:
      'A plugin is a directory of extensions (extractors, analyzers, actions,\n' +
      'hooks, formatters, providers) discovered under the project plugins dir.\n' +
      '\n' +
      'Use `list` and `show` to inspect what loaded, `doctor` to diagnose load\n' +
      'failures, `enable` / `disable` to toggle extensions (persisted in the DB),\n' +
      'and `create` / `upgrade` to scaffold and migrate your own.',
  },
  config: {
    description: 'Read and write project configuration',
    details:
      'Configuration is a layered merge: library defaults, the committed\n' +
      '`settings.json`, the gitignored `settings.local.json`, env vars, then\n' +
      'CLI flags, with later layers winning.\n' +
      '\n' +
      'Use `list` / `get` to read the effective values, `show --source` to see\n' +
      'which layer set a key, and `set` / `reset` to write or revert one.\n' +
      'Privacy-sensitive keys (paths outside the project) require `--yes`.',
  },
  db: {
    description: 'Inspect and maintain the project database',
    details:
      'The project database is a single SQLite file at\n' +
      '`.skill-map/skill-map.db`, holding the scan graph and plugin state.\n' +
      '\n' +
      'Use `backup` / `restore` around risky operations, `migrate` to apply\n' +
      'pending kernel and plugin migrations, `reset` to drop tables (or the\n' +
      'whole file), and `dump` / `shell` / `browser` to inspect the data.',
  },
  jobs: {
    description: 'Manage the background job queue',
    details:
      'Probabilistic and long-running work runs as jobs: queued, persisted in\n' +
      'the database, and resumable across restarts.\n' +
      '\n' +
      'Use `submit` to enqueue (or `--all` to fan out across nodes), `run` to\n' +
      'execute the claim-spawn-record loop, `status` / `list` / `show` to\n' +
      'inspect, `preview` to render a job without executing it, and\n' +
      '`cancel` / `prune` to clean up.',
  },
  actions: {
    description: 'Inspect the registered Action catalog',
    details:
      'An Action operates on one or more nodes and is either deterministic\n' +
      '(in-process code) or probabilistic (a rendered prompt a runner executes).\n' +
      '\n' +
      'Use `list` for the catalog of registered action types and `show` for a\n' +
      "single action's full manifest, including its preconditions and expected\n" +
      'duration.',
  },
  sidecars: {
    description: 'Manage `.sm` annotation sidecars',
    details:
      "Skill-map's annotation layer lives in co-located `.sm` YAML sidecars\n" +
      'next to each node, leaving the vendor file untouched.\n' +
      '\n' +
      'Use `annotate` to scaffold an empty sidecar ready for editing, `refresh`\n' +
      'to realign its drift hashes with the live node, and `prune` to delete\n' +
      'sidecars whose `.md` no longer exists.',
  },
  hooks: {
    description: 'Install git hooks for sidecar drift',
    details:
      'Git hooks keep your sidecars in sync with the repo as you commit.\n' +
      '\n' +
      '`install` writes a pre-commit hook that auto-bumps staged sidecar drift\n' +
      'before each commit.',
  },
  conformance: {
    description: 'Run the spec conformance suite',
    details:
      'The conformance suite checks an implementation against the spec.\n' +
      '\n' +
      '`run` executes the spec-owned cases plus every built-in Provider and\n' +
      'reports the results.',
  },
};
