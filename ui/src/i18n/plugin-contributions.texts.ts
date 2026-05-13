/**
 * UI strings for `<sm-plugin-contributions>`, surfaces sidecar
 * top-level keys that aren't reserved blocks (`for`, `annotations`,
 * `settings`, `audit`). Each non-reserved root key is treated as a
 * plugin namespace; the registered annotation catalog (fetched once
 * from `GET /api/annotations/registered`) tells us which namespaces
 * are owned by a known plugin vs. an unregistered (or stale) plugin.
 */
export const PLUGIN_CONTRIBUTIONS_TEXTS = {
  header: 'Plugin contributions',
  count: (n: number) => `${n} namespace${n === 1 ? '' : 's'}`,
  unregisteredBadge: 'unregistered',
  rootContribBadge: (pluginId: string) => `from plugin: ${pluginId}`,
  empty: 'No plugin contributions on this sidecar.',
} as const;
