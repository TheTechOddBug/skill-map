import { describe, expect, it } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import {
  InputTypeControl,
  type IInputTypeDescriptor,
  type TInputTypeValue,
} from '../input-type-control';

/**
 * InputTypeControl, the reusable widget that renders the PrimeNG control
 * matching an input-type descriptor and reports the collected value via
 * the two-way `value` model. Coverage: the three implemented types
 * (single-string / enum-pick / string-list) each mount their own
 * `data-testid`, and the value model reflects what the protected change
 * handlers write.
 */

function bootstrap(
  descriptor: IInputTypeDescriptor,
  value: TInputTypeValue = '',
): ComponentFixture<InputTypeControl> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(InputTypeControl);
  fixture.componentRef.setInput('descriptor', descriptor);
  fixture.componentRef.setInput('value', value);
  fixture.detectChanges();
  return fixture;
}

function el(fixture: ComponentFixture<InputTypeControl>, testid: string): HTMLElement | null {
  return (fixture.nativeElement as HTMLElement).querySelector(
    `[data-testid="${testid}"]`,
  ) as HTMLElement | null;
}

/** Reach the protected change handlers without leaning on PrimeNG's DOM. */
function asAny(fixture: ComponentFixture<InputTypeControl>): {
  onStringChange(v: string): void;
  onListChange(v: string[]): void;
} {
  return fixture.componentInstance as unknown as {
    onStringChange(v: string): void;
    onListChange(v: string[]): void;
  };
}

describe('InputTypeControl, rendering', () => {
  it('mounts the root with a type-suffixed data-testid and the label', () => {
    const fixture = bootstrap({ inputType: 'single-string', label: 'New path' });
    const root = el(fixture, 'input-type-control-single-string');
    expect(root).not.toBeNull();
    expect(root!.querySelector('.itc__label')!.textContent!.trim()).toBe('New path');
  });

  it('renders a text input for single-string', () => {
    const fixture = bootstrap({ inputType: 'single-string', label: 'New path' });
    expect(el(fixture, 'input-type-control-string-input')).not.toBeNull();
    expect(el(fixture, 'input-type-control-select')).toBeNull();
    expect(el(fixture, 'input-type-control-list')).toBeNull();
  });

  it('renders a select for enum-pick', () => {
    const fixture = bootstrap({
      inputType: 'enum-pick',
      label: 'Stability',
      options: [
        { value: 'stable', label: 'Stable' },
        { value: 'deprecated', label: 'Deprecated' },
      ],
    });
    expect(el(fixture, 'input-type-control-select')).not.toBeNull();
    expect(el(fixture, 'input-type-control-string-input')).toBeNull();
    expect(el(fixture, 'input-type-control-list')).toBeNull();
  });

  it('renders a tag input (autocomplete) for string-list', () => {
    const fixture = bootstrap({ inputType: 'string-list', label: 'Tags' }, []);
    expect(el(fixture, 'input-type-control-list')).not.toBeNull();
    expect(el(fixture, 'input-type-control-string-input')).toBeNull();
    expect(el(fixture, 'input-type-control-select')).toBeNull();
  });

  it('renders the unsupported notice for an unknown input-type', () => {
    const fixture = bootstrap({ inputType: 'integer', label: 'Count' });
    const note = el(fixture, 'input-type-control-unsupported');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain('integer');
  });
});

describe('InputTypeControl, value model', () => {
  it('seeds the string widgets from the initial scalar value', () => {
    const fixture = bootstrap({ inputType: 'single-string', label: 'X' }, 'seed');
    expect(fixture.componentInstance.value()).toBe('seed');
  });

  it('emits the scalar value when the single-string control changes', () => {
    const fixture = bootstrap({ inputType: 'single-string', label: 'X' });
    asAny(fixture).onStringChange('typed value');
    expect(fixture.componentInstance.value()).toBe('typed value');
  });

  it('emits the picked option value when the enum-pick control changes', () => {
    const fixture = bootstrap({
      inputType: 'enum-pick',
      label: 'Stability',
      options: [
        { value: 'stable', label: 'Stable' },
        { value: 'deprecated', label: 'Deprecated' },
      ],
    });
    asAny(fixture).onStringChange('deprecated');
    expect(fixture.componentInstance.value()).toBe('deprecated');
  });

  it('emits a string[] when the string-list control changes', () => {
    const fixture = bootstrap({ inputType: 'string-list', label: 'Tags' }, []);
    asAny(fixture).onListChange(['alpha', 'beta']);
    expect(fixture.componentInstance.value()).toEqual(['alpha', 'beta']);
  });

  it('coerces a null list change to an empty array', () => {
    const fixture = bootstrap({ inputType: 'string-list', label: 'Tags' }, []);
    asAny(fixture).onListChange(null as unknown as string[]);
    expect(fixture.componentInstance.value()).toEqual([]);
  });
});
