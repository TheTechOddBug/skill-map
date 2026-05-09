/**
 * Hardcoded lock-list for plugin bundles and extensions.
 *
 * Entries here cannot be toggled — by design, the lock is enforced at
 * every entry point that could mutate or interpret the enabled-state:
 *
 *   - **CLI** (`src/cli/commands/plugins.ts`): `sm plugins enable|disable`
 *     rejects locked targets up-front with exit 5 and a clear message.
 *   - **BFF** (`src/server/routes/plugins.ts`): `PATCH /api/plugins/...`
 *     returns `403 locked`. `GET /api/plugins` stamps `locked: true` so
 *     the SPA can render the toggle disabled with a "Locked" tag.
 *   - **Runtime resolver** (`./plugin-resolver.ts`): defense in depth —
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
 * Add or remove entries here only — there is no per-environment override
 * and no DB / settings.json escape hatch by design (the whole point of
 * the list is "host-enforced, not user-editable").
 */
export const LOCKED_PLUGIN_IDS: ReadonlySet<string> = new Set<string>([
  // `core/markdown` is the universal `.md` fallback Provider (see
  // spec/architecture.md §"core/markdown is the universal fallback for
  // unclaimed `.md` files"). Disabling it makes every orphan markdown
  // silently invisible — a foot-gun the host product does not want to
  // expose. Lock it in the enabled state.
  'core/markdown',
]);

/** True when the given bundle id or qualified extension id is locked. */
export function isPluginLocked(idOrQualified: string): boolean {
  return LOCKED_PLUGIN_IDS.has(idOrQualified);
}
