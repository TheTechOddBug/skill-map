import { describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { ActionPromptDialog } from '../action-prompt-dialog';
import type {
  IInputTypeDescriptor,
  TInputTypeValue,
} from '../../input-type-control/input-type-control';

/**
 * ActionPromptDialog, the parametrized-action input prompt the
 * NodeActionButton defers. It owns the `<p-dialog>` + the input-type
 * control, seeds the collected value per the input-type when it opens,
 * and reports the user's choice through `confirmed` / `closed`.
 */

function bootstrap(
  descriptor: IInputTypeDescriptor,
  open = true,
): ComponentFixture<ActionPromptDialog> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(ActionPromptDialog);
  fixture.componentRef.setInput('descriptor', descriptor);
  fixture.componentRef.setInput('open', open);
  fixture.detectChanges();
  return fixture;
}

function inst(fixture: ComponentFixture<ActionPromptDialog>): {
  confirm(): void;
  cancel(): void;
  onVisibleChange(v: boolean): void;
  collected: { set(v: TInputTypeValue): void; (): TInputTypeValue };
} {
  return fixture.componentInstance as unknown as {
    confirm(): void;
    cancel(): void;
    onVisibleChange(v: boolean): void;
    collected: { set(v: TInputTypeValue): void; (): TInputTypeValue };
  };
}

describe('ActionPromptDialog', () => {
  it('emits the collected value on confirm', () => {
    const fixture = bootstrap({ inputType: 'single-string', label: 'Path' });
    const confirmed = vi.fn();
    fixture.componentInstance.confirmed.subscribe(confirmed);
    inst(fixture).collected.set('agents/successor.md');
    inst(fixture).confirm();
    expect(confirmed).toHaveBeenCalledWith('agents/successor.md');
  });

  it('emits closed on cancel without a value', () => {
    const fixture = bootstrap({ inputType: 'single-string', label: 'Path' });
    const closed = vi.fn();
    const confirmed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    fixture.componentInstance.confirmed.subscribe(confirmed);
    inst(fixture).cancel();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(confirmed).not.toHaveBeenCalled();
  });

  it('treats a dialog close (X / mask) as a decline', () => {
    const fixture = bootstrap({ inputType: 'single-string', label: 'Path' });
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    inst(fixture).onVisibleChange(false);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('seeds a string-list prompt with an empty array', () => {
    const fixture = bootstrap({ inputType: 'string-list', label: 'Tags' });
    expect(inst(fixture).collected()).toEqual([]);
  });

  it('seeds a scalar prompt with an empty string', () => {
    const fixture = bootstrap({ inputType: 'single-string', label: 'Path' });
    expect(inst(fixture).collected()).toBe('');
  });

  it('seeds an enum-pick prompt with the defaultValue (current stability)', () => {
    const fixture = bootstrap({
      inputType: 'enum-pick',
      label: 'Stability',
      options: [
        { value: 'experimental', label: 'Experimental' },
        { value: 'stable', label: 'Stable' },
        { value: 'deprecated', label: 'Deprecated' },
      ],
      defaultValue: 'stable',
    });
    expect(inst(fixture).collected()).toBe('stable');
  });

  it('seeds a single-string prompt with the defaultValue', () => {
    const fixture = bootstrap({
      inputType: 'single-string',
      label: 'Path',
      defaultValue: 'agents/successor.md',
    });
    expect(inst(fixture).collected()).toBe('agents/successor.md');
  });

  it('seeds a string-list prompt with the defaultValue (current tags)', () => {
    const fixture = bootstrap({
      inputType: 'string-list',
      label: 'Tags',
      defaultValue: ['alpha', 'beta'],
    });
    expect(inst(fixture).collected()).toEqual(['alpha', 'beta']);
  });

  it('copies the list default so editing does not mutate the descriptor', () => {
    const seed = ['alpha', 'beta'];
    const fixture = bootstrap({
      inputType: 'string-list',
      label: 'Tags',
      defaultValue: seed,
    });
    const collected = inst(fixture).collected();
    expect(collected).toEqual(['alpha', 'beta']);
    expect(collected).not.toBe(seed);
  });

  it('ignores a scalar default on a list control (normalised to empty array)', () => {
    const fixture = bootstrap({
      inputType: 'string-list',
      label: 'Tags',
      defaultValue: 'not-an-array' as unknown as string[],
    });
    expect(inst(fixture).collected()).toEqual([]);
  });

  it('ignores an array default on a scalar control (normalised to empty string)', () => {
    const fixture = bootstrap({
      inputType: 'single-string',
      label: 'Path',
      defaultValue: ['x'] as unknown as string,
    });
    expect(inst(fixture).collected()).toBe('');
  });

  it('re-seeds the default each time the dialog reopens (no leaked edit)', () => {
    const fixture = bootstrap(
      { inputType: 'single-string', label: 'Path', defaultValue: 'seed.md' },
      false,
    );
    // Open it: seeded with the default.
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    expect(inst(fixture).collected()).toBe('seed.md');
    // User edits, then closes.
    inst(fixture).collected.set('edited.md');
    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    // Reopen: back to the default, the edit did not stick.
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    expect(inst(fixture).collected()).toBe('seed.md');
  });
});
