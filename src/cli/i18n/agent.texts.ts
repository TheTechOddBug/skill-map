/**
 * Strings for the `sm agent` verb family (the distributable agent drain
 * skill, see `spec/cli-contract.md` §Agent drain skill).
 */

export const AGENT_TEXTS = {
  // Destination refusals (§3.1b), all exit 2. `forUnknown` fires when
  // `--for` names an id no registered provider carries; `noSkillDir`
  // when the provider exists but declares no `scaffold.skillDir`
  // territory; `lensNoSkillDir` is the no-`--for` variant for an active
  // lens without one. All three share `skillDirHint`.
  forUnknown:
    '{{glyph}}  sm agent: no registered provider "{{provider}}"\n' +
    '   {{hint}}\n',
  noSkillDir:
    '{{glyph}}  sm agent: provider "{{provider}}" declares no skill directory\n' +
    '   {{hint}}\n',
  lensNoSkillDir:
    '{{glyph}}  sm agent: the active lens "{{provider}}" declares no skill directory\n' +
    '   {{hint}}\n',
  skillDirHint:
    'Providers with a skill directory: {{ids}}. Re-run with `--for <id>`.',

  // Install success, three states: fresh install / update (the copy on
  // disk predates this CLI's canonical template, bytes rewritten) /
  // already up to date (identical bytes, nothing written). The wording
  // is the CLI mirror of the UI button states (Install / Update / Up to
  // date), both driven by the same byte comparison.
  installed:
    '{{glyph}}  sm agent: installed the sm-run-queue skill at {{path}} ({{provider}} lens).\n',
  updated:
    '{{glyph}}  sm agent: updated the sm-run-queue skill at {{path}} to this CLI\'s version ({{provider}} lens).\n',
  upToDate:
    '{{glyph}}  sm agent: the sm-run-queue skill at {{path}} is already up to date ({{provider}} lens).\n',
  installedHint:
    'Any agent booted in this directory can now drain the queue; check with `sm agent status`.',

  // Uninstall. Removing a skill that is not there is a no-op advisory,
  // exit 0 (idempotent), mirroring `sm activity uninstall`.
  uninstalled:
    '{{glyph}}  sm agent: removed the sm-run-queue skill at {{path}}.\n',
  nothingToUninstall:
    '{{glyph}}  sm agent: no sm-run-queue skill at {{path}}; nothing to do.\n',

  // `sm agent status` report lines, one per install state. The verb
  // exits 0 in all three states; the report IS the result. The stale
  // line carries the actionable refresh hint (catalog-side per §4.2b).
  statusInstalled: '{{glyph}}  {{provider}}: installed ({{path}})\n',
  statusStale:
    '{{glyph}}  {{provider}}: installed (stale), {{path}} differs from this CLI\'s copy\n' +
    '   {{hint}}\n',
  statusStaleHint: 'Re-run `sm agent install` to refresh it.',
  statusNotInstalled: '{{glyph}}  {{provider}}: not installed ({{path}})\n',

  // I/O failures (single-line per §3.1: the message itself is the only
  // actionable content).
  installFailed: '{{glyph}}  sm agent: install failed: {{message}}\n',
  uninstallFailed: '{{glyph}}  sm agent: uninstall failed: {{message}}\n',
} as const;
