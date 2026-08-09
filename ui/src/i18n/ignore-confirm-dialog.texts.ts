/**
 * Texts for `<sm-ignore-confirm-dialog>`, the confirmation gate of the
 * Ignore buttons (files rail rows, inspector header). English-only per
 * the externalized-texts convention.
 */
export const IGNORE_CONFIRM_DIALOG_TEXTS = {
  headerFile: 'Ignore this file?',
  headerFolder: 'Ignore this folder?',
  bodyFile:
    'The file will be hidden from the scan and the map. This pattern is appended to the project .skillmapignore:',
  bodyFolder:
    'The folder and everything inside it will be hidden from the scan and the map. This pattern is appended to the project .skillmapignore:',
  reAddHint: 'You can bring it back anytime from Settings > Project, in the ignore patterns list.',
  alwaysLabel: "Don't ask again",
  alwaysHint:
    'Skips this confirmation for this project on this machine. Patterns are still added on every click.',
  confirm: 'Ignore',
  cancel: 'Cancel',
  ariaLabel: 'Ignore path confirmation',
} as const;
