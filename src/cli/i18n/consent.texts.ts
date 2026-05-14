/**
 * Strings shared by the `.sm` sidecar consent gate, used by every verb
 * that performs sidecar writes (`sm bump`, `sm sidecar refresh`,
 * `sm sidecar annotate`). The `{{verb}}` placeholder is filled by the
 * caller with the user-visible verb prefix (e.g. `'sm bump'` or
 * `'sm sidecar'`) so the directed error messages name the surface the
 * operator actually invoked.
 *
 * Same convention as the per-verb catalogs: flat string templates with
 * `{{name}}` placeholders for `tx(...)`.
 */

export const CONSENT_TEXTS = {
  /**
   * Pre-prompt context shown before the interactive `confirm()` so the
   * operator sees what they are about to opt into.
   * `.skill-map/settings.local.json` is gitignored, the choice is saved
   * per-checkout, never travels via the repo.
   */
  consentPrompt:
    '{{glyph}}  skill-map needs consent to create .sm sidecar files next to your\n' +
    '   .md sources. Your choice is saved to .skill-map/settings.local.json\n' +
    '   (gitignored) and this prompt will not appear again.\n\n' +
    'Allow .sm sidecar writes in this project?',
  consentAborted:
    '{{glyph}}  {{verb}}: aborted by user. No .sm sidecar files were written.\n',
  consentRequiredNonTty:
    '{{glyph}}  {{verb}}: consent required to write .sm sidecar files in this project.\n' +
    '   {{hint}}\n',
  consentRequiredNonTtyHint:
    'Pass --yes to grant (writes to .skill-map/settings.local.json, gitignored).',
} as const;
