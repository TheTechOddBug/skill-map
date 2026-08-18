/**
 * Tripwire for the UI demo's baked activity descriptors
 * (`ui/src/services/data-source/static-data-source.ts`,
 * `DEMO_ACTIVITY_DESCRIPTORS`): the demo cannot import the kernel, so
 * it hand-mirrors each activity provider's `configPath`, base event
 * count and shell opt-in capability, and hand-mirrors rot silently (the codex entry sat at 3 while
 * the descriptor grew to 6, found by field audit 2026-08-18). This
 * check derives the truth from the REAL built-in descriptors and
 * exact-matches the mirror, same posture as the e2e testid tripwire:
 * catch the drift in milliseconds, with the stale entry named.
 *
 * Expected shape per provider: `events` counts the BASE render (opt-in
 * events excluded, the demo reports the un-opted surface) for
 * `json-hooks`, and `0` for `plugin-file` (nothing event-shaped to
 * count). Both directions are asserted: every activity provider must
 * appear in the mirror, and the mirror must not carry retired ids.
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { builtIns } from '../built-ins.js';

const STATIC_DATA_SOURCE = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..', '..', '..',
  'ui', 'src', 'services', 'data-source', 'static-data-source.ts',
);

interface IDemoDescriptor {
  configPath: string;
  events: number;
  shellOptIn: boolean;
}

/** Parse the mirror's object literal out of the UI source. */
function parseDemoDescriptors(source: string): Record<string, IDemoDescriptor> {
  const block = source.match(/const DEMO_ACTIVITY_DESCRIPTORS[^=]*=\s*\{([\s\S]*?)\n\};/);
  ok(block, 'DEMO_ACTIVITY_DESCRIPTORS literal found in static-data-source.ts');
  const out: Record<string, IDemoDescriptor> = {};
  const entry =
    /(\w[\w-]*):\s*\{\s*configPath:\s*'([^']+)',\s*events:\s*(\d+),\s*shellOptIn:\s*(true|false)\s*\}/g;
  for (const match of block![1]!.matchAll(entry)) {
    out[match[1]!] = {
      configPath: match[2]!,
      events: Number(match[3]!),
      shellOptIn: match[4] === 'true',
    };
  }
  return out;
}

describe('demo activity descriptors mirror', () => {
  it('matches every built-in activity descriptor (configPath + base event count)', () => {
    const expected: Record<string, IDemoDescriptor> = {};
    for (const provider of builtIns().providers) {
      const install = provider.activity?.install;
      if (install === undefined) continue;
      const events = install.kind === 'json-hooks' ? (install.events ?? []) : [];
      expected[provider.id] = {
        configPath: install.configPath,
        events: events.filter((event) => event.optIn === undefined).length,
        shellOptIn: events.some((event) => event.optIn === 'shell'),
      };
    }
    // Anti-vacuity: an extraction that finds almost nothing must fail
    // loud, not compare two empty objects and pass.
    ok(Object.keys(expected).length >= 3, 'at least three activity providers exist');

    const mirrored = parseDemoDescriptors(readFileSync(STATIC_DATA_SOURCE, 'utf8'));
    deepStrictEqual(mirrored, expected);
  });
});
