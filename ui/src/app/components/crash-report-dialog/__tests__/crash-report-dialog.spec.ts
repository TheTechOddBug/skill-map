import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { CrashReportDialog } from '../crash-report-dialog';

/**
 * CrashReportDialog, the per-incident crash-report consent dialog
 * (spec/telemetry.md §Per-incident crash-report consent). Presentational:
 * `open`/`preview` in, one boolean `decision` out; Send is the primary
 * action (flat Yes default) and closing the dialog (X / escape / mask) is
 * a decline.
 */

function bootstrap(
  opts: { open?: boolean; preview?: string } = {},
): ComponentFixture<CrashReportDialog> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(CrashReportDialog);
  fixture.componentRef.setInput('open', opts.open ?? true);
  fixture.componentRef.setInput('preview', opts.preview ?? '');
  fixture.detectChanges();
  return fixture;
}

function inst(fixture: ComponentFixture<CrashReportDialog>): {
  accept(): void;
  decline(): void;
  onVisibleChange(v: boolean): void;
} {
  return fixture.componentInstance as unknown as {
    accept(): void;
    decline(): void;
    onVisibleChange(v: boolean): void;
  };
}

describe('CrashReportDialog', () => {
  it('emits true on send', () => {
    const fixture = bootstrap();
    const decision = vi.fn();
    fixture.componentInstance.decision.subscribe(decision);
    inst(fixture).accept();
    expect(decision).toHaveBeenCalledWith(true);
  });

  it('emits false on dismiss', () => {
    const fixture = bootstrap();
    const decision = vi.fn();
    fixture.componentInstance.decision.subscribe(decision);
    inst(fixture).decline();
    expect(decision).toHaveBeenCalledWith(false);
  });

  it('treats closing the dialog (X / escape / mask) as a decline', () => {
    const fixture = bootstrap();
    const decision = vi.fn();
    fixture.componentInstance.decision.subscribe(decision);
    inst(fixture).onVisibleChange(false);
    expect(decision).toHaveBeenCalledWith(false);
  });

  it('renders the scrubbed preview when provided', () => {
    const fixture = bootstrap({ preview: 'TypeError: boom at <HOME>/x' });
    const el: HTMLElement = fixture.nativeElement;
    const preview = el.ownerDocument.querySelector('[data-testid="crash-report-preview"]');
    expect(preview?.textContent).toContain('TypeError: boom at <HOME>/x');
  });

  it('omits the preview block when empty', () => {
    const fixture = bootstrap({ preview: '' });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.ownerDocument.querySelector('[data-testid="crash-report-preview"]')).toBeNull();
  });
});
