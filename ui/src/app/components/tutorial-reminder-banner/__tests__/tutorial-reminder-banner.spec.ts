import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { TutorialReminderBanner } from '../tutorial-reminder-banner';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../../services/data-source/data-source.port';
import { SKILL_MAP_MODE } from '../../../../services/data-source/runtime-mode';

function makeDataSource(step: number) {
  const setSpy = vi.fn().mockResolvedValue(undefined);
  const port: Partial<IDataSourcePort> = {
    getProjectPreferences: vi.fn().mockResolvedValue({
      allowSidecarWriters: true,
      scan: { referencePaths: [], followExternalSymlinks: false, respectGitignore: false },
      tutorialReminderStep: step,
    }),
    setProjectPreferences: setSpy,
  };
  return { port, setSpy };
}

async function makeFixture(step: number, mode: 'live' | 'demo' = 'live') {
  const { port, setSpy } = makeDataSource(step);
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
  it('shows the step-0 Quick Start nudge (no dismiss recorded yet)', async () => {
    const { fixture } = await makeFixture(0);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="tutorial-reminder-banner"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="tutorial-reminder-banner-cmd"]')).toBeNull();
    expect(root.textContent).toContain('Quick Start');
  });

  it('shows the step-1 `sm tutorial` nudge, with the command in a <code> element', async () => {
    const { fixture } = await makeFixture(1);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="tutorial-reminder-banner"]')).not.toBeNull();
    const cmd = root.querySelector<HTMLElement>('[data-testid="tutorial-reminder-banner-cmd"]');
    expect(cmd?.tagName).toBe('CODE');
    expect(cmd?.textContent?.trim()).toBe('sm tutorial');
  });

  it('stays hidden once fully dismissed (step 2) in settings.local', async () => {
    const { fixture } = await makeFixture(2);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="tutorial-reminder-banner"]')).toBeNull();
  });

  it('stays hidden in demo mode (cannot run `sm tutorial` there)', async () => {
    const { fixture } = await makeFixture(0, 'demo');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="tutorial-reminder-banner"]')).toBeNull();
  });

  it('dismissing step 0 advances to step 1 and hides for this session', async () => {
    const { fixture, setSpy } = await makeFixture(0);
    await fixture.componentInstance.dismiss();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="tutorial-reminder-banner"]')).toBeNull();
    expect(setSpy).toHaveBeenCalledWith({ tutorialReminderStep: 1 });
  });

  it('dismissing step 1 advances to step 2 (fully dismissed)', async () => {
    const { fixture, setSpy } = await makeFixture(1);
    await fixture.componentInstance.dismiss();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="tutorial-reminder-banner"]')).toBeNull();
    expect(setSpy).toHaveBeenCalledWith({ tutorialReminderStep: 2 });
  });

  /**
   * Builds the fixture WITHOUT the initial `detectChanges()` / settle
   * `makeFixture` does, so the test can `subscribe()` to the output
   * before the constructor's `effect()` fires its first emission (an
   * `output()` subscriber attached after the fact misses whatever
   * already fired).
   */
  function makeUnsettledFixture(step: number, mode: 'live' | 'demo' = 'live') {
    const { port, setSpy } = makeDataSource(step);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TutorialReminderBanner],
      providers: [
        { provide: DATA_SOURCE, useValue: port },
        { provide: SKILL_MAP_MODE, useValue: mode },
      ],
    });
    const fixture = TestBed.createComponent(TutorialReminderBanner);
    return { fixture, setSpy };
  }

  it('emits quickStartMentioned(true) only on step 0, not on step 1 or fully dismissed', async () => {
    const step0 = makeUnsettledFixture(0);
    const step0Spy = vi.fn();
    step0.fixture.componentInstance.quickStartMentioned.subscribe(step0Spy);
    step0.fixture.detectChanges();
    await step0.fixture.whenStable();
    step0.fixture.detectChanges();
    expect(step0Spy).toHaveBeenCalledWith(true);

    const step1 = makeUnsettledFixture(1);
    const step1Spy = vi.fn();
    step1.fixture.componentInstance.quickStartMentioned.subscribe(step1Spy);
    step1.fixture.detectChanges();
    await step1.fixture.whenStable();
    step1.fixture.detectChanges();
    expect(step1Spy).toHaveBeenCalledWith(false);

    const step2 = makeUnsettledFixture(2);
    const step2Spy = vi.fn();
    step2.fixture.componentInstance.quickStartMentioned.subscribe(step2Spy);
    step2.fixture.detectChanges();
    await step2.fixture.whenStable();
    step2.fixture.detectChanges();
    expect(step2Spy).toHaveBeenCalledWith(false);
  });
});
