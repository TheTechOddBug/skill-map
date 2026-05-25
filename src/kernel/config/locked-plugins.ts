/**
 * Hardcoded lock-list for plugin bundles and extensions.
 *
 * Entries here cannot be toggled, by design, the lock is enforced at
 * every entry point that could mutate or interpret the enabled-state:
 *
 *   - **CLI** (`src/cli/commands/plugins.ts`): `sm plugins enable|disable`
 *     rejects locked targets up-front with exit 5 and a clear message.
 *   - **BFF** (`src/server/routes/plugins.ts`): `PATCH /api/plugins/...`
 *     returns `403 locked`. `GET /api/plugins` stamps `locked: true` so
 *     the SPA can render the toggle disabled with a "Locked" tag.
 *   - **Runtime resolver** (`./plugin-resolver.ts`): defense in depth,
 *     if a locked id ever ends up in `config_plugins` or `settings.json`
 *     (legacy DB row, hand-edited file, supply-chain mishap), the
 *     resolver IGNORES the override and returns the installed default
 *     (`true`). This makes "lock" unbreakable at runtime regardless of
 *     persisted state.
 *
 * Lives in `src/kernel/config/` so all three layers can import from a
 * shared spot without breaking the kernel's "no driver knows about
 * other drivers" rule.
 *
 * Forms accepted:
 *   - bundle id          → e.g. `'claude'` (locks the whole bundle)
 *   - qualified ext id   → e.g. `'core/markdown'` (locks one extension)
 *
 * Add or remove entries here only, there is no per-environment override
 * and no DB / settings.json escape hatch by design (the whole point of
 * the list is "host-enforced, not user-editable").
 */
export const LOCKED_PLUGIN_IDS: ReadonlySet<string> = new Set<string>([
  // `core/markdown` is the universal `.md` fallback Provider (see
  // spec/architecture.md §"core/markdown is the universal fallback for
  // unclaimed `.md` files"). Disabling it makes every orphan markdown
  // silently invisible, a foot-gun the host product does not want to
  // expose. Lock it in the enabled state.
  'core/markdown',
  // `core/annotations` turns the `supersedes` / `supersededBy` /
  // `requires` / `related` / `conflictsWith` entries of the sidecar
  // `annotations:` block into the arrows the graph draws between nodes.
  // It does NOT own the rest of the block (`version`, `stability`,
  // `tags`, `description`, those live on the node bundle directly and
  // keep rendering with the plugin off). Disabling it produces a
  // confusing "edges disappear but the sidecar metadata stays" split
  // that no operator actually wants; the lock makes the asymmetry
  // unreachable from CLI / BFF / UI. Re-evaluate if a third-party ever
  // ships a competing supersession extractor.
  'core/annotations',
  // `core/schema-violation` validates every scanned Node against
  // `node.schema.json` and every Link against `link.schema.json` (the
  // authoritative @skill-map/spec). Disabling it makes the system
  // persist non-conformant content silently, breaking the spec
  // invariant "what reaches the DB conforms to the spec". The check is
  // foundational, not advisory; lock it on so the guarantee holds
  // regardless of user / DB / settings hand-edits.
  'core/schema-violation',
  // `core/ascii` is the only built-in Formatter today and the default
  // for `sm graph` (`--format ascii`). Disabling it breaks the verb
  // entirely (`composeFormatters` returns the empty list, the CLI
  // prints "no formatter registered for 'ascii'" and exits with an
  // error) with no useful fallback. Lock it on until additional
  // formatters land (mermaid / dot / json, deferred in ROADMAP § Built-in
  // graph formatters); revisit the lock once `sm graph` has a real
  // catalog to choose from.
  'core/ascii',
]);

/** True when the given bundle id or qualified extension id is locked. */
export function isPluginLocked(idOrQualified: string): boolean {
  return LOCKED_PLUGIN_IDS.has(idOrQualified);
}
