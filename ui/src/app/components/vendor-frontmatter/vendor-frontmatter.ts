/**
 * `<sm-vendor-frontmatter>` — single collapsed "Provider-specific"
 * section for the per-kind vendor frontmatter the inspector embeds.
 * Catalog curation refinement (2026-05-07) consolidated the previous
 * T1–T4 tiering into one section, ordered for agents as:
 *
 *   model · tools · skills · disallowedTools · permissionMode ·
 *   maxTurns · effort · memory · background (only when true) ·
 *   isolation · initialPrompt (collapsed quote-block) ·
 *   mcpServers (one row per server) · hooks (one row per event).
 *
 * `name`, `description`, and `color` are intentionally NOT rendered
 * here. The inspector header already shows name + description; the
 * card border accent + inspector title shading consume `color`.
 *
 * For `skill` / `command` kinds the section follows the same pattern
 * over the skill-base schema. Notes have no vendor surface so the
 * section hides entirely.
 *
 * The header reads `Provider-specific (N fields)` and the section is
 * collapsed by default. When zero populated fields are present (or
 * the kind has no vendor surface) the whole renderer hides itself so
 * the inspector doesn't paint an empty card.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { ChipModule } from 'primeng/chip';
import { TooltipModule } from 'primeng/tooltip';

import { VENDOR_FRONTMATTER_TEXTS } from '../../../i18n/vendor-frontmatter.texts';
import type { TFrontmatter, TNodeKind } from '../../../models/node';

/**
 * MCP server row shape — we render `name + command` per the brief.
 * The Anthropic schema documents `mcpServers` as a free-form array of
 * objects, so we read defensively.
 */
interface IMcpServerRow {
  name: string;
  command: string | null;
}

/**
 * Hooks event shape — Anthropic's `hooks:` block is `{ <eventName>:
 * <opaque value> }`. We render a list of event names with the raw
 * key list under each one (when the value is itself an object).
 */
interface IHookRow {
  event: string;
  keys: readonly string[];
}

@Component({
  selector: 'sm-vendor-frontmatter',
  imports: [ChipModule, TooltipModule],
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

  /** True when this kind has any vendor-specific surface to render. */
  protected readonly hasVendorSurface = computed<boolean>(() => {
    const k = this.kind();
    // Skill, command, and agent all carry vendor-specific frontmatter
    // (per the Anthropic schemas). Notes do not.
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

  /** initialPrompt quote-block expand state — collapsed by default. */
  protected readonly initialPromptExpanded = signal<boolean>(false);

  protected readonly permissionMode = computed<string | null>(() =>
    stringOrNull(this.fm()['permissionMode']),
  );

  protected readonly maxTurns = computed<number | null>(() =>
    numberOrNull(this.fm()['maxTurns']),
  );

  protected readonly memory = computed<string | null>(() =>
    stringOrNull(this.fm()['memory']),
  );

  /** Background renders ONLY when true (the false case adds no signal). */
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
      .map((row, idx) => ({
        name:
          typeof row['name'] === 'string' && row['name'].length > 0
            ? row['name']
            : `mcpServer[${idx}]`,
        command: typeof row['command'] === 'string' ? row['command'] : null,
      }));
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

  // ---- field count + section state ----

  /**
   * Count of populated fields driving the `(N fields)` header suffix.
   * Each row in the section counts as 1 — arrays / objects collapse
   * to one row even when the underlying schema declares many entries.
   */
  protected readonly populatedFieldCount = computed<number>(() => {
    if (this.isAgent()) {
      let n = 0;
      if (this.model() !== null) n++;
      if (this.tools().length) n++;
      if (this.skills().length) n++;
      if (this.disallowedTools().length) n++;
      if (this.permissionMode() !== null) n++;
      if (this.maxTurns() !== null) n++;
      if (this.effort() !== null) n++;
      if (this.memory() !== null) n++;
      if (this.background()) n++;
      if (this.isolation() !== null) n++;
      if (this.initialPrompt() !== null) n++;
      if (this.mcpServers().length) n++;
      if (this.hooks().length) n++;
      return n;
    }
    if (this.isSkillOrCommand()) {
      const sb = this.skillBase();
      let n = 0;
      if (sb.when_to_use !== null) n++;
      if (sb.argumentHint !== null) n++;
      if (sb.arguments.length) n++;
      if (sb.allowedTools.length) n++;
      if (sb.model !== null) n++;
      if (sb.effort !== null) n++;
      if (sb.context !== null) n++;
      if (sb.agent !== null) n++;
      if (sb.shell !== null) n++;
      if (sb.paths.length) n++;
      if (sb.disableModelInvocation) n++;
      if (sb.userInvocable !== null) n++;
      return n;
    }
    return 0;
  });

  /** Hide the renderer entirely when there's nothing to show. */
  protected readonly hasAnyContent = computed<boolean>(
    () => this.hasVendorSurface() && this.populatedFieldCount() > 0,
  );

  /** Provider-specific section state — collapsed by default. */
  protected readonly sectionExpanded = signal<boolean>(false);

  protected toggleSection(): void {
    this.sectionExpanded.update((v) => !v);
  }

  protected toggleInitialPrompt(): void {
    this.initialPromptExpanded.update((v) => !v);
  }

  protected onSkillChipClick(path: string): void {
    const handler = this.onSkillClick();
    if (handler) handler(path);
  }

  protected isSkillKnown(path: string): boolean {
    const known = this.knownPaths();
    if (!known) return false;
    return known.has(path);
  }

  /** Cast for templates — vendor schemas are open + plugin-extensible. */
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
