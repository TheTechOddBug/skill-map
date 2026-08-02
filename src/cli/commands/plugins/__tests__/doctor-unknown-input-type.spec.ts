/**
 * Unit coverage for the doctor's `unknown-input-type` pass
 * (`spec/schemas/plugins-doctor.schema.json`, warnings enum): a declared
 * setting whose `type` sits outside the closed input-type catalog is
 * reported, mirroring `unknown-slot`. AJV rejects such a manifest at
 * load for drop-ins (`invalid-manifest`), so a LIVE plugin can never
 * reach this state; the pass is the defence-in-depth path for
 * catalog-drift scenarios, and the spec feeds a synthetic discovery row.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { collectUnknownInputTypeWarnings } from '../doctor.js';
import type { IDiscoveredPlugin } from '../../../../kernel/types/plugin.js';

/** A minimal enabled discovery row whose one extension carries `settings`. */
function discoveredWith(settings: Record<string, unknown>): IDiscoveredPlugin[] {
  return [
    {
      path: '/tmp/fake',
      id: 'acme',
      status: 'enabled',
      extensions: [
        {
          kind: 'extractor',
          id: 'thing',
          pluginId: 'acme',
          version: '1.0.0',
          module: { default: { settings } },
        } as unknown as NonNullable<IDiscoveredPlugin['extensions']>[number],
      ],
    } as unknown as IDiscoveredPlugin,
  ];
}

describe('collectUnknownInputTypeWarnings', () => {
  it('reports a setting whose type is outside the closed catalog', () => {
    const warnings = collectUnknownInputTypeWarnings(
      discoveredWith({
        good: { type: 'single-string', label: 'Fine' },
        bad: { type: 'text', label: 'Legacy' },
      }),
    );
    assert.deepEqual(warnings, [
      { extensionQualifiedId: 'acme/thing', settingId: 'bad', type: 'text' },
    ]);
  });

  it('reports nothing for catalog types, settings-less extensions, and built-ins', () => {
    assert.deepEqual(
      collectUnknownInputTypeWarnings(
        discoveredWith({ ok: { type: 'boolean-flag', label: 'Fine' } }),
      ),
      [],
    );
    // No user plugins at all: only the shipped built-ins are walked, and
    // every shipped declaration must be catalog-clean.
    assert.deepEqual(collectUnknownInputTypeWarnings([]), []);
  });

  it('skips disabled plugins (their manifests were never composed)', () => {
    const rows = discoveredWith({ bad: { type: 'text', label: 'Legacy' } });
    (rows[0] as { status: string }).status = 'disabled';
    assert.deepEqual(collectUnknownInputTypeWarnings(rows), []);
  });
});
