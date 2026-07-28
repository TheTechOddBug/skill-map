/** UI strings for the QueueView (the workspace rail's job-queue panel). */
export const QUEUE_VIEW_TEXTS = {
  loading: 'Loading queue…',
  /** Friendly empty state, mirrors the files view's "nothing here" tone. */
  empty: 'The job queue is empty.',
  emptyHint: 'Submitted AI actions appear here while they wait, run, and finish.',
  columns: {
    status: 'Status',
    extension: 'Extension',
    node: 'Node',
    /** Relative time since the job was created / claimed. */
    age: 'Age',
  },
  /** Human labels for each lifecycle state (status cell tooltip). */
  status: {
    queued: 'Queued',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  } as Record<string, string>,
  cancelTooltip: 'Cancel this job',
  /**
   * Cancel tooltip for a RUNNING job: cancelling marks it cancelled but
   * cannot interrupt an agent that is already executing it (the escape hatch
   * is really for a job with no agent attending). The agent only discovers
   * the cancellation when it reports back.
   */
  cancelRunningTooltip:
    'Cancel: tries to stop it, but a job an agent is already running is not guaranteed to halt (the agent finds out when it reports back).',
  cancelAriaLabel: (extension: string) => `Cancel the ${extension} job`,
  /** Age cell: relative label plus an exact-timestamp title on hover. */
  ageTooltip: (iso: string) => `Created ${iso}`,
  /** Compact page report for the bottom paginator (PrimeNG placeholders). */
  pageReport: '{first}-{last} of {totalRecords}',
  /** Per-row retry (failed jobs): a fresh re-submit. */
  retryTooltip: 'Retry (re-submit)',
  retryAriaLabel: (extension: string) => `Retry the ${extension} job`,
  /** Bulk toolbar buttons + their confirm dialogs. */
  bulk: {
    groupLabel: 'Bulk queue actions',
    cancelActive: (count: number) => `Cancel active (${count})`,
    clearFailed: (count: number) => `Clear failed (${count})`,
    clearFinished: (count: number) => `Clear finished (${count})`,
    /** Shared reject label (keep things as they are). */
    reject: 'Keep',
    cancelAll: {
      header: 'Cancel all active jobs?',
      accept: 'Cancel all',
      message: (count: number) =>
        `Cancel ${count} active ${count === 1 ? 'job' : 'jobs'} now? A running agent discovers the cancellation when it reports back.`,
    },
    clearFailedConfirm: {
      header: 'Clear failed jobs?',
      accept: 'Clear',
      message: (count: number) =>
        `Delete ${count} failed ${count === 1 ? 'job' : 'jobs'} now? This cannot be undone.`,
    },
    clearFinishedConfirm: {
      header: 'Clear finished jobs?',
      accept: 'Clear',
      message: (count: number) =>
        `Delete ${count} finished ${count === 1 ? 'job' : 'jobs'} now (completed, failed and cancelled)? This cannot be undone.`,
    },
  },
  /** Local filter bar: a text search plus the status chips. */
  filter: {
    searchPlaceholder: 'Filter by node or extension…',
    searchAriaLabel: 'Filter the queue by node or extension',
    searchClear: 'Clear filter',
    /** Aria label for the status-chip group. */
    statusLabel: 'Filter by status',
    /** Per-chip aria label: state, count, and what a click does. */
    chipAriaLabel: (label: string, count: number, active: boolean) =>
      `${label}: ${count} ${count === 1 ? 'job' : 'jobs'}. ${
        active ? 'Shown' : 'Hidden'
      }, click to toggle.`,
    /** Shown when jobs exist but none match the active filter. */
    noMatch: 'No jobs match the current filter.',
  },
  /**
   * Screen-reader announcements for queue mutations (WCAG 4.1.3). The
   * queue updates its rows silently, so these narrate the outcome of a
   * cancel / retry / bulk clear and the live active-job count.
   */
  announce: {
    cancelled: 'Job cancelled.',
    retried: 'Job re-queued.',
    bulkDone: 'Queue updated.',
    activeCount: (count: number): string =>
      count === 1 ? '1 active job.' : `${count} active jobs.`,
  },
} as const;
