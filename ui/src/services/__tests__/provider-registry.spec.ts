import { describe, expect, it } from 'vitest';

import { ProviderRegistryService } from '../provider-registry';
import type { IProviderRegistryApi } from '../../models/api';

const REGISTRY: IProviderRegistryApi = {
  claude: { label: 'Claude', color: '#cc785c', colorDark: '#e89270', isLens: true },
  openai: { label: 'OpenAI Codex', color: '#22c55e', colorDark: '#4ade80', isLens: true },
  // The non-gated base: kept in the registry for chip lookups, `isLens:
  // false` so the dropdown (filtered elsewhere) never lists it.
  markdown: {
    label: 'Markdown',
    color: '#9ca3af',
    colorDark: '#6b7280',
    isLens: false,
    hideChip: true,
  },
};

function seed(): ProviderRegistryService {
  const svc = new ProviderRegistryService();
  svc.ingest(REGISTRY);
  return svc;
}

describe('ProviderRegistryService', () => {
  it('ingests entries preserving id order', () => {
    const svc = seed();
    expect(svc.providers().map((p) => p.id)).toEqual(['claude', 'openai', 'markdown']);
  });

  it('lookup returns the entry with its id', () => {
    const svc = seed();
    expect(svc.lookup('claude')).toMatchObject({ id: 'claude', label: 'Claude' });
    expect(svc.lookup('nope')).toBeUndefined();
  });

  it('ingest is a no-op for null / undefined / structurally-equal payloads', () => {
    const svc = seed();
    const before = svc.providers();
    svc.ingest(null);
    svc.ingest(undefined);
    svc.ingest(REGISTRY);
    expect(svc.providers()).toBe(before); // same reference, signal did not fire
  });

  describe('cardChip', () => {
    it('returns label + colors for a known, non-hidden provider', () => {
      expect(seed().cardChip('claude')).toEqual({
        label: 'Claude',
        color: '#cc785c',
        colorDark: '#e89270',
      });
    });

    it('returns null for a hideChip provider (markdown)', () => {
      expect(seed().cardChip('markdown')).toBeNull();
    });

    it('returns null for empty / nullish provider id', () => {
      expect(seed().cardChip(null)).toBeNull();
      expect(seed().cardChip(undefined)).toBeNull();
      expect(seed().cardChip('')).toBeNull();
    });

    it('falls back to a neutral gray chip with the raw id for unknown providers', () => {
      expect(seed().cardChip('cursor')).toEqual({
        label: 'cursor',
        color: '#9ca3af',
        colorDark: '#6b7280',
      });
    });
  });

  describe('lensChip', () => {
    it('renders even a hideChip entry (it ignores hideChip, unlike cardChip)', () => {
      expect(seed().lensChip('markdown')).toEqual({
        label: 'Markdown',
        color: '#9ca3af',
        colorDark: '#6b7280',
      });
    });

    it('returns null only when there is no active lens', () => {
      expect(seed().lensChip(null)).toBeNull();
      expect(seed().lensChip('claude')).toMatchObject({ label: 'Claude' });
    });

    it('falls back to gray + raw id for an unknown lens', () => {
      expect(seed().lensChip('gemini')).toEqual({
        label: 'gemini',
        color: '#9ca3af',
        colorDark: '#6b7280',
      });
    });
  });
});
