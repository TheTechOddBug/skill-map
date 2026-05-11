/**
 * `sm plugins` — discover, inspect, and toggle plugins.
 *
 *   sm plugins list      tabulate discovered plugins with status (and DB / settings overrides)
 *   sm plugins show X    dump one plugin's manifest + loaded extensions
 *   sm plugins doctor    full load pass + summary by failure mode
 *   sm plugins enable  <id> | --all   write `enabled: true` to config_plugins
 *   sm plugins disable <id> | --all   write `enabled: false` to config_plugins
 *   sm plugins create  <plugin-id>   scaffold a new plugin directory
 *   sm plugins slots list            print the closed slot / input-type catalogs
 *   sm plugins upgrade [<id>]        apply catalog migrations (no-op today)
 *
 * Step 6.6 wires the enable/disable verbs and respects the resolution
 * order spec'd in `kernel/config/plugin-resolver.ts`:
 *
 *   DB override (config_plugins) > settings.json (#/plugins/<id>/enabled) > installed default (true)
 *
 * Spec § A.7 — granularity. Each plugin / built-in bundle declares a
 * granularity (`bundle` or `extension`). The CLI surfaces both kinds:
 *
 *   - bundle granularity ('claude', and most user plugins by default):
 *     the bundle id is the only toggle-able key. `sm plugins disable
 *     claude` works; `sm plugins disable claude/claude` is rejected as
 *     a misuse.
 *   - extension granularity ('core', plus user plugins that opt in):
 *     the bundle id alone is NOT toggle-able. `sm plugins disable core`
 *     is rejected; `sm plugins disable core/superseded` works.
 *
 * `--all` operates only on top-level plugin / bundle ids (never expands
 * to qualified `<bundle>/<ext>` keys); the user loses no expressivity
 * because granularity=extension bundles surface every extension in
 * `--all` only via their bundle id, which is rejected with directed
 * guidance — the right tool for the "disable every core extension"
 * intent is `--no-built-ins` on `sm scan`.
 *
 * This file is a barrel — each subcommand lives in its own file under
 * `cli/commands/plugins/` (architect-audit follow-up: split the 1700-LOC
 * monolith into per-verb modules + a shared helpers file).
 */

export { PluginsListCommand } from './plugins/list.js';
export { PluginsShowCommand } from './plugins/show.js';
export { PluginsDoctorCommand } from './plugins/doctor.js';
export { PluginsEnableCommand, PluginsDisableCommand } from './plugins/toggle.js';
export { PluginsCreateCommand } from './plugins/create.js';
export { PluginsSlotsListCommand } from './plugins/slots.js';
export { PluginsUpgradeCommand } from './plugins/upgrade.js';

import { PluginsListCommand } from './plugins/list.js';
import { PluginsShowCommand } from './plugins/show.js';
import { PluginsDoctorCommand } from './plugins/doctor.js';
import { PluginsEnableCommand, PluginsDisableCommand } from './plugins/toggle.js';
import { PluginsCreateCommand } from './plugins/create.js';
import { PluginsSlotsListCommand } from './plugins/slots.js';
import { PluginsUpgradeCommand } from './plugins/upgrade.js';

export const PLUGIN_COMMANDS = [
  PluginsListCommand,
  PluginsShowCommand,
  PluginsDoctorCommand,
  PluginsEnableCommand,
  PluginsDisableCommand,
  PluginsCreateCommand,
  PluginsSlotsListCommand,
  PluginsUpgradeCommand,
];
