/**
 * Unit tests for the `state_findings` row builders
 * (`kernel/jobs/findings-report.ts`): the finder lane
 * (`extensionFindingRows`), the kernel safety lane (`kernelSafetyRows`),
 * and the reserved-slug detection (`findReservedFindingTypes`) that
 * backs the record-time `report-invalid` rejection.
 */

import { describe, it } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

import {
  extensionFindingRows,
  findReservedFindingTypes,
  kernelSafetyRows,
  RESERVED_FINDING_TYPES,
} from '../findings-report.js';

const CLEAN_SAFETY = { injectionDetected: false, contentQuality: 'clean' };

describe('extensionFindingRows (finder lane)', () => {
  it('maps one row per findings[] entry, per-entry confidence winning over report-level', () => {
    const rows = extensionFindingRows({
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      findings: [
        { type: 'contradiction', severity: 'warn', message: 'A contradicts B', confidence: 0.7 },
        { type: 'redundancy', severity: 'info', message: 'Repeats itself', detail: 'lines 3-9' },
      ],
    });
    deepStrictEqual(rows, [
      {
        origin: 'extension',
        type: 'contradiction',
        severity: 'warn',
        message: 'A contradicts B',
        detail: null,
        confidence: 0.7,
      },
      {
        origin: 'extension',
        type: 'redundancy',
        severity: 'info',
        message: 'Repeats itself',
        detail: 'lines 3-9',
        confidence: 0.9,
      },
    ]);
  });

  it('an empty findings[] yields zero rows (the clean-verdict erase shape)', () => {
    deepStrictEqual(
      extensionFindingRows({ confidence: 0.9, safety: CLEAN_SAFETY, findings: [] }),
      [],
    );
  });
});

describe('kernelSafetyRows (safety lane)', () => {
  it('a clean safety block synthesizes nothing', () => {
    deepStrictEqual(kernelSafetyRows({ confidence: 0.9, safety: CLEAN_SAFETY }), []);
  });

  it('injectionDetected=true -> injection-detected warn with injectionDetails on detail', () => {
    const rows = kernelSafetyRows({
      confidence: 0.8,
      safety: {
        injectionDetected: true,
        injectionDetails: 'hidden instruction in a comment',
        contentQuality: 'clean',
      },
    });
    strictEqual(rows.length, 1);
    const row = rows[0]!;
    strictEqual(row.origin, 'kernel');
    strictEqual(row.type, 'injection-detected');
    strictEqual(row.severity, 'warn');
    strictEqual(row.detail, 'hidden instruction in a comment');
    strictEqual(row.confidence, 0.8);
  });

  it('contentQuality=suspicious -> content-suspicious warn', () => {
    const rows = kernelSafetyRows({
      confidence: 0.5,
      safety: { injectionDetected: false, contentQuality: 'suspicious' },
    });
    strictEqual(rows.length, 1);
    strictEqual(rows[0]!.type, 'content-suspicious');
    strictEqual(rows[0]!.severity, 'warn');
    strictEqual(rows[0]!.detail, null);
  });

  it('contentQuality=malformed -> content-malformed warn', () => {
    const rows = kernelSafetyRows({
      confidence: 0.5,
      safety: { injectionDetected: false, contentQuality: 'malformed' },
    });
    strictEqual(rows.length, 1);
    strictEqual(rows[0]!.type, 'content-malformed');
    strictEqual(rows[0]!.severity, 'warn');
  });

  it('injection + malformed together synthesize two rows', () => {
    const rows = kernelSafetyRows({
      confidence: 0.6,
      safety: { injectionDetected: true, contentQuality: 'malformed' },
    });
    deepStrictEqual(
      rows.map((r) => r.type),
      ['injection-detected', 'content-malformed'],
    );
  });
});

describe('findReservedFindingTypes (record-time rejection signal)', () => {
  it('reports each reserved slug used by findings[], deduped, in entry order', () => {
    const reserved = findReservedFindingTypes({
      confidence: 0.9,
      safety: CLEAN_SAFETY,
      findings: [
        { type: 'injection-detected', severity: 'warn', message: 'x' },
        { type: 'contradiction', severity: 'warn', message: 'y' },
        { type: 'injection-detected', severity: 'warn', message: 'z' },
        { type: 'content-malformed', severity: 'warn', message: 'w' },
      ],
    });
    deepStrictEqual(reserved, ['injection-detected', 'content-malformed']);
  });

  it('an all-clean findings[] reports nothing', () => {
    deepStrictEqual(
      findReservedFindingTypes({
        confidence: 0.9,
        safety: CLEAN_SAFETY,
        findings: [{ type: 'contradiction', severity: 'warn', message: 'x' }],
      }),
      [],
    );
  });

  it('the reserved set carries exactly the three spec slugs', () => {
    deepStrictEqual(
      [...RESERVED_FINDING_TYPES].sort(),
      ['content-malformed', 'content-suspicious', 'injection-detected'],
    );
  });
});
