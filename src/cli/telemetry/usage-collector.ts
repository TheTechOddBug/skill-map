/**
 * Pure helpers for the opt-in usage-analytics surface (`spec/telemetry.md`
 * §Usage event taxonomy). No PostHog dependency and no side effects, so the
 * deny-by-default shaping can be unit-tested against hostile inputs
 * independently of the SDK wiring.
 *
 * The collectors emit only NAMES and ENUMS: a verb name, the names of the
 * flags that were set (never their values), and the set of built-in
 * extension ids that executed during a scan (presence, never a count). Any
 * third-party extension id is collapsed to the literal `external_plugin`
 * before it can leave the machine.
 */

/**
 * The closed set of built-in plugin ids (the first segment of a qualified
 * extension id `<pluginId>/<id>`). Mirrors the hardcoded `pluginId` stamps
 * in the generated `src/plugins/built-ins.ts`. Any id outside this set is a
 * third-party plugin and MUST NOT leave the machine.
 */
export const BUILT_IN_PLUGIN_IDS: ReadonlySet<string> = new Set([
  'claude',
  'antigravity',
  'openai',
  'agent-skills',
  'core',
]);

/** The literal that replaces every non-built-in extension id. */
export const EXTERNAL_PLUGIN_PLACEHOLDER = 'external_plugin';

/**
 * Map a qualified extension id (`<pluginId>/<id>`) to the value that may
 * leave the machine: the id unchanged when its plugin is built-in, the
 * literal `external_plugin` otherwise. A malformed id with no `/` (or an
 * empty plugin segment) is treated as third-party.
 */
export function qualifyExtensionForUsage(qualifiedId: string): string {
  const slash = qualifiedId.indexOf('/');
  if (slash <= 0) return EXTERNAL_PLUGIN_PLACEHOLDER;
  const pluginId = qualifiedId.slice(0, slash);
  return BUILT_IN_PLUGIN_IDS.has(pluginId) ? qualifiedId : EXTERNAL_PLUGIN_PLACEHOLDER;
}

/**
 * Build the `extensions` property the `cli.<verb>` event carries on a scan:
 * every executed extension id mapped through {@link qualifyExtensionForUsage},
 * deduped and sorted into a stable set. Presence only; the result never
 * encodes how many times an extension ran or how large the project is.
 */
export function buildScanExtensionSet(executedExtensionIds: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const id of executedExtensionIds) {
    out.add(qualifyExtensionForUsage(id));
  }
  return [...out].sort();
}

/**
 * Extract the NAMES of the flags present in a verb's argv, never their
 * values. A token is a flag when it starts with `-`; the leading dashes and
 * any `=value` suffix are stripped, so `--max-nodes=500` and `--max-nodes 500`
 * both report `max-nodes` (the bare `500` token does not start with `-`, so a
 * value is never captured). Deduped and sorted.
 */
export function extractFlagNames(args: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const arg of args) {
    if (!arg.startsWith('-')) continue;
    const name = arg.replace(/^-+/, '').split('=')[0];
    if (name !== undefined && name !== '') out.add(name);
  }
  return [...out].sort();
}

/**
 * The PostHog event name for a CLI invocation: `cli.<verb>` when the verb is a
 * registered command, `cli.unknown` otherwise. The closed-set guard keeps the
 * event catalog bounded (verbs are a low-cardinality closed set), so a
 * `sm <typo>` or an unknown command never mints a junk event definition from
 * arbitrary user input.
 */
export function cliVerbEventName(verb: string, knownVerbs: ReadonlySet<string>): string {
  return `cli.${knownVerbs.has(verb) ? verb : 'unknown'}`;
}

/**
 * Build the properties for a `cli.<verb>` event: the sorted, deduped NAMES of
 * the flags that were set (never their values), plus the executed-extractor
 * set folded in ONLY when the invocation was a scan (`extensions` is omitted
 * otherwise). The verb itself lives in the event name, not a property.
 */
export function buildCliVerbProperties(
  flagNames: Iterable<string>,
  extensions: readonly string[] | null,
): Record<string, unknown> {
  const flags = [...new Set(flagNames)].sort();
  return extensions ? { flags, extensions } : { flags };
}

/** Environment facts attached to every usage event. */
export interface IEnvUsageProps {
  cli_version: string;
  node_major: number;
  os: NodeJS.Platform;
  arch: string;
}

/**
 * Derive the per-event environment facts. The single place platform globals
 * are read for usage, so the property assemblers above stay pure and the
 * shape is easy to assert.
 */
export function envUsageProps(cliVersion: string): IEnvUsageProps {
  return {
    cli_version: cliVersion,
    node_major: Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10),
    os: process.platform,
    arch: process.arch,
  };
}
