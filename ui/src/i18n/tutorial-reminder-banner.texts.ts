/**
 * `<sm-tutorial-reminder-banner>` copy. A centered topbar nudge shown to
 * a first-time user, one message at a time, advanced by its dismiss
 * button (`tutorialReminderStep`, `core/config/loader.ts`). Step 0 opens
 * with the Quick Start nudge; step 1 follows with the `sm tutorial`
 * nudge; dismissing step 1 hides the reminder for good.
 */
export const TUTORIAL_REMINDER_TEXTS = {
  steps: [
    { body: 'New to skill-map? Use Quick Start to enable what you need and make sure everything is ready.', command: null },
    { body: 'New to skill-map? In an empty folder, run', command: 'sm tutorial' },
  ],
  dismissAria: 'Dismiss the tutorial reminder',
} as const;
