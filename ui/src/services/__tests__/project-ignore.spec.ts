import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DATA_SOURCE, type IDataSourcePort } from '../data-source/data-source.port';
import { SKILL_MAP_MODE, type TSkillMapMode } from '../data-source/runtime-mode';
import { ProjectIgnoreService, toIgnorePattern } from '../project-ignore';

/**
 * `ProjectIgnoreService`, the owner of the Ignore gesture (append to
 * `.skillmapignore` behind the confirm dialog). Pins the dialog /
 * auto / duplicate / unavailable dispositions, the don't-ask-again
 * persistence, the write serialization (the replace-list PATCH races
 * without it), and the error surfacing.
 */

interface IStubOpts {
  confirmIgnore?: boolean;
  patterns?: string[];
  mode?: TSkillMapMode;
}

interface IHarness {
  service: ProjectIgnoreService;
  getProjectPreferences: ReturnType<typeof vi.fn>;
  setProjectPreferences: ReturnType<typeof vi.fn>;
  getProjectIgnore: ReturnType<typeof vi.fn>;
  setProjectIgnore: ReturnType<typeof vi.fn>;
}

function bootstrap(opts: IStubOpts = {}): IHarness {
  const patterns = opts.patterns ?? [];
  const getProjectPreferences = vi
    .fn()
    .mockResolvedValue({ ui: { confirmIgnore: opts.confirmIgnore ?? true } });
  const setProjectPreferences = vi.fn().mockResolvedValue({});
  const getProjectIgnore = vi.fn().mockResolvedValue({ patterns });
  const setProjectIgnore = vi
    .fn()
    .mockImplementation((patch: { patterns: string[] }) =>
      Promise.resolve({ patterns: patch.patterns }),
    );
  const stub = {
    getProjectPreferences,
    setProjectPreferences,
    getProjectIgnore,
    setProjectIgnore,
  } as unknown as IDataSourcePort;

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: DATA_SOURCE, useValue: stub },
      { provide: SKILL_MAP_MODE, useValue: opts.mode ?? 'live' },
    ],
  });
  return {
    service: TestBed.inject(ProjectIgnoreService),
    getProjectPreferences,
    setProjectPreferences,
    getProjectIgnore,
    setProjectIgnore,
  };
}

/** Let the fire-and-forget write chain settle. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('toIgnorePattern', () => {
  it('root-anchors files and adds the trailing slash for folders', () => {
    expect(toIgnorePattern('docs/notes.md', 'file')).toBe('/docs/notes.md');
    expect(toIgnorePattern('docs/guides', 'folder')).toBe('/docs/guides/');
    expect(toIgnorePattern('README.md', 'file')).toBe('/README.md');
  });
});

describe('ProjectIgnoreService', () => {
  it('opens the dialog with the full target while confirmation is on', async () => {
    const { service, setProjectIgnore } = bootstrap();
    const outcome = await service.requestIgnore('docs/notes.md', 'file', 'files');
    expect(outcome).toBe('dialog');
    expect(service.dialogOpen()).toBe(true);
    expect(service.dialogTarget()).toEqual({
      path: 'docs/notes.md',
      kind: 'file',
      source: 'files',
      pattern: '/docs/notes.md',
    });
    expect(setProjectIgnore).not.toHaveBeenCalled();
  });

  it('writes directly (auto) while confirmation is suppressed', async () => {
    const { service, setProjectIgnore } = bootstrap({
      confirmIgnore: false,
      patterns: ['/existing.md'],
    });
    const outcome = await service.requestIgnore('docs/notes.md', 'file', 'files');
    expect(outcome).toBe('auto');
    expect(service.dialogOpen()).toBe(false);
    await settled();
    expect(setProjectIgnore).toHaveBeenCalledWith({
      patterns: ['/existing.md', '/docs/notes.md'],
    });
  });

  it('an already-present pattern resolves duplicate: no dialog, no PATCH', async () => {
    const { service, setProjectIgnore } = bootstrap({ patterns: ['/docs/notes.md'] });
    const outcome = await service.requestIgnore('docs/notes.md', 'file', 'files');
    expect(outcome).toBe('duplicate');
    expect(service.dialogOpen()).toBe(false);
    expect(setProjectIgnore).not.toHaveBeenCalled();
  });

  it('an accepted decision appends; a decline writes nothing', async () => {
    const { service, setProjectIgnore } = bootstrap();
    await service.requestIgnore('docs/guides', 'folder', 'files');
    service.resolveDecision({ accepted: true, always: false });
    await settled();
    expect(setProjectIgnore).toHaveBeenCalledWith({ patterns: ['/docs/guides/'] });
    expect(service.dialogOpen()).toBe(false);

    await service.requestIgnore('docs/notes.md', 'file', 'files');
    service.resolveDecision({ accepted: false, always: false });
    await settled();
    expect(setProjectIgnore).toHaveBeenCalledTimes(1);
  });

  it('a second resolution of the same showing is a no-op (structural dedupe)', async () => {
    const { service, setProjectIgnore } = bootstrap();
    await service.requestIgnore('docs/notes.md', 'file', 'files');
    service.resolveDecision({ accepted: false, always: false });
    // The close-driven visibleChange fires a second decline; and even a
    // late "accept" must find no target to act on.
    service.resolveDecision({ accepted: true, always: false });
    await settled();
    expect(setProjectIgnore).not.toHaveBeenCalled();
  });

  it('always persists the suppression and skips the dialog from then on', async () => {
    const { service, setProjectPreferences, getProjectPreferences, setProjectIgnore } =
      bootstrap();
    await service.requestIgnore('a.md', 'file', 'files');
    service.resolveDecision({ accepted: true, always: true });
    await settled();
    expect(setProjectPreferences).toHaveBeenCalledWith({ ui: { confirmIgnore: false } });
    expect(setProjectIgnore).toHaveBeenCalledTimes(1);

    // Cached pref: no second preferences fetch, direct write.
    const outcome = await service.requestIgnore('b.md', 'file', 'inspector');
    expect(outcome).toBe('auto');
    expect(getProjectPreferences).toHaveBeenCalledTimes(1);
    await settled();
    expect(setProjectIgnore).toHaveBeenCalledTimes(2);
  });

  it('a failed write surfaces errorText; clearError clears it', async () => {
    const { service, setProjectIgnore } = bootstrap({ confirmIgnore: false });
    setProjectIgnore.mockRejectedValueOnce(new Error('disk full'));
    await service.requestIgnore('a.md', 'file', 'files');
    await settled();
    expect(service.errorText()).toBe('disk full');
    service.clearError();
    expect(service.errorText()).toBeNull();
  });

  it('serializes overlapping writes so the second append folds the first in', async () => {
    const { service, getProjectIgnore, setProjectIgnore } = bootstrap({
      confirmIgnore: false,
    });
    // The service re-reads inside each chain link; make the stub return
    // whatever the previous write persisted.
    let stored: string[] = [];
    getProjectIgnore.mockImplementation(() => Promise.resolve({ patterns: [...stored] }));
    setProjectIgnore.mockImplementation((patch: { patterns: string[] }) => {
      stored = patch.patterns;
      return Promise.resolve({ patterns: [...stored] });
    });

    await service.requestIgnore('a.md', 'file', 'files');
    await service.requestIgnore('b.md', 'file', 'files');
    await settled();
    await settled();
    expect(stored).toEqual(['/a.md', '/b.md']);
  });

  it('demo mode is inert: unavailable, zero data-source calls', async () => {
    const { service, getProjectIgnore, getProjectPreferences } = bootstrap({ mode: 'demo' });
    expect(service.available()).toBe(false);
    const outcome = await service.requestIgnore('a.md', 'file', 'files');
    expect(outcome).toBe('unavailable');
    expect(getProjectIgnore).not.toHaveBeenCalled();
    expect(getProjectPreferences).not.toHaveBeenCalled();
  });
});
