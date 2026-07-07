import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { TutorialReminderBanner } from '../tutorial-reminder-banner';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../../../../services/data-source/runtime-mode';

function makeDataSource(dismissed: boolean) {
  const setSpy = vi.fn().mockResolvedValue(undefined);
  const port: Partial<IDataSourcePort> = {
    getProjectPreferences: vi.fn().mockResolvedValue({
      allowSidecarWriters: true,
      scan: { referencePaths: [], followExternalSymlinks: false, respectGitignore: false },
      pluginTrust: { projectEnabled: false },
      tutorialReminderDismissed: dismissed,
    }),
    setProjectPreferences: setSpy,
  };
  return { port, setSpy };
}

async function makeFixture(dismissed: boolean, mode: 'live' | 'demo' = 'live') {
  const { port, setSpy } = makeDataSource(dismissed);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [TutorialReminderBanner],
    providers: [
      { provide: DATA_SOURCE, useValue: port },
      { provide: SKILL_MAP_MODE, useValue: mode },
    ],
  });
  const fixture = TestBed.createComponent(TutorialReminderBanner);
  fixture.detectChanges();
  // Let the async getProjectPreferences() fired in the constructor resolve
  // before asserting visibility.
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, setSpy };
}

describe('TutorialReminderBanner', () => {
  it('shows the reminder when not dismissed', async () => {
    const { fixture } = await makeFixture(false);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="tutorial-reminder-banner"]')).not.toBeNull();
  });

  it('renders the `sm tutorial` command in a <code> element', async () => {
    const { fixture } = await makeFixture(false);
    const root = fixture.nativeElement as HTMLElement;
    const cmd = root.querySelector<HTMLElement>('[data-testid="tutorial-reminder-banner-cmd"]');
    expect(cmd?.tagName).toBe('CODE');
    expect(cmd?.textContent?.trim()).toBe('sm tutorial');
  });

  it('stays hidden when already dismissed in settings.local', async () => {
    const { fixture } = await makeFixture(true);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="tutorial-reminder-banner"]')).toBeNull();
  });

  it('stays hidden in demo mode (cannot run `sm tutorial` there)', async () => {
    const { fixture } = await makeFixture(false, 'demo');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="tutorial-reminder-banner"]')).toBeNull();
  });

  it('persists the dismissal through the data source and hides', async () => {
    const { fixture, setSpy } = await makeFixture(false);
    await fixture.componentInstance.dismiss();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="tutorial-reminder-banner"]')).toBeNull();
    expect(setSpy).toHaveBeenCalledWith({ tutorialReminderDismissed: true });
  });
});
