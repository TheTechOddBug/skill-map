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
  let getSessionJournal: ReturnType<typeof vi.fn>;

  async function mount(
    journalSessions: number,
  ): Promise<import('@angular/core/testing').ComponentFixture<Host>> {
    getSessionJournal = vi
      .fn()
      .mockResolvedValue({ sessions: Array(journalSessions).fill({}), recording: false, captureLevel: 'mcp' });
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
            hookInstalled: signal(true).asReadonly(),
            refresh: vi.fn().mockResolvedValue(undefined),
          } as unknown as ActivityReadinessService,
        },
        { provide: DATA_SOURCE, useValue: { getSessionJournal } },
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
