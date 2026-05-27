/**
 * `<sm-vendor-frontmatter>`, three typographically separated sub-sections
 * for the per-kind vendor frontmatter the inspector embeds. Replaces the
 * collapsed "Provider-specific" wrapper in favour of always-visible
 * sections that hide on their own when empty:
 *
 *   - `Behavior` (agent only): model, effort, permission mode, max
 *     turns, memory, background (only when true), isolation.
 *   - `Capabilities` (agent + skill + command): tools / allowed-tools,
 *     skills, disallowed-tools, MCP servers, hooks; skill / command
 *     base also includes when_to_use, argument-hint, arguments, model,
 *     effort, context, agent, shell, paths, disable-model-invocation,
 *     user-invocable.
 *   - `Initial prompt` (agent only): the prompt callout, rendered as a
 *     quote block (no longer collapsible).
 *
 * `name`, `description`, and `color` are intentionally NOT rendered
 * here. The inspector header already shows name + description; the card
 * border accent + inspector title shading consume `color`.
 *
 * Notes have no vendor surface so the renderer hides entirely. When
 * every section is empty the whole component disappears so the
 * inspector does not paint chrome around nothing.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { VENDOR_FRONTMATTER_TEXTS } from '../../../i18n/vendor-frontmatter.texts';
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
   * Optional set of skill paths in the local store. Used to render
   * `skills[]` chips as clickable links when the target is in scope.
   * Absent → all skill chips render as plain mono chips.
   */
  readonly knownPaths = input<ReadonlySet<string> | null>(null);

  /** Click on a skill chip whose target is in scope. */
  readonly onSkillClick = input<((path: string) => void) | null>(null);

  protected readonly texts = VENDOR_FRONTMATTER_TEXTS;

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

  /** Background renders ONLY when true (false adds no signal). */
  protected readonly background = computed<boolean>(() => this.fm()['background'] === true);

  protected readonly effort = computed<string | null>(() =>
    stringOrNull(this.fm()['effort']),
  );

  protected readonly isolation = computed<string | null>(() =>
    stringOrNull(this.fm()['isolation']),
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
      this.background() ||
      this.effort() !== null ||
      this.isolation() !== null
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

  /** Hide the renderer entirely when every section is empty. */
  protected readonly hasAnyContent = computed<boolean>(
    () =>
      this.hasVendorSurface() &&
      (this.hasBehavior() || this.hasCapabilities() || this.hasInitialPrompt()),
  );

  protected onSkillChipClick(path: string): void {
    const handler = this.onSkillClick();
    if (handler) handler(path);
  }

  protected isSkillKnown(path: string): boolean {
    const known = this.knownPaths();
    if (!known) return false;
    return known.has(path);
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
