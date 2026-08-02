import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { SidecarConsentDialog } from '../sidecar-consent-dialog';
import { UsageTrackerService } from '../../../services/usage-tracker';

/**
 * The `.sm` write-consent dialog's TELEMETRY contract: exactly ONE
 * `trackSidecarConsent` per showing, whatever the resolution path. The
 * `decision` output itself deliberately keeps its historical double-fire
 * on the decline path (explicit button, then the close-driven
 * `visibleChange(false)`); only the telemetry dedupes, and the guard
 * re-arms when the dialog re-opens. Driven through the component's
 * handler methods (the dialog body is a PrimeNG portal, and the guard,
 * not the widgetry, is what this spec locks).
 */

/** Typed reach into the protected handlers + checkbox model. */
interface IDialogDriver {
  accept(): void;
  decline(): void;
  onVisibleChange(visible: boolean): void;
  always: { set(value: boolean): void };
}

function setup(context: string | null = null): {
  fixture: ComponentFixture<SidecarConsentDialog>;
  driver: IDialogDriver;
  trackSidecarConsent: ReturnType<typeof vi.fn>;
} {
  TestBed.resetTestingModule();
  const trackSidecarConsent = vi.fn();
  TestBed.configureTestingModule({
    imports: [SidecarConsentDialog],
    providers: [
      provideZonelessChangeDetection(),
      { provide: UsageTrackerService, useValue: { trackSidecarConsent } },
    ],
  });
  const fixture = TestBed.createComponent(SidecarConsentDialog);
  fixture.componentRef.setInput('open', true);
  fixture.componentRef.setInput('context', context);
  TestBed.tick(); // run the reset-on-open effect
  const driver = fixture.componentInstance as unknown as IDialogDriver;
  return { fixture, driver, trackSidecarConsent };
}

describe('SidecarConsentDialog, sidecar-consent telemetry', () => {
  it('accept without the checkbox reports once', () => {
    const { driver, trackSidecarConsent } = setup();
    driver.accept();
    expect(trackSidecarConsent).toHaveBeenCalledTimes(1);
    expect(trackSidecarConsent).toHaveBeenCalledWith('once', null);
  });

  it('accept with the always-allow checkbox reports always', () => {
    const { driver, trackSidecarConsent } = setup();
    driver.always.set(true);
    driver.accept();
    expect(trackSidecarConsent).toHaveBeenCalledWith('always', null);
  });

  it('threads the parked context through to the event', () => {
    const { driver, trackSidecarConsent } = setup('core/node-set-tags');
    driver.accept();
    expect(trackSidecarConsent).toHaveBeenCalledWith('once', 'core/node-set-tags');
  });

  it('the decline double-fire (button + close) reports exactly once', () => {
    const { driver, trackSidecarConsent } = setup();
    driver.decline();
    // PrimeNG fires visibleChange(false) when the host closes the dialog,
    // which routes into decline() a second time.
    driver.onVisibleChange(false);
    expect(trackSidecarConsent).toHaveBeenCalledTimes(1);
    expect(trackSidecarConsent).toHaveBeenCalledWith('declined', null);
  });

  it('re-opening re-arms the guard and resets the checkbox', () => {
    const { fixture, driver, trackSidecarConsent } = setup();
    driver.always.set(true);
    driver.accept();
    expect(trackSidecarConsent).toHaveBeenNthCalledWith(1, 'always', null);

    fixture.componentRef.setInput('open', false);
    TestBed.tick();
    fixture.componentRef.setInput('open', true);
    TestBed.tick();

    // The prior tick must not leak into the next, unrelated consent.
    driver.accept();
    expect(trackSidecarConsent).toHaveBeenCalledTimes(2);
    expect(trackSidecarConsent).toHaveBeenNthCalledWith(2, 'once', null);
  });
});
