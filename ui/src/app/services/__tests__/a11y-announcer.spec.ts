import { describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { LiveAnnouncer } from '@angular/cdk/a11y';

import { A11yAnnouncerService } from '../a11y-announcer';

/**
 * `A11yAnnouncerService`, the thin wrapper over CDK's `LiveAnnouncer`
 * used at every async lifecycle point (scan / queue / findings). Covers:
 * the polite default and the explicit assertive override forward to CDK.
 */
describe('A11yAnnouncerService', () => {
  function setup(): { service: A11yAnnouncerService; announce: ReturnType<typeof vi.fn> } {
    const announce = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        A11yAnnouncerService,
        { provide: LiveAnnouncer, useValue: { announce } },
      ],
    });
    return { service: TestBed.inject(A11yAnnouncerService), announce };
  }

  it('announces politely by default', () => {
    const { service, announce } = setup();
    service.announce('Scan complete.');
    expect(announce).toHaveBeenCalledWith('Scan complete.', 'polite');
  });

  it('forwards an explicit assertive politeness', () => {
    const { service, announce } = setup();
    service.announce('Scan failed.', 'assertive');
    expect(announce).toHaveBeenCalledWith('Scan failed.', 'assertive');
  });
});
