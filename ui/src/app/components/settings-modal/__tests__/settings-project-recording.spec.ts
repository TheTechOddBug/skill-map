/**
 * The Settings > Project "Session recording" row: the readout and the
 * full delete must reflect BOTH memories (browser tape + project
 * journal). Pinned after the 2026-08-17 field bug: the replay trash
 * went tape-only, the row kept reading only the tape, so an empty tape
 * hid the journal files and disabled the delete that was supposed to
 * erase them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';

import { SettingsProjectRealtime } from '../settings-project-realtime';
import { DATA_SOURCE } from '../../../../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../../../../services/data-source/runtime-mode';
import { ActivityRecorderService } from '../../../../services/activity-recorder';
import { SessionPurgeService } from '../../../../services/session-purge';
import { ActivityReadinessService } from '../../../services/activity-readiness';

@Component({
  imports: [SettingsProjectRealtime],
  template: '<sm-settings-project-realtime [visible]="visible()" />',
})
class Host {
  readonly visible = signal(true);
}

function query(testid: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${testid}"]`);
}

describe('SettingsProjectRealtime recording row', () => {
  const tapeSize = signal(0);
  const storedChars = signal(0);
  const purge = vi.fn();
  const setCaptureLevel = vi.fn((level: string) => Promise.resolve(level));
  let getSessionJournal: ReturnType<typeof vi.fn>;

  async function mount(
    journalSessions: number,
    shellCapture = false,
    hookInstalled: boolean | null = true,
    lens: { id: string | null; shellOptIn: boolean | null } = { id: 'claude', shellOptIn: true },
  ): Promise<import('@angular/core/testing').ComponentFixture<Host>> {
    getSessionJournal = vi
      .fn()
      .mockResolvedValue({ sessions: Array(journalSessions).fill({}), recording: false, captureLevel: 'mcp', shellCapture });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivityRecorderService,
          useValue: {
            size: tapeSize.asReadonly(),
            storedChars: storedChars.asReadonly(),
            recording: signal(false).asReadonly(),
          } as unknown as ActivityRecorderService,
        },
        { provide: SessionPurgeService, useValue: { purge } },
        {
          provide: ActivityReadinessService,
          useValue: {
            hookInstalled: signal(hookInstalled).asReadonly(),
            lensId: signal(lens.id).asReadonly(),
            shellOptIn: signal(lens.shellOptIn).asReadonly(),
            refresh: vi.fn().mockResolvedValue(undefined),
          } as unknown as ActivityReadinessService,
        },
        { provide: DATA_SOURCE, useValue: { getSessionJournal, setCaptureLevel } },
        { provide: SKILL_MAP_MODE, useValue: 'demo' },
      ],
    });
    const fixture = TestBed.createComponent(Host);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    tapeSize.set(0);
    storedChars.set(0);
    purge.mockClear();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('journal files alone keep the readout honest and the delete ENABLED (the field bug)', async () => {
    await mount(21);
    expect(query('settings-project-recording-summary')?.textContent).toContain(
      '21 session files in the project',
    );
    const button = query('settings-project-recording-delete')?.querySelector('button');
    expect(button?.disabled).toBe(false);
  });

  it('both memories list side by side; the tape half carries the size', async () => {
    tapeSize.set(1240);
    storedChars.set(380 * 1024);
    await mount(3);
    const summary = query('settings-project-recording-summary')?.textContent ?? '';
    expect(summary).toContain('1,240 events, 380 KB in this browser');
    expect(summary).toContain('3 session files in the project');
  });

  it('nothing anywhere: empty copy and the delete disabled', async () => {
    await mount(0);
    expect(query('settings-project-recording-summary')?.textContent).toContain(
      'Nothing recorded yet.',
    );
    const button = query('settings-project-recording-delete')?.querySelector('button');
    expect(button?.disabled).toBe(true);
  });

  it('the shell unlock line shows the opt-in command until the opt-in is on', async () => {
    await mount(0);
    expect(query('settings-project-shell-unlock-hint')).toBeTruthy();
    expect(query('settings-project-shell-unlock-command')?.textContent).toContain(
      'sm activity install claude --shell',
    );
    expect(query('settings-project-shell-unlock-copy')).toBeTruthy();
  });

  it('a KNOWN-missing hook disables the capture ladder: hint shown, unlock line gone', async () => {
    await mount(0, false, false);
    expect(query('settings-project-capture-level-hook-hint')).toBeTruthy();
    expect(query('settings-project-shell-unlock-hint')).toBeNull();
    expect(query('settings-project-shell-unlock-command')).toBeNull();
    // Behavioral disable (PrimeNG renders togglebuttons, not native
    // buttons): clicking an option must not reach the service.
    setCaptureLevel.mockClear();
    const option = query('capture-level-selector')?.querySelectorAll('p-togglebutton')[0] as
      | HTMLElement
      | undefined;
    expect(option).toBeTruthy();
    option!.click();
    (option!.querySelector('span') as HTMLElement | null)?.click();
    expect(setCaptureLevel).not.toHaveBeenCalled();
  });

  it('once opted in the hint flips but the snippet keeps the OPT-IN command', async () => {
    await mount(0, true);
    expect(query('settings-project-shell-unlock-hint')?.textContent).toContain('opted in');
    expect(query('settings-project-shell-unlock-command')?.textContent?.trim()).toBe(
      'sm activity install claude --shell',
    );
  });

  it('the unlock command names the ACTIVE lens, not a hardcoded provider', async () => {
    await mount(0, false, true, { id: 'my-fork', shellOptIn: true });
    expect(query('settings-project-shell-unlock-command')?.textContent?.trim()).toBe(
      'sm activity install my-fork --shell',
    );
  });

  it('a lens without the shell opt-in event gets the unavailable line, no command, no copy', async () => {
    await mount(0, false, true, { id: 'my-dropin', shellOptIn: false });
    expect(query('settings-project-shell-unlock-hint')?.textContent).toContain(
      'my-dropin runtime exposes no shell hook',
    );
    expect(query('settings-project-shell-unlock-command')).toBeNull();
    expect(query('settings-project-shell-unlock-copy')).toBeNull();
  });

  it('an unresolved lens probe renders no unlock line at all (never a wrong provider)', async () => {
    await mount(0, false, true, { id: null, shellOptIn: null });
    expect(query('settings-project-shell-unlock-hint')).toBeNull();
    expect(query('settings-project-shell-unlock-command')).toBeNull();
  });

  it('the confirmed delete purges both memories and zeroes the journal half optimistically', async () => {
    const fixture = await mount(2);
    (
      query('settings-project-recording-delete')?.querySelector('button') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    // Confirm dialog on screen; accept it.
    const accept = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Delete both'),
    );
    expect(accept).toBeTruthy();
    accept!.click();
    fixture.detectChanges();
    expect(purge).toHaveBeenCalledTimes(1);
    const fixtureSummary = query('settings-project-recording-summary')?.textContent ?? '';
    expect(fixtureSummary).toContain('Nothing recorded yet.');
  });
});
