/**
 * `[smToggleRow]` forwards a click anywhere on a Settings row to the
 * row's boolean switch. The subtle case these specs exist for is the
 * DOUBLE toggle: a `<label for>` already forwards natively, so a
 * directive that also forwarded would flip the value twice and land
 * back where it started, which reads as "the row does not respond".
 */

import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TestBed } from '@angular/core/testing';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { describe, expect, it } from 'vitest';

import { ToggleRowDirective } from '../toggle-row.directive';

@Component({
  imports: [FormsModule, ToggleSwitchModule, ToggleRowDirective],
  template: `<div smToggleRow class="row" data-testid="row">
    <div class="text">
      <label for="t" data-testid="label">Label</label>
      <div class="desc" data-testid="desc">Description prose</div>
      <button type="button" data-testid="inner-btn">inner</button>
    </div>
    <p-toggleswitch
      inputId="t"
      [ngModel]="value()"
      (ngModelChange)="value.set($event)"
      [disabled]="locked()"
      data-testid="switch"
    />
  </div>`,
})
class HostComponent {
  readonly value = signal(false);
  readonly locked = signal(false);
}

describe('ToggleRowDirective', () => {
  function boot(): { host: HostComponent; el: HTMLElement; flush: () => void } {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return {
      host: fixture.componentInstance,
      el: fixture.nativeElement as HTMLElement,
      flush: () => fixture.detectChanges(),
    };
  }

  function click(el: HTMLElement, testid: string): void {
    el.querySelector<HTMLElement>(`[data-testid="${testid}"]`)?.click();
  }

  it('flips the switch when the row background is clicked', () => {
    const { host, el, flush } = boot();
    click(el, 'row');
    flush();
    expect(host.value()).toBe(true);
  });

  it('flips it from the description text too', () => {
    const { host, el, flush } = boot();
    click(el, 'desc');
    flush();
    expect(host.value()).toBe(true);
  });

  it('does NOT double-flip when the label is clicked', () => {
    // The label's native `for` forwarding already reaches the switch;
    // forwarding again would toggle twice and appear inert.
    const { host, el, flush } = boot();
    click(el, 'label');
    flush();
    expect(host.value()).toBe(true);
  });

  it('does not flip when the switch itself is clicked', () => {
    const { host, el, flush } = boot();
    click(el, 'switch');
    flush();
    expect(host.value()).toBe(true);
  });

  it('leaves other controls in the row alone', () => {
    // A button inside a row does its own job; the row must not also
    // toggle behind it.
    const { host, el, flush } = boot();
    click(el, 'inner-btn');
    flush();
    expect(host.value()).toBe(false);
  });

  it('respects a disabled switch', () => {
    // The guard lives in PrimeNG's own `onClick`, so this pins that we
    // are still routing through it rather than setting state ourselves.
    const { host, el, flush } = boot();
    host.locked.set(true);
    flush();
    click(el, 'row');
    flush();
    expect(host.value()).toBe(false);
  });

  it('toggles back on a second click', () => {
    const { host, el, flush } = boot();
    click(el, 'row');
    flush();
    click(el, 'row');
    flush();
    expect(host.value()).toBe(false);
  });
});
