/**
 * `<sm-vendor-frontmatter>`, a single `Definition` section for the
 * per-kind vendor frontmatter the inspector embeds. One rail, one title:
 * every field flows in a single definition list so the labels share one
 * `max-content` column, with the initial prompt closing the section as a
 * quote block.
 *
 * Field order inside the list (the Behavior / Capabilities grouping is a
 * skill-map presentation choice, not vendor JSON structure, the
 * frontmatter is flat, so it lists as one run):
 *
 *   - Agent fields, in render order: model, effort, tools,
 *     disallowed-tools, permission mode, color, skills, max turns,
 *     memory, background (shown even when false), isolation, MCP
 *     servers, hooks. (tools / disallowed-tools / permission mode are
 *     kept adjacent so the capability gate reads top-down.)
 *   - Skill / command base instead: when_to_use, argument-hint,
 *     arguments, allowed-tools, disallowed-tools, model, effort,
 *     context, agent, shell, paths, disable-model-invocation,
 *     user-invocable.
 *   - Any remaining frontmatter key (unknown / plugin / future, carried
 *     by the schema's `additionalProperties: true`) via the generic
 *     `extraFields` catch-all, so nothing in the frontmatter stays
 *     hidden.
 *   - `Initial prompt` (agent only): a sub-labelled quote block at the
 *     foot of the same section.
 *
 * Only `name` and `description` are NOT rendered here, the inspector
 * header already shows them. `color` IS rendered (with a swatch) and
 * also still drives the header accent rail + title shading.
 *
 * Notes have no vendor surface so the renderer hides entirely. When
 * every field is empty the whole component disappears so the inspector
 * does not paint chrome around nothing.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { VENDOR_FRONTMATTER_TEXTS } from '../../../i18n/vendor-frontmatter.texts';
import { cssColorOrNull } from '../../../services/css-guard';
import { MarkdownRenderer } from '../../../services/markdown-renderer';
import { setupBlockMarkdown } from '../../../services/markdown-inline-signal';
import type { TFrontmatter, TNodeKind } from '../../../models/node';

interface IMcpServerRow {
  name: string;
  command: string | null;
  argsCount: number;
}

interface IHookRow {
  event: string;
  keys: readonly string[];
}

/**
 * Frontmatter keys the Definition section renders with an explicit row
 * (curated label + special rendering). Any key NOT in the kind's set
 * flows through the generic `extraFields` catch-all so unknown / plugin
 * / future keys (schema `additionalProperties: true`) never disappear
 * silently. The sets also include the keys consumed elsewhere so the
 * catch-all does not re-dump them: `name` / `description` (inspector
 * header) and `metadata` (the legacy pre-9.5 block whose `version` /
 * `stability` / `supersededBy` already surface via the header chip,
 * stability tag, and derived signals, see `models/node-derived.ts`).
 */
const RENDERED_AGENT_KEYS: ReadonlySet<string> = new Set([
  'name', 'description', 'metadata', 'model', 'effort', 'permissionMode',
  'maxTurns', 'memory', 'background', 'isolation', 'color', 'tools',
  'disallowedTools', 'skills', 'mcpServers', 'hooks', 'initialPrompt',
]);
const RENDERED_SKILL_KEYS: ReadonlySet<string> = new Set([
  'name', 'description', 'metadata', 'when_to_use', 'argument-hint',
  'arguments', 'disable-model-invocation', 'user-invocable',
  'allowed-tools', 'disallowed-tools', 'model', 'effort', 'context',
  'agent', 'hooks', 'paths', 'shell',
]);

@Component({
  selector: 'sm-vendor-frontmatter',
  imports: [TooltipModule],
  templateUrl: './vendor-frontmatter.html',
  styleUrl: './vendor-frontmatter.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorFrontmatter {
  readonly frontmatter = input.required<TFrontmatter>();
  readonly kind = input.required<TNodeKind>();
  readonly provider = input<string | undefined>(undefined);

  /**
   * Map of skill identifier (the skill node's `frontmatter.name`) to its
   * node path, scoped to the current scan. An agent's `skills: [...]`
   * lists skills by identifier; a resolvable one renders as a clickable
   * link to the skill node, an unresolvable one renders dimmed with no
   * link. Built by the host (inspector) from the loaded nodes.
   */
  readonly skillPathByName = input<ReadonlyMap<string, string> | null>(null);

  /** Navigate to a resolved skill node path (host decides how). */
  readonly onSkillClick = input<((path: string) => void) | null>(null);

  /**
   * Collapse state for the Definition section. Owned by the host
   * (inspector) so it can persist across nodes in localStorage. Defaults
   * to expanded.
   */
  readonly expanded = input<boolean>(true);
  /** Emitted when the user clicks the Definition section header. */
  readonly toggle = output<void>();

  protected readonly texts = VENDOR_FRONTMATTER_TEXTS;
  private readonly markdown = inject(MarkdownRenderer);

  protected readonly hasVendorSurface = computed<boolean>(() => {
    const k = this.kind();
    return k === 'agent' || k === 'skill' || k === 'command';
  });

  protected readonly isAgent = computed<boolean>(() => this.kind() === 'agent');
  protected readonly isSkillOrCommand = computed<boolean>(() => {
    const k = this.kind();
    return k === 'skill' || k === 'command';
  });

  // ---- agent vendor fields ----

  protected readonly tools = computed<readonly string[]>(() =>
    stringArray(this.fm()['tools']),
  );

  protected readonly model = computed<string | null>(() =>
    stringOrNull(this.fm()['model']),
  );

  protected readonly skills = computed<readonly string[]>(() =>
    stringArray(this.fm()['skills']),
  );

  protected readonly disallowedTools = computed<readonly string[]>(() =>
    stringArray(this.fm()['disallowedTools']),
  );

  protected readonly initialPrompt = computed<string | null>(() =>
    stringOrNull(this.fm()['initialPrompt']),
  );

  protected readonly permissionMode = computed<string | null>(() =>
    stringOrNull(this.fm()['permissionMode']),
  );

  protected readonly maxTurns = computed<number | null>(() =>
    numberOrNull(this.fm()['maxTurns']),
  );

  protected readonly memory = computed<string | null>(() =>
    stringOrNull(this.fm()['memory']),
  );

  /** Background: the actual boolean (false included) when the key is present. */
  protected readonly background = computed<boolean | null>(() =>
    typeof this.fm()['background'] === 'boolean' ? (this.fm()['background'] as boolean) : null,
  );

  protected readonly effort = computed<string | null>(() =>
    stringOrNull(this.fm()['effort']),
  );

  protected readonly isolation = computed<string | null>(() =>
    stringOrNull(this.fm()['isolation']),
  );

  // Allowlist-guarded: `color` is author-controlled and binds into the
  // swatch's `[style.background]`, so reject anything but a hex / named
  // colour to block `url(...)` beacons (see `css-guard.ts`).
  protected readonly color = computed<string | null>(() =>
    cssColorOrNull(this.fm()['color']),
  );

  protected readonly mcpServers = computed<readonly IMcpServerRow[]>(() => {
    const raw = this.fm()['mcpServers'];
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
      .map((row, idx) => {
        const args = row['args'];
        const argsCount = Array.isArray(args) ? args.length : 0;
        return {
          name:
            typeof row['name'] === 'string' && row['name'].length > 0
              ? row['name']
              : `mcpServer[${idx}]`,
          command: typeof row['command'] === 'string' ? row['command'] : null,
          argsCount,
        };
      });
  });

  protected readonly hooks = computed<readonly IHookRow[]>(() => {
    const raw = this.fm()['hooks'];
    if (typeof raw !== 'object' || raw === null) return [];
    const out: IHookRow[] = [];
    for (const [event, value] of Object.entries(raw as Record<string, unknown>)) {
      const keys: string[] =
        typeof value === 'object' && value !== null
          ? Object.keys(value as Record<string, unknown>)
          : [];
      out.push({ event, keys });
    }
    return out;
  });

  // ---- skill / command base ----

  protected readonly skillBase = computed<{
    when_to_use: string | null;
    argumentHint: string | null;
    arguments: readonly string[];
    disableModelInvocation: boolean;
    userInvocable: boolean | null;
    allowedTools: readonly string[];
    disallowedTools: readonly string[];
    model: string | null;
    effort: string | null;
    context: string | null;
    agent: string | null;
    paths: readonly string[];
    shell: string | null;
  }>(() => {
    const fm = this.fm();
    return {
      when_to_use: stringOrNull(fm['when_to_use']),
      argumentHint: stringOrNull(fm['argument-hint']),
      arguments: oneOrManyStrings(fm['arguments']),
      disableModelInvocation: fm['disable-model-invocation'] === true,
      userInvocable: typeof fm['user-invocable'] === 'boolean' ? (fm['user-invocable'] as boolean) : null,
      allowedTools: oneOrManyStrings(fm['allowed-tools']),
      disallowedTools: oneOrManyStrings(fm['disallowed-tools']),
      model: stringOrNull(fm['model']),
      effort: stringOrNull(fm['effort']),
      context: stringOrNull(fm['context']),
      agent: stringOrNull(fm['agent']),
      paths: oneOrManyStrings(fm['paths']),
      shell: stringOrNull(fm['shell']),
    };
  });

  // ---- section visibility gates ----

  protected readonly hasBehavior = computed<boolean>(() => {
    if (!this.isAgent()) return false;
    return (
      this.model() !== null ||
      this.permissionMode() !== null ||
      this.maxTurns() !== null ||
      this.memory() !== null ||
      this.background() !== null ||
      this.effort() !== null ||
      this.isolation() !== null ||
      this.color() !== null
    );
  });

  protected readonly hasCapabilities = computed<boolean>(() => {
    if (this.isAgent()) {
      return (
        this.tools().length > 0 ||
        this.disallowedTools().length > 0 ||
        this.skills().length > 0 ||
        this.mcpServers().length > 0 ||
        this.hooks().length > 0
      );
    }
    if (this.isSkillOrCommand()) {
      const sb = this.skillBase();
      return (
        sb.when_to_use !== null ||
        sb.argumentHint !== null ||
        sb.arguments.length > 0 ||
        sb.allowedTools.length > 0 ||
        sb.disallowedTools.length > 0 ||
        sb.model !== null ||
        sb.effort !== null ||
        sb.context !== null ||
        sb.agent !== null ||
        sb.shell !== null ||
        sb.paths.length > 0 ||
        sb.disableModelInvocation ||
        sb.userInvocable !== null
      );
    }
    return false;
  });

  protected readonly hasInitialPrompt = computed<boolean>(() => {
    return this.isAgent() && this.initialPrompt() !== null;
  });

  /** Initial prompt rendered as block markdown for the quote callout. */
  protected readonly initialPromptHtml = setupBlockMarkdown(
    () => this.initialPrompt() ?? '',
    this.markdown,
  );

  /**
   * Generic catch-all: every frontmatter key not rendered by an explicit
   * row above (and not `name` / `description`, shown in the header).
   * Keeps the Definition section complete, unknown / plugin / future
   * keys show as a labelled code chip instead of silently disappearing.
   * Objects / arrays are JSON-stringified; primitives shown as-is.
   */
  protected readonly extraFields = computed<readonly { key: string; value: string }[]>(() => {
    const handled = this.isAgent()
      ? RENDERED_AGENT_KEYS
      : this.isSkillOrCommand()
        ? RENDERED_SKILL_KEYS
        : null;
    if (!handled) return [];
    const fm = this.fm();
    const out: { key: string; value: string }[] = [];
    for (const key of Object.keys(fm)) {
      if (handled.has(key)) continue;
      const v = fm[key];
      if (v === null || v === undefined) continue;
      const value =
        typeof v === 'string'
          ? v
          : typeof v === 'number' || typeof v === 'boolean'
            ? String(v)
            : JSON.stringify(v);
      out.push({ key, value });
    }
    return out;
  });

  /** Hide the renderer entirely when every section is empty. */
  protected readonly hasAnyContent = computed<boolean>(
    () =>
      this.hasVendorSurface() &&
      (this.hasBehavior() ||
        this.hasCapabilities() ||
        this.hasInitialPrompt() ||
        this.extraFields().length > 0),
  );

  /** Resolve a skill identifier to its node path, or null if unknown. */
  protected skillPath(name: string): string | null {
    return this.skillPathByName()?.get(name) ?? null;
  }

  protected openSkill(path: string): void {
    const handler = this.onSkillClick();
    if (handler) handler(path);
  }

  /** Cast for templates, vendor schemas are open + plugin-extensible. */
  private fm(): Record<string, unknown> {
    return this.frontmatter() as unknown as Record<string, unknown>;
  }
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function stringArray(v: unknown): readonly string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

/**
 * The Anthropic skill-base schema accepts both `string` and `string[]`
 * for `arguments`, `allowed-tools`, and `paths`. Normalize to an array.
 */
function oneOrManyStrings(v: unknown): readonly string[] {
  if (typeof v === 'string') return v.length > 0 ? [v] : [];
  if (Array.isArray(v)) return stringArray(v);
  return [];
}
