/**
 * Pure UI usage-collector helpers (mirror of the CLI
 * `cli/telemetry/usage-collector.ts`). They shape plugin ids before they leave
 * the browser: a built-in id passes through, anything third-party collapses to
 * `external_plugin`, so a private plugin id never reaches PostHog. No SDK
 * dependency, so it is trivially unit-testable.
 */

/**
 * The closed set of built-in plugin ids. MUST stay in lockstep with the CLI
 * allow-list in `src/cli/telemetry/usage-collector.ts` (the authoritative
 * copy, asserted against the shipped built-ins by its spec); a built-in
 * missing here misreports real usage as `external_plugin`.
 */
const BUILT_IN_PLUGIN_IDS: ReadonlySet<string> = new Set([
  'claude',
  'antigravity',
  'codex',
  'opencode',
  'agent-skills',
  'core',
  'github',
]);

/** The literal that replaces every non-built-in plugin id. */
const EXTERNAL_PLUGIN_PLACEHOLDER = 'external_plugin';

/**
 * The closed set of node-kind names the built-in Providers ship (the
 * `kinds:` blocks under each `src/plugins/<plugin>/providers/` manifest).
 * The kind registry is plugin-extensible, so a kind outside this set was
 * declared by an operator-installed plugin and MUST NOT leave the browser
 * by name.
 */
const BUILT_IN_KIND_NAMES: ReadonlySet<string> = new Set([
  'agent',
  'command',
  'markdown',
  'mcp',
  'skill',
  'workflow',
]);

/**
 * Map a node-kind name to the value that may leave the machine: unchanged
 * when a built-in Provider ships it, `external_plugin` otherwise.
 */
export function qualifyKindForUsage(kind: string): string {
  return BUILT_IN_KIND_NAMES.has(kind) ? kind : EXTERNAL_PLUGIN_PLACEHOLDER;
}

/**
 * Map a plugin id (a bare plugin id like `claude`, or a qualified extension id
 * like `core/markdown-link`) to the value that may leave the machine: the id
 * unchanged when its plugin is built-in, the literal `external_plugin`
 * otherwise.
 */
export function qualifyPluginForUsage(id: string): string {
  const slash = id.indexOf('/');
  const pluginId = slash > 0 ? id.slice(0, slash) : id;
  return BUILT_IN_PLUGIN_IDS.has(pluginId) ? id : EXTERNAL_PLUGIN_PLACEHOLDER;
}

/**
 * Build the deduped, sorted id set for a `plugin.apply` property, every id
 * mapped through {@link qualifyPluginForUsage}.
 */
export function buildPluginUsageSet(ids: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const id of ids) out.add(qualifyPluginForUsage(id));
  return [...out].sort();
}

/**
 * Collapse an id-like value that MAY be plugin-qualified: a value with a
 * `/` is treated as `<pluginId>/<id>` and goes through
 * {@link qualifyPluginForUsage}; a slash-free value (kernel vocabulary,
 * our own flow literals) passes verbatim.
 */
export function qualifyMaybePluginValue(value: string): string {
  return value.includes('/') ? qualifyPluginForUsage(value) : value;
}

/**
 * The value a finding TYPE may leave as: kernel-lane types (reserved
 * slugs) pass verbatim, an extension-lane type passes only when its
 * finder plugin is built-in; a third-party finder's vocabulary collapses
 * with its plugin.
 */
export function qualifyFindingTypeForUsage(
  type: string,
  extensionId: string,
  origin: 'extension' | 'kernel',
): string {
  if (origin === 'kernel') return type;
  return qualifyPluginForUsage(extensionId) === EXTERNAL_PLUGIN_PLACEHOLDER
    ? EXTERNAL_PLUGIN_PLACEHOLDER
    : type;
}

/** The slice of a bulk-PATCH change entry the usage event cares about. */
export interface IPluginToggleChange {
  id: string;
  enabled?: boolean;
}

/**
 * Build the `plugin.apply` event properties from a committed bulk PATCH:
 * ids toggled on ride `enabled`, ids toggled off ride `disabled`, both
 * through {@link buildPluginUsageSet}, and `$screen_name` mirrors the set
 * with the state suffixed (`<id>:true|false`) so PostHog's URL / Screen
 * column reads the whole apply. Entries with no `enabled` delta
 * (settings-only edits) are excluded; a batch with no toggle at all
 * returns `null`, meaning nothing to emit.
 */
export function buildPluginApplyProperties(
  changes: ReadonlyArray<IPluginToggleChange>,
): Record<string, unknown> | null {
  const enabled = buildPluginUsageSet(
    changes.filter((c) => c.enabled === true).map((c) => c.id),
  );
  const disabled = buildPluginUsageSet(
    changes.filter((c) => c.enabled === false).map((c) => c.id),
  );
  if (enabled.length === 0 && disabled.length === 0) return null;
  return {
    enabled,
    disabled,
    $screen_name: [
      ...enabled.map((id) => `${id}:true`),
      ...disabled.map((id) => `${id}:false`),
    ].join(' '),
  };
}

/**
 * Pure event-property builders for the tracker's emit methods
 * (`UsageTrackerService` stays a one-line shell over each). Extracted here
 * because the Angular unit-test system blocks `vi.mock` on relative
 * imports, so the `$screen_name` / property composition is tested through
 * these instead of through the SDK boundary. Params are plain strings; the
 * closed unions live on the tracker's public API.
 */

/** `ui.feature.<surface>`: `<surface>[:<value>][@<source>]`. */
export function buildFeatureEventProperties(
  surface: string,
  value?: boolean | string,
  source?: string,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  let screen = surface;
  if (value !== undefined) {
    props['value'] = value;
    screen = `${screen}:${value}`;
  }
  if (source !== undefined) {
    props['source'] = source;
    screen = `${screen}@${source}`;
  }
  props['$screen_name'] = screen;
  return props;
}

/** `ui.filter`: `group` + collapsed `value` (kind only), screen `group[:value]`. */
export function buildFilterEventProperties(
  group: string,
  value?: string,
): Record<string, unknown> {
  const props: Record<string, unknown> = { group };
  let screen = group;
  if (value !== undefined) {
    const safe = group === 'kind' ? qualifyKindForUsage(value) : value;
    props['value'] = safe;
    screen = `${group}:${safe}`;
  }
  props['$screen_name'] = screen;
  return props;
}

/** `ui.feature.lens-select`: the collapsed lens rides BOTH as `value` and `lens`. */
export function buildLensSelectEventProperties(
  lens: string,
  source: string,
): Record<string, unknown> {
  const collapsed = qualifyPluginForUsage(lens);
  return {
    value: collapsed,
    lens: collapsed,
    source,
    $screen_name: `lens-select:${collapsed}@${source}`,
  };
}

/** `ui.feature.ai-action`: collapsed extension id + `auto_fix`, `:autofix` suffix. */
export function buildAiActionEventProperties(
  extensionId: string,
  autoFix: boolean,
): Record<string, unknown> {
  const collapsed = qualifyPluginForUsage(extensionId);
  return {
    value: collapsed,
    auto_fix: autoFix,
    $screen_name: autoFix ? `ai-action:${collapsed}:autofix` : `ai-action:${collapsed}`,
  };
}

/** `ui.feature.node-action`: collapsed action id as `value`. */
export function buildNodeActionEventProperties(actionId: string): Record<string, unknown> {
  const collapsed = qualifyPluginForUsage(actionId);
  return { value: collapsed, $screen_name: `node-action:${collapsed}` };
}

/**
 * `ui.feature.sidecar-consent`: the resolution as `value`, plus `action`
 * naming what parked behind the gate ({@link qualifyMaybePluginValue};
 * omitted when unknown).
 */
export function buildSidecarConsentEventProperties(
  value: string,
  context: string | null,
): Record<string, unknown> {
  return {
    value,
    ...(context !== null ? { action: qualifyMaybePluginValue(context) } : {}),
    $screen_name: `sidecar-consent:${value}`,
  };
}
