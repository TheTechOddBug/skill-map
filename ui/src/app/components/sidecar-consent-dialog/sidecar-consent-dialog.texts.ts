/** UI strings for the SidecarConsentDialog (`.sm` write consent gate). */
export const SIDECAR_CONSENT_DIALOG_TEXTS = {
  header: 'Allow skill-map to create files in this project?',
  body:
    'Skill-map will create companion files (*.sm) next to your markdown ' +
    'files to track version, history and tags. Your markdown stays clean, ' +
    'metadata never gets mixed into the content you wrote.',
  /**
   * The "always" checkbox. Unticked, the grant is one-shot (this write
   * only) and skill-map asks again on the next `.sm` write. Ticked, the
   * project-wide `allowEditSmFiles` flag is persisted and we never ask
   * again. The flag is per-project and per-machine, it does not travel
   * with the repo.
   */
  alwaysLabel: 'Always allow editing .sm files in this project',
  alwaysHint:
    'When off, we ask again on the next write. When on, the choice is ' +
    'remembered for this project on this machine.',
  accept: 'Allow',
  reject: 'Not now',
  ariaLabel: 'Sidecar write consent',
} as const;
