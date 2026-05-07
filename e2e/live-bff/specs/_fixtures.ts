/**
 * Per-test Playwright fixture for the `live-bff` project — exposes the
 * dynamic `baseURL` that `live-bff/global-setup.ts` picks at boot.
 *
 * Why a custom fixture instead of `use.baseURL`: the URL only exists
 * after globalSetup has spawned the kernel and bound its free port.
 * Playwright's static `use.baseURL` resolves at config-load time, which
 * is too early. Reading `process.env.LIVE_BFF_URL` from the worker is
 * the recommended pattern (env vars survive the config → worker
 * process boundary).
 */

import { test as base, expect } from '@playwright/test';

export interface ILiveBffFixtures {
  /** Trailing-slash-terminated base URL of the spawned `sm serve`. */
  liveBffUrl: string;
}

export const test = base.extend<ILiveBffFixtures>({
  liveBffUrl: async ({}, use) => {
    const url = process.env['LIVE_BFF_URL'];
    if (!url) {
      throw new Error(
        'LIVE_BFF_URL is not set — globalSetup did not spawn `sm serve`. ' +
        'Run with `--project=live-bff` so the live-BFF harness boots.',
      );
    }
    await use(url);
  },
});

export { expect };
