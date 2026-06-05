import { describe, expect, it } from 'vitest';
import { provideZonelessChangeDetection, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SettingsProject } from '../settings-project';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { ProviderRegistryService } from '../../../../services/provider-registry';
import type { IActiveProviderApi, IProviderRegistryApi } from '../../../../models/api';

/**
 * SettingsProject · active-lens dropdown gating.
 *
 * `providerOptions` maps the `providerRegistry` (every registered
 * Provider) against the active-provider envelope's `selectable` set
 * (the ids enabled right now). A Provider absent from `selectable` is
 * rendered disabled, greyed + non-selectable (`optionDisabled` in the
 * template) plus a "(disabled)" label suffix, so a disabled Provider
 * stays visible but can never be picked as the lens.
 *
 * The spec drives the component's imperative surface directly (the
 * `activeProviderEnvelope` signal + the root `ProviderRegistryService`)
 * so it stays independent of the network fetch and PrimeNG's overlay
 * portal, matching the settings-general / settings-plugins specs.
 */

interface IProjectProto {
  providerOptions(): { id: string; label: string; disabled: boolean }[];
  activeProviderEnvelope: WritableSignal<IActiveProviderApi | null>;
}

const REGISTRY: IProviderRegistryApi = {
  claude: { label: 'Claude', color: '#000000' },
  openai: { label: 'OpenAI', color: '#111111' },
  markdown: { label: 'Markdown', color: '#222222', hideChip: true },
};

function envelope(selectable: string[]): IActiveProviderApi {
  return { activeProvider: null, detected: [], source: 'none', selectable };
}

function bootstrap(): { proto: IProjectProto } {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: {} as Partial<IDataSourcePort> },
    ],
  });
  const fixture = TestBed.createComponent(SettingsProject);
  fixture.componentRef.setInput('visible', false);
  fixture.detectChanges();
  TestBed.inject(ProviderRegistryService).ingest(REGISTRY);
  const proto = fixture.componentInstance as unknown as IProjectProto;
  return { proto };
}

describe('SettingsProject providerOptions', () => {
  it('greys out nothing before the envelope loads', () => {
    const { proto } = bootstrap();
    // `activeProviderEnvelope` is still null here.
    const opts = proto.providerOptions();
    expect(opts.every((o) => !o.disabled)).toBe(true);
    // "(none)" + the three registry Providers.
    expect(opts).toHaveLength(4);
  });

  it('marks Providers absent from selectable as disabled', () => {
    const { proto } = bootstrap();
    proto.activeProviderEnvelope.set(envelope(['openai', 'markdown']));

    const byId = new Map(proto.providerOptions().map((o) => [o.id, o]));

    expect(byId.get('claude')?.disabled).toBe(true);
    expect(byId.get('claude')?.label).toBe('Claude (disabled)');
    expect(byId.get('openai')?.disabled).toBe(false);
    expect(byId.get('openai')?.label).toBe('OpenAI');
    expect(byId.get('markdown')?.disabled).toBe(false);
    // The prepended "(none)" entry is always selectable.
    expect(byId.get('')?.disabled).toBe(false);
  });

  it('keeps every Provider selectable when all are enabled', () => {
    const { proto } = bootstrap();
    proto.activeProviderEnvelope.set(envelope(['claude', 'openai', 'markdown']));
    expect(proto.providerOptions().every((o) => !o.disabled)).toBe(true);
  });
});
