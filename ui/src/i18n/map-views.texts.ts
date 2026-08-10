/**
 * Texts for the map-views feature: `<sm-map-view-switcher>` (graph
 * toolbar) and `<sm-map-view-confirm-dialog>` (dirty-switch gate).
 * English-only per the externalized-texts convention.
 */
export const MAP_VIEWS_TEXTS = {
  /** Neutral trigger label while no view is active. */
  trigger: 'Views',
  triggerAriaNeutral: 'Map views: none active. Open the view switcher.',
  triggerAriaActive: (name: string) =>
    `Map views: ${name} active. Open the view switcher.`,
  triggerTooltip: 'Map views: save and switch shared map curations',
  /** Title above the popover list. */
  panelTitle: 'Map views',
  loading: 'Loading views…',
  empty: 'No saved views yet. Curate the map, then save it as a view to share it through git.',
  applyAria: (name: string) => `Apply view ${name}`,
  /** Per-row dead-reference badge (count > 0 only). */
  brokenRefs: (count: number) => `${count} broken ${count === 1 ? 'ref' : 'refs'}`,
  brokenRefsTooltip:
    'References to nodes that no longer exist in the scan. The view still applies; dead references are ignored, never rewritten.',
  deleteTooltip: 'Delete this view',
  deleteAria: (name: string) => `Delete view ${name}`,
  /** Skipped (unparseable) view files, listed by the server. */
  skipped: (count: number) =>
    `${count} view ${count === 1 ? 'file' : 'files'} could not be read and ${count === 1 ? 'was' : 'were'} skipped.`,
  save: 'Save',
  saveTooltip: 'Save the current curation into the active view',
  revert: 'Revert',
  revertTooltip: 'Discard the unsaved changes and restore the view as it was saved',
  revertAria: 'Revert the unsaved changes to the active view',
  saveAs: 'Save as',
  /** Second-confirmation state when the derived slug already exists. */
  saveAsOverwrite: 'Overwrite existing?',
  saveAsPlaceholder: 'New view name',
  saveAsAria: 'Save the current map as a new view',
  saveAsNameAria: 'Name for the new view',
  exit: 'Exit views',
  exitTooltip: 'Leave the view and show the full map',
  /** Dirty indicator (trigger button + files-rail chip). */
  dirtyAria: 'This view has unsaved changes',
  confirm: {
    header: 'Unsaved view changes',
    body: (name: string) =>
      `The view "${name}" has unsaved changes. Save them before switching?`,
    saveButton: 'Save and switch',
    discardButton: 'Discard changes',
    cancelButton: 'Cancel',
    alwaysLabel: "Don't ask again",
    alwaysHint:
      'Switches views without asking for this project on this machine. Unsaved changes are discarded unless you save first.',
    ariaLabel: 'Unsaved view changes confirmation',
  },
} as const;
