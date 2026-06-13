/**
 * `sm plugins`, discover, inspect, and toggle plugins.
 *
 *   sm plugins list [X]  tabulate discovered plugins (no id), or one plugin's extensions (bare id)
 *   sm plugins show X    show one extension's detail (qualified <plugin>/<ext> id)
 *   sm plugins doctor    full load pass + summary by failure mode
 *   sm plugins enable  <id> | --all   write `enabled: true` to config_plugins
 *   sm plugins disable <id> | --all   write `enabled: false` to config_plugins
 *   sm plugins create  <plugin-id>   scaffold a new plugin directory
 *   sm plugins slots list            print the closed slot / input-type catalogs
 *   sm plugins upgrade [<id>]        apply catalog migrations (no-op today)
 *   sm plugins config <plugin>/<ext> [<settingId> [<value>] | --reset]  read / write extension settings
 *
 * Step 6.6 wires the enable/disable verbs and respects the resolution
 * order spec'd in `kernel/config/plugin-resolver.ts`:
 *
 *   DB override (config_plugins) > settings.json (#/plugins/<id>/enabled) > installed default (true)
 *
 * **Toggle model**: every extension is independently toggle-able by its
 * qualified id `<plugin>/<ext>` (e.g. `claude/at-directive`). The
 * plugin row is a presentational grouping, not a toggle target. The bare
 * plugin id (`sm plugins disable claude`) is accepted as a macro that
 * fans the toggle out across the plugin's extensions; multi-extension
 * plugins require `--yes` (or an interactive TTY confirm) so the user
 * does not flip 27 `core` extensions by accident.
 *
 * `--all` operates only on plugin ids and cascades through every
 * extension in every plugin. CI / pipe contexts need `--yes`.
 *
 * This file is a barrel, each subcommand lives in its own file under
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
export { PluginsConfigCommand } from './plugins/config.js';

import { PluginsListCommand } from './plugins/list.js';
import { PluginsShowCommand } from './plugins/show.js';
import { PluginsDoctorCommand } from './plugins/doctor.js';
import { PluginsEnableCommand, PluginsDisableCommand } from './plugins/toggle.js';
import { PluginsCreateCommand } from './plugins/create.js';
import { PluginsSlotsListCommand } from './plugins/slots.js';
import { PluginsUpgradeCommand } from './plugins/upgrade.js';
import { PluginsConfigCommand } from './plugins/config.js';

export const PLUGIN_COMMANDS = [
  PluginsListCommand,
  PluginsShowCommand,
  PluginsDoctorCommand,
  PluginsEnableCommand,
  PluginsDisableCommand,
  PluginsCreateCommand,
  PluginsSlotsListCommand,
  PluginsUpgradeCommand,
  PluginsConfigCommand,
];
