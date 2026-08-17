/**
 * `DismissedNotesService`: one-time notes hidden until the preferences
 * load proves them undismissed, optimistic machine-wide dismissal.
 */

import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { DismissedNotesService } from '../dismissed-notes';
import { DATA_SOURCE } from '../data-source/data-source.port';

function bootstrap(dismissed: string[] = [], reject = false) {
  const getPreferences = reject
    ? vi.fn().mockRejectedValue(new Error('demo-readonly'))
    : vi.fn().mockResolvedValue({ ui: { dismissedNotes: dismissed } });
  const setPreferences = vi.fn().mockResolvedValue({});
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: DATA_SOURCE, useValue: { getPreferences, setPreferences } }],
  });
  return { service: TestBed.inject(DismissedNotesService), getPreferences, setPreferences };
}

const settle = () => Promise.resolve().then(() => Promise.resolve());

describe('DismissedNotesService', () => {
  it('keeps notes HIDDEN until the load proves them undismissed', async () => {
    const { service } = bootstrap();
    const visible = service.visible('intro');
    expect(visible()).toBe(false); // not loaded yet: never flash
    await settle();
    expect(visible()).toBe(true);
  });

  it('an already-dismissed note stays hidden after the load', async () => {
    const { service } = bootstrap(['intro']);
    await settle();
    expect(service.visible('intro')()).toBe(false);
    expect(service.visible('other')()).toBe(true);
  });

  it('dismiss hides optimistically and persists the whole list', async () => {
    const { service, setPreferences } = bootstrap(['earlier']);
    await settle();
    service.dismiss('intro');
    expect(service.visible('intro')()).toBe(false);
    expect(setPreferences).toHaveBeenCalledWith({
      ui: { dismissedNotes: expect.arrayContaining(['earlier', 'intro']) },
    });
  });

  it('a failed load keeps every note hidden (never flash on a broken fetch)', async () => {
    const { service } = bootstrap([], true);
    await settle();
    expect(service.visible('intro')()).toBe(false);
  });
});
