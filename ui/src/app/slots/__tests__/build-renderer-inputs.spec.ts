import { describe, expect, it } from 'vitest';

import { buildRendererInputs } from '../build-renderer-inputs';
import type { TSlotId } from '../slot-config';
import type { IContributionApi, IContributionsRegistryEntryApi } from '../../../models/api';

/**
 * `buildRendererInputs` projects a persisted contribution + its registry
 * entry into the `IRendererInputs` a slot renderer consumes. Shared by
 * `view-contributions-host` and `inspector-plugin-sections`.
 */

function contribution(overrides: Partial<IContributionApi> = {}): IContributionApi {
  return {
    pluginId: 'acme',
    extensionId: 'metrics',
    contributionId: 'summary',
    nodePath: 'skills/alpha/SKILL.md',
    slot: 'inspector.body.panel.key-values',
    payload: { entries: [{ key: 'k', value: 'v' }] },
    ...overrides,
  };
}

function registryEntry(
  overrides: Partial<IContributionsRegistryEntryApi> = {},
): IContributionsRegistryEntryApi {
  return {
    pluginId: 'acme',
    extensionId: 'metrics',
    contributionId: 'summary',
    slot: 'inspector.body.panel.key-values',
    emitWhenEmpty: false,
    ...overrides,
  };
}

const KV_SLOT: TSlotId = 'inspector.body.panel.key-values';

describe('buildRendererInputs', () => {
  it('threads identity + payload + nodePath through unchanged', () => {
    const c = contribution();
    const out = buildRendererInputs(c, KV_SLOT, 'skills/alpha/SKILL.md', undefined);
    expect(out.pluginId).toBe('acme');
    expect(out.extensionId).toBe('metrics');
    expect(out.contributionId).toBe('summary');
    expect(out.nodePath).toBe('skills/alpha/SKILL.md');
    expect(out.payload).toEqual({ entries: [{ key: 'k', value: 'v' }] });
  });

  it('maps the manifest label / tooltip / icon / emptyText from the registry entry', () => {
    const out = buildRendererInputs(
      contribution(),
      KV_SLOT,
      'p',
      registryEntry({ label: 'Summary', tooltip: 'tip', icon: 'pi-list', emptyText: 'none' }),
    );
    expect(out.label).toBe('Summary');
    expect(out.tooltip).toBe('tip');
    expect(out.icon).toBe('pi-list');
    expect(out.emptyText).toBe('none');
  });

  it('omits the manifest fields when there is no registry entry', () => {
    const out = buildRendererInputs(contribution(), KV_SLOT, 'p', undefined);
    expect(out.label).toBeUndefined();
    expect(out.icon).toBeUndefined();
    expect(out.tooltip).toBeUndefined();
    expect(out.emptyText).toBeUndefined();
  });

  it('retains payload severity for a severity-respecting slot', () => {
    // `card.footer.left` sets respectSeverity: true, so severity is kept.
    const c = contribution({
      slot: 'card.footer.left',
      payload: { value: 3, severity: 'warn' },
    });
    const out = buildRendererInputs(c, 'card.footer.left', 'p', undefined);
    expect(out.payload).toEqual({ value: 3, severity: 'warn' });
  });
});
