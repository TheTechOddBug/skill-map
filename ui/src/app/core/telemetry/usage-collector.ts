/**
 * Pure UI usage-collector helpers (mirror of the CLI
 * `cli/telemetry/usage-collector.ts`). They shape plugin ids before they leave
 * the browser: a built-in id passes through, anything third-party collapses to
 * `external_plugin`, so a private plugin id never reaches PostHog. No SDK
 * dependency, so it is trivially unit-testable.
 */

/** The closed set of built-in plugin ids. */
const BUILT_IN_PLUGIN_IDS: ReadonlySet<string> = new Set([
  'claude',
  'antigravity',
  'codex',
  'opencode',
  'agent-skills',
  'core',
]);

/** The literal that replaces every non-built-in plugin id. */
const EXTERNAL_PLUGIN_PLACEHOLDER = 'external_plugin';

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
