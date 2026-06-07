/** UI strings for the ActionDispatchService (generic action dispatch). */
export const ACTION_DISPATCH_TEXTS = {
  /** Prefix for every dispatch-failure banner. */
  errorPrefix: 'Action failed:',
  errorFresh: 'This node is fresh; nothing to do.',
  errorNotFound: 'Node not found on the server.',
  errorReadonly: 'Actions are not available in demo mode.',
  errorGeneric: 'Could not run the action.',
} as const;
