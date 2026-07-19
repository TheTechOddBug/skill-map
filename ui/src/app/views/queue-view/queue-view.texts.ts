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
    /** Visually-hidden header for the per-row actions column. */
    actions: 'Actions',
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
  cancelAriaLabel: (extension: string) => `Cancel the ${extension} job`,
  /** Age cell: relative label plus an exact-timestamp title on hover. */
  ageTooltip: (iso: string) => `Created ${iso}`,
  /** Compact page report for the bottom paginator (PrimeNG placeholders). */
  pageReport: '{first}-{last} of {totalRecords}',
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
} as const;
