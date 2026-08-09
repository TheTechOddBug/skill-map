import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { IgnoreConfirmDialog } from '../ignore-confirm-dialog';
import type { IIgnoreTarget } from '../../../../services/project-ignore';
import { UsageTrackerService } from '../../../services/usage-tracker';

/**
 * `<sm-ignore-confirm-dialog>`: the `decision` output contract, the
 * per-showing `ignore-path` telemetry dedupe (mirror of the sidecar
 * dialog's guard), the reset-on-reopen, and the per-kind copy. DOM is
 * asserted through `document.body` because `appendTo="body"` portals
 * the dialog content outside the fixture host.
 */

interface IDialogDriver {
  accept(): void;
  decline(): void;
  onVisibleChange(visible: boolean): void;
  always: { set(value: boolean): void };
}

function makeTarget(kind: 'file' | 'folder' = 'file'): IIgnoreTarget {
  return kind === 'file'
    ? { path: 'docs/notes.md', kind, source: 'files', pattern: '/docs/notes.md' }
    : { path: 'docs/guides', kind, source: 'inspector', pattern: '/docs/guides/' };
}

function setup(target: IIgnoreTarget = makeTarget()): {
  fixture: ComponentFixture<IgnoreConfirmDialog>;
  driver: IDialogDriver;
  decisions: unknown[];
  trackFeature: ReturnType<typeof vi.fn>;
} {
  TestBed.resetTestingModule();
  const trackFeature = vi.fn();
  TestBed.configureTestingModule({
    imports: [IgnoreConfirmDialog],
    providers: [
      provideZonelessChangeDetection(),
      { provide: UsageTrackerService, useValue: { trackFeature } },
    ],
  });
  const fixture = TestBed.createComponent(IgnoreConfirmDialog);
  fixture.componentRef.setInput('open', true);
  fixture.componentRef.setInput('target', target);
  const decisions: unknown[] = [];
  fixture.componentInstance.decision.subscribe((d) => decisions.push(d));
  TestBed.tick(); // run the reset-on-open effect
  fixture.detectChanges();
  const driver = fixture.componentInstance as unknown as IDialogDriver;
  return { fixture, driver, decisions, trackFeature };
}

describe('IgnoreConfirmDialog', () => {
  it('accept without the checkbox emits {accepted, always:false} and reports once', () => {
    const { driver, decisions, trackFeature } = setup();
    driver.accept();
    expect(decisions).toEqual([{ accepted: true, always: false }]);
    expect(trackFeature).toHaveBeenCalledTimes(1);
    expect(trackFeature).toHaveBeenCalledWith('ignore-path', 'once', 'files');
  });

  it('accept with the checkbox emits always:true and reports always', () => {
    const { driver, decisions, trackFeature } = setup();
    driver.always.set(true);
    driver.accept();
    expect(decisions).toEqual([{ accepted: true, always: true }]);
    expect(trackFeature).toHaveBeenCalledWith('ignore-path', 'always', 'files');
  });

  it('the decline double-fire (button + close) reports exactly once', () => {
    const { driver, decisions, trackFeature } = setup(makeTarget('folder'));
    driver.decline();
    driver.onVisibleChange(false);
    // The output keeps the double-fire (the service dedupes structurally);
    // only the telemetry guard collapses it.
    expect(decisions).toEqual([
      { accepted: false, always: false },
      { accepted: false, always: false },
    ]);
    expect(trackFeature).toHaveBeenCalledTimes(1);
    expect(trackFeature).toHaveBeenCalledWith('ignore-path', 'declined', 'inspector');
  });

  it('re-opening re-arms the guard and resets the checkbox', () => {
    const { fixture, driver, trackFeature } = setup();
    driver.always.set(true);
    driver.accept();
    expect(trackFeature).toHaveBeenNthCalledWith(1, 'ignore-path', 'always', 'files');

    fixture.componentRef.setInput('open', false);
    TestBed.tick();
    fixture.componentRef.setInput('open', true);
    TestBed.tick();

    driver.accept();
    expect(trackFeature).toHaveBeenCalledTimes(2);
    expect(trackFeature).toHaveBeenNthCalledWith(2, 'ignore-path', 'once', 'files');
  });

  it('renders the file copy and the root-anchored pattern', () => {
    setup();
    const body = document.body.querySelector('[data-testid="ignore-confirm-body"]');
    expect(body?.textContent).toContain('file');
    const pattern = document.body.querySelector('[data-testid="ignore-confirm-pattern"]');
    expect(pattern?.textContent).toBe('/docs/notes.md');
  });

  it('renders the folder copy for a folder target', () => {
    setup(makeTarget('folder'));
    const body = document.body.querySelector('[data-testid="ignore-confirm-body"]');
    expect(body?.textContent).toContain('folder');
    const pattern = document.body.querySelector('[data-testid="ignore-confirm-pattern"]');
    expect(pattern?.textContent).toBe('/docs/guides/');
  });
});
