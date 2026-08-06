/**
 * `<sm-settings-project-mcp>`, the MCP registration row of the
 * Settings > Project section. Mounted by the preferences child right
 * under the MCP Server toggle (row order, see that template): the toggle
 * serves the endpoint, this row hands the operator what their agent
 * needs to reach it (`spec/cli-contract.md` §HTTP API,
 * `/api/mcp/status`).
 *
 * Unlike its install siblings (hook, skill) this row performs no
 * mutation and needs no consent gate: the target is the operator's OWN
 * agent config, which skill-map neither owns nor writes. The only action
 * is Copy, and the row states the two things skill-map cannot do for the
 * operator either, paste the snippet where it belongs (config-flavour
 * lenses) and restart the agent so it picks the server up at boot.
 *
 * The payload is NOT built here: the recipe is DATA, declared by the
 * Provider itself (`mcpRegister`) and delivered in the envelope
 * `providerRegistry`; the shared renderer `mcpRegisterSnippet()` in
 * `i18n/quick-start.texts.ts` joins it with the live endpoint reported by
 * `GET /api/mcp/status`. One renderer, two surfaces (the Quick Start
 * modal's MCP row uses the same one), and a lens whose registration
 * flavour changes is edited in its own manifest.
 *
 * Lens coupling mirrors the skill sibling: the chassis feeds `lensId`
 * from the lens child's envelope (threaded through the preferences
 * child, which only forwards it), so a section open or a confirmed lens
 * switch re-resolves both the snippet and the restart hint's agent name.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ButtonModule } from 'primeng/button';

import { SETTINGS_TEXTS } from '../../../i18n/settings.texts';
import { mcpRegisterSnippet, type IMcpRegisterSnippet } from '../../../i18n/quick-start.texts';
import { DATA_SOURCE } from '../../../services/data-source/data-source.port';
import { ProviderRegistryService } from '../../../services/provider-registry';
import { UsageTrackerService } from '../../services/usage-tracker';

/** How long the Copy button stays in its confirmed state. */
const COPIED_FEEDBACK_MS = 2000;

@Component({
  selector: 'sm-settings-project-mcp',
  imports: [ButtonModule],
  templateUrl: './settings-project-mcp.html',
  styleUrl: './settings-project-rows.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsProjectMcp {
  private readonly document = inject(DOCUMENT);
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly registry = inject(ProviderRegistryService);
  private readonly usageTracker = inject(UsageTrackerService);

  readonly visible = input.required<boolean>();
  /** Active lens id, fed by the chassis (`null` until it loads, `''` for "none"). */
  readonly lensId = input.required<string | null>();

  protected readonly texts = SETTINGS_TEXTS;

  /**
   * Authoritative MCP endpoint from `GET /api/mcp/status`. The page
   * origin is NOT a substitute: under the dev setup the SPA is served by
   * a proxy whose port is not the one `/mcp` listens on, so the origin
   * only stands in while the probe has not answered.
   */
  private readonly mcpUrl = signal<string | null>(null);
  /** Whether the server currently exposes `/mcp` at all (the boot-time opt-in). */
  private readonly mcpEnabled = signal<boolean | null>(null);
  protected readonly copied = signal(false);
  /**
   * Sticky companion of `copied`: the restart line only appears once the
   * operator has actually taken the snippet, but it must NOT vanish with
   * the button's 2-second confirmation. It is an instruction for the
   * step that follows the paste, so it stays for the rest of the
   * session once earned.
   */
  protected readonly copiedOnce = signal(false);

  private readonly resolvedUrl = computed<string>(
    () => this.mcpUrl() ?? `${this.document.location.origin}/mcp`,
  );

  /** What Copy hands over for the active lens, joined with the live endpoint. */
  protected readonly snippet = computed<IMcpRegisterSnippet>(() => {
    const lens = this.lensId();
    const register = lens ? this.registry.lookup(lens)?.mcpRegister : undefined;
    return mcpRegisterSnippet(register, this.resolvedUrl());
  });

  protected readonly copyLabel = computed<string>(() => {
    const t = this.texts.project.mcpRegister;
    if (this.copied()) return t.copiedLabel;
    return this.snippet().kind === 'config' ? t.copyConfigLabel : t.copyCommandLabel;
  });

  /**
   * The restart line names the ACTIVE lens through the registry, so the
   * operator reads their own agent's name and not skill-map's. An id the
   * registry does not carry falls back to the generic wording rather
   * than printing a raw id.
   */
  protected readonly restartHint = computed<string>(() => {
    const id = this.lensId();
    const label = id ? (this.registry.lookup(id)?.label ?? null) : null;
    return this.texts.project.agentRestartHint(label);
  });

  /**
   * Hint line, one slot with a priority order: the copy confirmation
   * wins while it shows, then the paste target for the config-flavour
   * lenses (a document is useless without knowing which file it goes
   * into), then nothing.
   */
  protected readonly hint = computed<string | null>(() => {
    const t = this.texts.project.mcpRegister;
    if (this.copied()) return t.copiedHint;
    const snippet = this.snippet();
    return snippet.kind === 'config' && snippet.target !== undefined
      ? t.pasteHint(snippet.target)
      : null;
  });

  /**
   * The endpoint answers only while the MCP server is mounted, so an
   * operator who has not opted in yet gets pointed at the toggle above
   * instead of copying a snippet that would fail to connect. `null` (probe not
   * answered / failed) stays quiet rather than accusing.
   */
  protected readonly serverOff = computed<boolean>(() => this.mcpEnabled() === false);

  constructor() {
    // Same lifecycle as the install siblings: probe on section open and
    // on every lens change while open.
    effect(() => {
      const id = this.lensId();
      if (!this.visible() || id === null) return;
      void this.refreshMcpStatus();
    });
  }

  protected async onCopyClick(): Promise<void> {
    // Usage analytics (opt-in, default OFF): the copy GESTURE counts,
    // stamped with the surface since Quick Start exposes the same copy.
    this.usageTracker.trackFeature('mcp-copy', undefined, 'settings');
    try {
      await navigator.clipboard.writeText(this.snippet().payload);
      this.copied.set(true);
      this.copiedOnce.set(true);
      setTimeout(() => this.copied.set(false), COPIED_FEEDBACK_MS);
    } catch {
      // Clipboard blocked (insecure context / denied). Non-actionable, no-op.
    }
  }

  private async refreshMcpStatus(): Promise<void> {
    try {
      const status = await this.dataSource.mcpStatus();
      this.mcpUrl.set(status.url);
      this.mcpEnabled.set(status.enabled);
    } catch {
      // The row still hands over the origin-based fallback endpoint; a
      // failed probe is not worth an error message on a copy affordance.
      this.mcpEnabled.set(null);
    }
  }
}
