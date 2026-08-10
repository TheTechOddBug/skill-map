/**
 * Strings for the `sm activity` verb family (live node activity, see
 * `spec/provider-activity.md` and `cli-contract.md` §Activity).
 */

export const ACTIVITY_TEXTS = {
  // Unknown / non-activity provider id passed to install / uninstall.
  unknownProvider:
    '{{glyph}}  sm activity: no registered provider "{{provider}}" supports live activity.\n',
  unknownProviderHint:
    'Providers with an activity adapter today: {{providers}}.',

  // Consent prompt (TTY). Names the exact file the merge will modify so
  // the operator approves a concrete change, not an abstract feature.
  installConfirm:
    'Wire the live-activity bridge into {{configPath}}? This adds skill-map hook entries (existing hooks are preserved)',

  // Declined / non-TTY without --yes: nothing written.
  installDeclined: '{{glyph}}  sm activity: install declined; nothing was written.\n',
  installNeedsTty:
    '{{glyph}}  sm activity: refusing to modify {{configPath}} without a TTY confirm. Re-run with --yes.\n',

  // Success summary. Install is REFRESH-semantics (re-running updates
  // our entries in place), so one message covers first-install and
  // re-install alike.
  installed:
    '{{glyph}}  sm activity: bridge written to {{bridgePath}} and wired into {{configPath}} ({{events}} events).\n',
  installedHint:
    'Restart {{provider}} so it reloads its hooks, and restart `sm` so the wiring takes effect; then invoke a skill / agent in {{provider}} to watch the map light up. Reverse with `sm activity uninstall {{provider}}`.',

  installedPlugin:
    '{{glyph}}  sm activity: in-process plugin written to {{configPath}}.\n',

  uninstalled:
    '{{glyph}}  sm activity: removed the bridge hooks from {{configPath}} and deleted {{bridgePath}}.\n',
  uninstalledPlugin:
    '{{glyph}}  sm activity: deleted the in-process plugin at {{configPath}}.\n',
  nothingToUninstallPlugin:
    '{{glyph}}  sm activity: no skill-map plugin at {{configPath}}; nothing to do.\n',
  nothingToUninstall:
    '{{glyph}}  sm activity: {{configPath}} carries no bridge hooks; nothing to do.\n',

  // `sm activity status` report lines, one per provider. The partial
  // states name the exact repair (a re-install refreshes both halves).
  statusInstalled:
    '{{glyph}}  {{provider}}: installed ({{configPath}})\n',
  statusNotInstalled:
    '{{glyph}}  {{provider}}: not installed ({{configPath}})\n',
  statusPartialBridgeMissing:
    '{{glyph}}  {{provider}}: partial, {{configPath}} is wired but the bridge artifact is missing; re-run `sm activity install {{provider}}`\n',

  // Wiring self-test (`--verify`), one indented line under the provider's
  // state line. `ok` is the only verdict that proves the chain works;
  // the failures each name what to do next.
  verifyOk:
    '   {{glyph}} self-test: the server received the probe through the installed bridge\n',
  verifySkipped:
    '   {{glyph}} self-test: skipped ({{detail}})\n',
  verifyFailed:
    '   {{glyph}} self-test: {{verdict}}, {{detail}}\n',
  // Printed once, after the report, whenever any provider failed. The
  // self-test cannot observe the runtime spawning the hook, so a green
  // run must never be read as proof of end-to-end wiring.
  verifyFooter:
    'The self-test covers everything downstream of the hook spawn (bridge, serve.json, scope + loopback gates, token, ingest). It cannot observe whether the provider runtime actually spawns the hook.\n',

  // Write failures (config merge or bridge artifact).
  installFailed:
    '{{glyph}}  sm activity: install failed: {{message}}\n',
  uninstallFailed:
    '{{glyph}}  sm activity: uninstall failed: {{message}}\n',


} as const;
