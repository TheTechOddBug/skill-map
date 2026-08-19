/**
 * `sm activity install <provider> [--yes]` / `sm activity uninstall <provider>`
 *
 * Live node activity wiring (normative contract:
 * `spec/provider-activity.md`; verb surface: `cli-contract.md`
 * §Activity). `install` writes the zero-dependency bridge artifact under
 * `.skill-map/activity/` and merges hook entries that spawn it into the
 * provider's PROJECT-LOCAL hook config, per the Provider's declarative
 * `activity.install` descriptor. `uninstall` reverses exactly that.
 *
 * Normative behaviors:
 *
 *   - **Consent-gated**: the merge modifies a file skill-map does not
 *     own, so a TTY y/N prompt names the exact target; `--yes` covers
 *     non-interactive runs; a non-TTY without `--yes` refuses (exit 2).
 *   - **Non-destructive + reversible**: pre-existing operator hooks are
 *     preserved; our entries carry the bridge path as marker and
 *     `uninstall` removes exactly them (see `core/activity/hooks-merge.ts`).
 *
 * The mechanics live in the shared engine (`core/activity/install.ts`),
 * also driven by the BFF's `/api/activity/install|uninstall` routes;
 * this file owns only the CLI chrome (consent prompt, texts, exits).
 *   - **Project-local only**: every path is joined onto the cwd; the
 *     provider's `configPath` is scope-relative by schema. `$HOME` is
 *     never touched, per the scope invariant.
 *   - Idempotent both ways: re-install and double-uninstall no-op with
 *     exit 0.
 *
 * Providers are resolved off the FULL composed registry (built-ins plus
 * trusted, enabled drop-in plugins, via `composeActiveProviders`), so a
 * drop-in Provider that declares an `activity` adapter is installable /
 * status-reportable exactly like a built-in. The import-trust gate still
 * applies: an untrusted project-local plugin is never imported, so it
 * never reaches the verb.
 */

import { Command, Option } from 'clipanion';

import type { IActivityInstallEvent, IProvider, TActivityInstall } from '../../kernel/extensions/index.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import {
  activityInstallStatus,
  demoteShellCaptureLevel,
  findActivityProvider,
  installActivityBridge,
  providerOwnsShellOptIn,
  uninstallActivityBridge,
} from '../../core/activity/install.js';
import {
  isFailingVerdict,
  readActivityDigest,
  verifyActivityWiring,
  type IActivityDigest,
  type IDigestShape,
  type IVerifyResult,
} from '../../core/activity/verify.js';
import { composeScanExtensions, loadPluginRuntime } from '../../core/runtime/plugin-runtime.js';
import { ACTIVITY_TEXTS } from '../i18n/activity.texts.js';
import { ACTIVITY_BRIDGE_REL } from '../util/db-path.js';
import { confirm } from '../util/confirm.js';
import { ExitCode } from '../util/exit-codes.js';
import { readConfigValue, writeConfigValue } from '../../core/config/helper.js';
import { defaultRuntimeContext } from '../../core/runtime/runtime-context.js';
import { SmCommand } from '../util/sm-command.js';

/**
 * Every active Provider for this project: built-ins PLUS trusted + enabled
 * drop-in plugins, composed exactly as the scan pipeline does
 * (`loadPluginRuntime` applies the import-trust gate + enable resolver, so
 * an untrusted repo plugin is never imported). Used so `sm activity` sees
 * a drop-in Provider's `activity` adapter, not only the built-in set. A
 * project-local plugin therefore reaches the verb only when the operator
 * has trusted it (`sm plugins trust <id>`), the same boundary the scan
 * honours.
 */
async function composeActiveProviders(): Promise<IProvider[]> {
  const pluginRuntime = await loadPluginRuntime();
  const composed = composeScanExtensions({
    noBuiltIns: false,
    pluginRuntime,
    resolveEnabled: pluginRuntime.resolveEnabled,
  });
  return composed?.providers ?? [];
}

/** The subset of `providers` that declare an activity adapter. */
function activityProviders(providers: readonly IProvider[]): IProvider[] {
  return providers.filter((p) => p.activity !== undefined);
}

/**
 * The three states `sm activity status` reports (`cli-contract.md`
 * §Activity). `partial` means the hook config is wired while the bridge
 * artifact is missing; the inverse never counts as partial, because the
 * bridge is shared across hook-file providers.
 */
/**
 * Events an install will render (`json-hooks` only): the descriptor
 * list post opt-in filter, mirroring the engine's own render pass
 * (`core/activity/install.ts`), so the success summary's event count
 * reports the surface actually wired.
 */
function renderedEvents(
  install: TActivityInstall,
  shellOn: boolean,
): readonly IActivityInstallEvent[] {
  if (install.kind !== 'json-hooks') return [];
  return (install.events ?? []).filter(
    (event) => event.optIn === undefined || (event.optIn === 'shell' && shellOn),
  );
}

type TActivityState = 'installed' | 'partial' | 'not-installed';

/**
 * Single source of the per-provider verdict, read by BOTH the human
 * line and the `--json` envelope so the two can never disagree.
 */
function activityStateOf(cwd: string, provider: IProvider): TActivityState {
  const status = activityInstallStatus(cwd, provider);
  if (status.installed) return 'installed';
  if (status.configWired) return 'partial';
  return 'not-installed';
}

export class ActivityInstallCommand extends SmCommand {
  static override paths = [['activity', 'install']];
  static override usage = Command.Usage({
    category: 'Actions',
    description: 'Wire the live-activity bridge into a provider runtime’s project-local hook config.',
    details: `
      Wires the provider's own runtime hooks to the live map, per its
      install shape: hook-file providers (\`claude\`, \`codex\`,
      \`antigravity\`) get the zero-dependency bridge script at
      \`.skill-map/activity/bridge.js\` plus hook entries merged into
      their project-local hook config; \`opencode\` gets one in-process
      plugin file at \`.opencode/plugin/skill-map-activity.js\`. With
      \`sm serve\` running, the map then lights up each node the moment
      the provider runtime invokes it.

      Writes are non-destructive (existing hooks are preserved) and
      exactly reversible via \`sm activity uninstall <provider>\`.
      Modifying the provider's territory is consent-gated: a TTY prompt
      names the target file; pass \`--yes\` for non-interactive runs.
    `,
    examples: [
      ['Wire Claude Code', '$0 activity install claude'],
      ['Wire OpenCode (in-process plugin)', '$0 activity install opencode'],
      ['Non-interactive (CI / scripts)', '$0 activity install claude --yes'],
    ],
  });

  provider = Option.String({ required: true });
  yes = Option.Boolean('-y,--yes', false);
  /**
   * Shell-rung opt-in pair (spec provider-activity.md, Capture level
   * rung 5): `--shell` persists `activity.shellCapture: true`
   * (project-local) BEFORE rendering, `--no-shell` retires it; neither
   * flag = the stored choice is respected (a bare re-install never
   * silently drops the rung). Refused (exit 2, nothing persisted) for
   * a provider whose descriptor carries no shell opt-in event: the key
   * would unlock the ladder's `shell` selector with no capture wired
   * behind it, and that provider's uninstall would never retire it.
   */
  shell = Option.Boolean('--shell', { description: 'Opt in the shell capture rung (renders the extra Bash hook; command lines are parsed for paths, never captured).' });

  /**
   * Shell opt-in gate (see the option doc): the flag pair only means
   * something on a provider whose descriptor owns the opt-in event.
   * Prints the refusal (naming the shell-capable providers) and says
   * so; a `false` lets the install proceed.
   */
  private shellFlagRefused(
    provider: IProvider,
    providers: readonly IProvider[],
    errGlyph: string,
  ): boolean {
    if (this.shell === undefined || providerOwnsShellOptIn(provider)) return false;
    const capable = providers
      .filter((p) => providerOwnsShellOptIn(p))
      .map((p) => sanitizeForTerminal(p.id));
    this.printer!.error(
      tx(ACTIVITY_TEXTS.shellNotSupported, {
        glyph: errGlyph,
        provider: sanitizeForTerminal(provider.id),
        providers: capable.length > 0 ? capable.join(', ') : 'none',
      }),
    );
    return true;
  }

  /**
   * Persist the flag pair when given, then answer the stored choice
   * (see the option doc: a bare re-install respects it).
   */
  private resolveShellOptIn(cwd: string): boolean {
    if (this.shell !== undefined) {
      writeConfigValue('activity.shellCapture', this.shell, { cwd, target: 'project-local' });
      // Turning the rung off must not leave the persisted level
      // pointing at it (spec provider-activity.md, Capture level rung 5).
      if (!this.shell) demoteShellCaptureLevel(cwd);
    }
    return readConfigValue<boolean>('activity.shellCapture', { cwd, default: false }) === true;
  }

  protected async run(): Promise<number> {
    const ansi = this.ansiFor('stdout');
    const okGlyph = ansi.green('✓');
    const errGlyph = ansi.red('✕');

    const providers = await composeActiveProviders();
    const provider = findActivityProvider(providers, this.provider);
    if (provider === null || provider.activity === undefined) {
      this.printUnknownProvider(errGlyph, ansi.dim.bind(ansi), providers);
      return ExitCode.Error;
    }
    if (this.shellFlagRefused(provider, providers, errGlyph)) return ExitCode.Error;
    const install = provider.activity.install;
    const ctx = defaultRuntimeContext();
    const events = renderedEvents(install, this.resolveShellOptIn(ctx.cwd));

    // Consent: both shapes write into territory skill-map does not own
    // (a vendor hooks file, or a plugin dir the runtime auto-loads).
    const consented = await this.ensureConsent(install.configPath, okGlyph, errGlyph);
    if (consented !== null) return consented;

    try {
      await installActivityBridge(ctx.cwd, provider);

      this.printer!.data(
        install.kind === 'plugin-file'
          ? tx(ACTIVITY_TEXTS.installedPlugin, {
              glyph: okGlyph,
              configPath: install.configPath,
            })
          : tx(ACTIVITY_TEXTS.installed, {
              glyph: okGlyph,
              bridgePath: ACTIVITY_BRIDGE_REL,
              configPath: install.configPath,
              events: events.length,
            }),
      );
      this.printer!.info(
        ansi.dim(
          tx(ACTIVITY_TEXTS.installedHint, { provider: sanitizeForTerminal(provider.id) }),
        ) + '\n',
      );
      return ExitCode.Ok;
    } catch (err) {
      this.printer!.error(
        tx(ACTIVITY_TEXTS.installFailed, {
          glyph: errGlyph,
          message: sanitizeForTerminal(formatErrorMessage(err)),
        }),
      );
      return ExitCode.Error;
    }
  }

  /**
   * Consent gate. Returns `null` to proceed, or the exit code to return
   * (declined / refused). `--yes` bypasses; a TTY asks y/N naming the
   * exact file; a non-TTY without `--yes` refuses with exit 2.
   */
  private async ensureConsent(
    configPath: string,
    okGlyph: string,
    errGlyph: string,
  ): Promise<number | null> {
    if (this.yes) return null;
    const stdin = this.context.stdin as NodeJS.ReadStream;
    if (stdin.isTTY !== true) {
      this.printer!.error(
        tx(ACTIVITY_TEXTS.installNeedsTty, { glyph: errGlyph, configPath }),
      );
      return ExitCode.Error;
    }
    const answer = await confirm(
      tx(ACTIVITY_TEXTS.installConfirm, { configPath }),
      { stdin, stderr: this.context.stderr },
    );
    if (answer) return null;
    this.printer!.info(tx(ACTIVITY_TEXTS.installDeclined, { glyph: okGlyph }));
    return ExitCode.Ok;
  }

  private printUnknownProvider(
    errGlyph: string,
    dim: (s: string) => string,
    providers: readonly IProvider[],
  ): void {
    const available = activityProviders(providers)
      .map((p) => p.id)
      .join(', ');
    this.printer!.error(
      tx(ACTIVITY_TEXTS.unknownProvider, {
        glyph: errGlyph,
        provider: sanitizeForTerminal(this.provider),
      }),
    );
    this.printer!.error(
      dim(tx(ACTIVITY_TEXTS.unknownProviderHint, { providers: available || '(none)' })) + '\n',
    );
  }
}

export class ActivityUninstallCommand extends SmCommand {
  static override paths = [['activity', 'uninstall']];
  static override usage = Command.Usage({
    category: 'Actions',
    description: 'Remove the live-activity bridge wiring from a provider runtime’s hook config.',
    details: `
      Exactly reverses \`sm activity install <provider>\`: hook-file
      providers get the skill-map entries removed (operator hooks stay
      untouched) and the bridge artifact deleted when no installed
      provider references it anymore; \`opencode\` gets its in-process
      plugin file deleted (a foreign file at that path is never
      touched). Idempotent: uninstalling a provider that was never
      installed is a no-op.
    `,
    examples: [
      ['Unwire Claude Code', '$0 activity uninstall claude'],
      ['Unwire OpenCode', '$0 activity uninstall opencode'],
    ],
  });

  provider = Option.String({ required: true });

  protected async run(): Promise<number> {
    const ansi = this.ansiFor('stdout');
    const okGlyph = ansi.green('✓');
    const errGlyph = ansi.red('✕');

    const providers = await composeActiveProviders();
    const provider = findActivityProvider(providers, this.provider);
    if (provider === null || provider.activity === undefined) {
      this.printer!.error(
        tx(ACTIVITY_TEXTS.unknownProvider, {
          glyph: errGlyph,
          provider: sanitizeForTerminal(this.provider),
        }),
      );
      return ExitCode.Error;
    }
    const install = provider.activity.install;
    const ctx = defaultRuntimeContext();

    try {
      // The full registry decides shared-bridge retention: the bridge
      // dir stays while any OTHER hook-file provider remains wired.
      const { removed } = uninstallActivityBridge(ctx.cwd, provider, providers);
      const pluginFile = install.kind === 'plugin-file';
      if (!removed) {
        this.printer!.info(
          tx(
            pluginFile ? ACTIVITY_TEXTS.nothingToUninstallPlugin : ACTIVITY_TEXTS.nothingToUninstall,
            { glyph: okGlyph, configPath: install.configPath },
          ),
        );
        return ExitCode.Ok;
      }

      this.printer!.data(
        pluginFile
          ? tx(ACTIVITY_TEXTS.uninstalledPlugin, {
              glyph: okGlyph,
              configPath: install.configPath,
            })
          : tx(ACTIVITY_TEXTS.uninstalled, {
              glyph: okGlyph,
              configPath: install.configPath,
              bridgePath: ACTIVITY_BRIDGE_REL,
            }),
      );
      return ExitCode.Ok;
    } catch (err) {
      this.printer!.error(
        tx(ACTIVITY_TEXTS.uninstallFailed, {
          glyph: errGlyph,
          message: sanitizeForTerminal(formatErrorMessage(err)),
        }),
      );
      return ExitCode.Error;
    }
  }
}

export class ActivityStatusCommand extends SmCommand {
  static override paths = [['activity', 'status']];
  static override usage = Command.Usage({
    category: 'Actions',
    description: 'Report the live-activity install state per provider.',
    details: `
      Read-only: for every activity-capable provider (or just the named
      one) reports \`installed\`, \`not installed\`, or \`partial\`
      (one half of the install present without the other; a re-install
      repairs both). Names each provider's hook config path. Never
      writes anything. \`--json\` emits
      \`{ ok, kind: 'activity-status', providers[], elapsedMs }\`, one
      entry per provider (\`{ id, state, configPath }\`).

      \`--verify\` adds the wiring self-test: it pushes one synthetic
      probe event through the INSTALLED bridge and asks the running
      server whether it arrived, which is the only way to catch the
      silent failures the install state cannot see (a bridge that
      crashes on every invocation, a dead server, a stale
      \`serve.json\`). The probe never lights a node and never counts as
      an execution. Any failing verdict exits 1.

      \`--verify\` also reads the MAPPER digest off the running server,
      which is the half the probe structurally cannot reach (a probe is
      answered before \`mapEvent\` runs, by contract). Each \`--json\`
      entry gains \`digest: { received, resolved, shapes }\`; the human
      report adds a warning block only when a provider received events
      and resolved none, the unambiguous live-runtime / broken-mapper
      case. The digest never changes the exit code: disclaiming is
      contractual behaviour, not a failure.
    `,
    examples: [
      ['All providers', '$0 activity status'],
      ['One provider', '$0 activity status claude'],
      ['Prove the wiring actually works', '$0 activity status --verify'],
    ],
  });

  static override exitCodes = [ExitCode.Ok, ExitCode.Issues, ExitCode.Error];

  provider = Option.String({ required: false });
  verify = Option.Boolean('--verify', false, {
    description: 'Send a probe through the installed bridge and report whether the server got it.',
  });

  protected async run(): Promise<number> {
    const ansi = this.ansiFor('stdout');
    const okGlyph = ansi.green('✓');
    const errGlyph = ansi.red('✕');

    const providers = await composeActiveProviders();
    let targets: IProvider[];
    if (this.provider !== undefined) {
      const provider = findActivityProvider(providers, this.provider);
      if (provider === null) {
        this.printer!.error(
          tx(ACTIVITY_TEXTS.unknownProvider, {
            glyph: errGlyph,
            provider: sanitizeForTerminal(this.provider),
          }),
        );
        this.printer!.error(
          ansi.dim(
            tx(ACTIVITY_TEXTS.unknownProviderHint, {
              providers: activityProviders(providers)
                .map((p) => p.id)
                .join(', ') || '(none)',
            }),
          ) + '\n',
        );
        return ExitCode.Error;
      }
      targets = [provider];
    } else {
      targets = activityProviders(providers);
    }

    const ctx = defaultRuntimeContext();
    // The self-test EXECUTES the chain, so it runs once per target and
    // its verdicts feed both output modes and the exit code.
    const verdicts = this.verify ? await this.runSelfTests(ctx.cwd, targets) : null;
    // Supplement, not a verdict: an unreachable server degrades to
    // silence here because the self-test above already reports it.
    const digests = this.verify ? await readActivityDigest(ctx.cwd) : null;

    // §Machine-readable output: `--json` puts the envelope on stdout and
    // nothing else; the human report keeps its exact per-provider lines.
    if (this.json) {
      this.printer!.data(this.jsonEnvelope(targets, ctx.cwd, verdicts, digests));
    } else {
      this.printReport(targets, ctx.cwd, verdicts, digests, okGlyph, ansi);
    }
    return this.verifyExit(verdicts);
  }

  /** The `--json` envelope; each entry gains `verify` only under `--verify`. */
  private jsonEnvelope(
    targets: readonly IProvider[],
    cwd: string,
    verdicts: Map<string, IVerifyResult> | null,
    digests: Map<string, IActivityDigest> | null,
  ): string {
    const providers = targets.map((provider) => {
      const entry: Record<string, unknown> = {
        id: provider.id,
        state: activityStateOf(cwd, provider),
        configPath: provider.activity!.install.configPath,
      };
      const result = verdicts?.get(provider.id);
      if (result !== undefined) entry['verify'] = result;
      // Machine consumers get the digest ALWAYS under `--verify`, not
      // only in the loud case the human report filters down to.
      const digest = digests?.get(provider.id);
      if (digest !== undefined) {
        entry['digest'] = {
          received: digest.received,
          resolved: digest.resolved,
          shapes: digest.shapes,
        };
      }
      return entry;
    });
    return (
      JSON.stringify({
        ok: true,
        kind: 'activity-status',
        providers,
        elapsedMs: this.elapsed!.ms(),
      }) + '\n'
    );
  }

  /** The human report: one state line per provider, plus self-test lines. */
  private printReport(
    targets: readonly IProvider[],
    cwd: string,
    verdicts: Map<string, IVerifyResult> | null,
    digests: Map<string, IActivityDigest> | null,
    okGlyph: string,
    ansi: { dim(s: string): string; red(s: string): string; yellow(s: string): string },
  ): void {
    let anyDigest = false;
    for (const provider of targets) {
      this.printer!.data(this.statusLine(provider, cwd, okGlyph, ansi));
      this.printVerifyLine(verdicts?.get(provider.id), okGlyph, ansi);
      if (this.printDigest(digests?.get(provider.id), ansi)) anyDigest = true;
    }
    if (verdicts !== null && this.anyFailed(verdicts)) {
      this.printer!.info(ansi.dim(tx(ACTIVITY_TEXTS.verifyFooter, {})));
    }
    if (anyDigest) {
      this.printer!.info(ansi.dim(tx(ACTIVITY_TEXTS.digestFooter, {})));
    }
  }

  /**
   * The self-test line under one provider, when there is one to print.
   * `not-installed` needs none: the state line right above already says
   * it, and repeating it reads as noise. The `--json` entry still
   * carries the verdict for machine consumers.
   */
  private printVerifyLine(
    result: IVerifyResult | undefined,
    okGlyph: string,
    ansi: { dim(s: string): string; red(s: string): string },
  ): void {
    if (result === undefined || result.verdict === 'not-installed') return;
    this.printer!.data(this.verifyLine(result, okGlyph, ansi));
  }

  /**
   * The mapper-digest block under one provider, or nothing. Printed
   * ONLY when the runtime demonstrably fired and the adapter resolved
   * NOTHING: that is the one reading with no innocent explanation.
   * Disclaiming alongside a non-zero `resolved` is the filter-first
   * contract working, and printing it would train the operator to
   * ignore the block. Returns whether anything was printed, so the
   * footer appears at most once.
   */
  private printDigest(
    digest: IActivityDigest | undefined,
    ansi: { dim(s: string): string; yellow(s: string): string },
  ): boolean {
    if (digest === undefined || digest.received === 0 || digest.resolved > 0) return false;
    this.printer!.data(
      tx(ACTIVITY_TEXTS.digestHeader, {
        glyph: ansi.yellow('!'),
        received: String(digest.received),
      }),
    );
    for (const shape of digest.shapes) {
      this.printDigestShape(shape, ansi);
    }
    return true;
  }

  /**
   * One disclaimed shape: the count and outcome, the vendor
   * discriminators the payload named, and the key names the adapter was
   * handed. All content-free by the digest's own contract; sanitized
   * anyway because the two labels are vendor strings off the wire.
   */
  private printDigestShape(shape: IDigestShape, ansi: { dim(s: string): string }): void {
    const parts: string[] = [];
    if (shape.hook !== undefined) parts.push(sanitizeForTerminal(shape.hook));
    if (shape.tool !== undefined) parts.push(`tool=${sanitizeForTerminal(shape.tool)}`);
    this.printer!.data(
      tx(ACTIVITY_TEXTS.digestShape, {
        count: String(shape.count),
        outcome: sanitizeForTerminal(shape.outcome),
        label: parts.length > 0 ? parts.join('  ') : '(no discriminator)',
      }),
    );
    if (shape.keys.length === 0) return;
    this.printer!.data(
      tx(ACTIVITY_TEXTS.digestKeys, {
        keys: ansi.dim(shape.keys.map((k) => sanitizeForTerminal(k)).join(', ')),
      }),
    );
  }

  /** Run the self-test for every target, keyed by provider id. */
  private async runSelfTests(
    cwd: string,
    targets: readonly IProvider[],
  ): Promise<Map<string, IVerifyResult>> {
    const results = new Map<string, IVerifyResult>();
    for (const provider of targets) {
      results.set(provider.id, await verifyActivityWiring(cwd, provider));
    }
    return results;
  }

  private anyFailed(verdicts: Map<string, IVerifyResult>): boolean {
    return [...verdicts.values()].some((r) => isFailingVerdict(r.verdict));
  }

  /** Exit 1 when any self-test failed; a skip is not a failure. */
  private verifyExit(verdicts: Map<string, IVerifyResult> | null): number {
    if (verdicts === null) return ExitCode.Ok;
    return this.anyFailed(verdicts) ? ExitCode.Issues : ExitCode.Ok;
  }

  /** One indented self-test line under the provider's state line. */
  private verifyLine(
    result: IVerifyResult,
    okGlyph: string,
    ansi: { dim(s: string): string; red(s: string): string },
  ): string {
    if (result.verdict === 'ok') {
      return tx(ACTIVITY_TEXTS.verifyOk, { glyph: okGlyph });
    }
    const detail = sanitizeForTerminal(result.detail ?? '');
    if (!isFailingVerdict(result.verdict)) {
      return tx(ACTIVITY_TEXTS.verifySkipped, {
        glyph: ansi.dim('·'),
        detail: detail || result.verdict,
      });
    }
    return tx(ACTIVITY_TEXTS.verifyFailed, {
      glyph: ansi.red('✕'),
      verdict: result.verdict,
      detail,
    });
  }

  /** One report line: installed / not installed / partial (with the repair hint). */
  private statusLine(
    provider: IProvider,
    cwd: string,
    okGlyph: string,
    ansi: { dim(s: string): string; yellow(s: string): string },
  ): string {
    const vars = { provider: provider.id, configPath: provider.activity!.install.configPath };
    const state = activityStateOf(cwd, provider);
    if (state === 'installed') {
      return tx(ACTIVITY_TEXTS.statusInstalled, { glyph: okGlyph, ...vars });
    }
    if (state === 'partial') {
      return tx(ACTIVITY_TEXTS.statusPartialBridgeMissing, { glyph: ansi.yellow('!'), ...vars });
    }
    return tx(ACTIVITY_TEXTS.statusNotInstalled, { glyph: ansi.dim('·'), ...vars });
  }
}

export const ACTIVITY_COMMANDS = [
  ActivityInstallCommand,
  ActivityUninstallCommand,
  ActivityStatusCommand,
];
