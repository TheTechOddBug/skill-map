import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

/**
 * Seed browser-local `sm.*` state for a spec, STAMPED with the current
 * CLI version. The UI's storage gate (ui/src/services/scoped-storage.ts)
 * wipes every `sm.*` key it finds on an origin whose stored
 * `sm.storage-version` does not match the serving version, and a fresh
 * Playwright context has no version at all, so an unstamped seed reads
 * as pre-namespace leftovers and is erased at boot (that took the whole
 * smoke suite down on 2026-08-17). Stamping alongside the seed says
 * "this state is current" and the gate leaves it alone.
 *
 * The version comes from `src/package.json`, the same source the serve
 * meta and the demo patch stamp into the HTML.
 */
const CLI_VERSION = (
  JSON.parse(readFileSync(new URL('../src/package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

export async function seedProjectStorage(
  page: Page,
  seeds: Record<string, string> = {},
): Promise<void> {
  await page.addInitScript(
    ({ version, entries }) => {
      try {
        window.localStorage.setItem('sm.storage-version', version);
        for (const [key, value] of Object.entries(entries)) {
          window.localStorage.setItem(key, value);
        }
      } catch {
        /* localStorage unavailable before first paint; ignore. */
      }
    },
    { version: CLI_VERSION, entries: seeds },
  );
}

/** The common recipe: open the files rail (the workspace is map-first). */
export async function seedOpenRail(page: Page): Promise<void> {
  await seedProjectStorage(page, { 'sm.workspace.rail-collapsed': '0' });
}
