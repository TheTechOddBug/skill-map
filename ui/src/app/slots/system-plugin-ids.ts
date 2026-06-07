/**
 * Closed set of built-in ("system") plugin ids.
 *
 * Used by the `NodeSection` renderer (`inspector.body.section` slot) to
 * decide whether a plugin-owned inspector zone shows its title bare
 * (`<zone>`) or prefixed (`<pluginId>:<zone>`):
 *
 *   - System plugins (the ones bundled with the CLI) render WITHOUT the
 *     prefix, they are part of the product surface, not a drop-in.
 *   - Every other plugin renders WITH the `<pluginId>:` prefix, applied
 *     here by the host so a drop-in plugin can never disguise its zone
 *     as a system section (the prefix is non-falsifiable: it comes from
 *     the contribution's `pluginId`, never from the payload).
 *
 * Mirror of `src/plugins/ids.ts` (`CORE_PLUGIN_ID`, `CLAUDE_PLUGIN_ID`,
 * ...): the built-in extensions stamp these literals into their
 * `pluginId` field. Keep the two lists in lockstep, a new built-in
 * provider/plugin id added there is added here too. The spec carries
 * the normative list (`spec/view-slots.md`); this is the UI mirror.
 */

const SYSTEM_PLUGIN_IDS: ReadonlySet<string> = new Set([
  'core',
  'claude',
  'openai',
  'antigravity',
  'agent-skills',
]);

/** Whether `pluginId` is a bundled (system) plugin. */
export function isSystemPluginId(pluginId: string): boolean {
  return SYSTEM_PLUGIN_IDS.has(pluginId);
}
