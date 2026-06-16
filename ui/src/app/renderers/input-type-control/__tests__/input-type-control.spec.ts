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
 * the two-way `value` model. Coverage: every one of the eleven catalog
 * types mounts its own `data-testid`, and the value model reflects what
 * the protected change handlers write.
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
interface IControlInternals {
  onStringChange(v: string): void;
  onListChange(v: string[]): void;
  onNumberChange(v: number | null): void;
  onBooleanChange(v: boolean): void;
  onPathGlobChange(v: string | string[]): void;
  onKeyChange(index: number, v: string): void;
  onValueChange(index: number, v: string): void;
  addRow(): void;
  removeRow(index: number): void;
  addSuggestion(tag: string): void;
  hasSuggestions(): boolean;
  unselectedSuggestions(): string[];
}

function asAny(fixture: ComponentFixture<InputTypeControl>): IControlInternals {
  return fixture.componentInstance as unknown as IControlInternals;
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

  it('renders an inputnumber for integer', () => {
    const fixture = bootstrap({ inputType: 'integer', label: 'Count' }, '');
    expect(el(fixture, 'input-type-control-integer')).not.toBeNull();
    expect(el(fixture, 'input-type-control-unsupported')).toBeNull();
  });

  it('renders a decimal inputnumber for number', () => {
    const fixture = bootstrap({ inputType: 'number', label: 'Floor' }, '');
    expect(el(fixture, 'input-type-control-number')).not.toBeNull();
  });

  it('renders a toggle for boolean-flag', () => {
    const fixture = bootstrap({ inputType: 'boolean-flag', label: 'On' }, false);
    expect(el(fixture, 'input-type-control-boolean')).not.toBeNull();
  });

  it('renders a multiselect for enum-multipick', () => {
    const fixture = bootstrap(
      {
        inputType: 'enum-multipick',
        label: 'Severities',
        options: [
          { value: 'warn', label: 'Warning' },
          { value: 'danger', label: 'Danger' },
        ],
      },
      [],
    );
    expect(el(fixture, 'input-type-control-multiselect')).not.toBeNull();
  });

  it('renders a text input for single path-glob and a tag input for multiple', () => {
    const single = bootstrap({ inputType: 'path-glob', label: 'Glob' });
    expect(el(single, 'input-type-control-path-glob-single')).not.toBeNull();
    expect(el(single, 'input-type-control-path-glob-multiple')).toBeNull();

    const multi = bootstrap({ inputType: 'path-glob', label: 'Globs', multiple: true }, []);
    expect(el(multi, 'input-type-control-path-glob-multiple')).not.toBeNull();
    expect(el(multi, 'input-type-control-path-glob-single')).toBeNull();
  });

  it('renders the regex body input plus the static flags suffix', () => {
    const fixture = bootstrap({ inputType: 'regex', label: 'Pattern', flags: 'gi' }, '');
    expect(el(fixture, 'input-type-control-regex')).not.toBeNull();
    const flags = el(fixture, 'input-type-control-regex-flags');
    expect(flags).not.toBeNull();
    expect(flags!.textContent).toContain('gi');
  });

  it('renders a password field with the set / empty status for secret', () => {
    const set = bootstrap({ inputType: 'secret', label: 'Token', secretIsSet: true }, '');
    expect(el(set, 'input-type-control-secret')).not.toBeNull();
    expect(el(set, 'input-type-control-secret-status')!.textContent!.trim()).toBe('Set');

    const empty = bootstrap({ inputType: 'secret', label: 'Token' }, '');
    expect(el(empty, 'input-type-control-secret-status')!.textContent!.trim()).toBe('Empty');
  });

  it('renders the editable rows table for key-value-list', () => {
    const fixture = bootstrap(
      { inputType: 'key-value-list', label: 'Headers' },
      [{ key: 'Authorization', value: 'Bearer x' }],
    );
    expect(el(fixture, 'input-type-control-key-value')).not.toBeNull();
    expect(el(fixture, 'input-type-control-key-value-key-0')).not.toBeNull();
    expect(el(fixture, 'input-type-control-key-value-value-0')).not.toBeNull();
    expect(el(fixture, 'input-type-control-key-value-add')).not.toBeNull();
  });

  it('renders the unsupported notice for a not-yet-built input-type', () => {
    const fixture = bootstrap({ inputType: 'future-type', label: 'Count' });
    const note = el(fixture, 'input-type-control-unsupported');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain('future-type');
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

  it('emits a number when the inputnumber control changes', () => {
    const fixture = bootstrap({ inputType: 'integer', label: 'N' }, '');
    asAny(fixture).onNumberChange(7);
    expect(fixture.componentInstance.value()).toBe(7);
  });

  it('collapses a cleared inputnumber to the blank sentinel', () => {
    const fixture = bootstrap({ inputType: 'integer', label: 'N' }, 3);
    asAny(fixture).onNumberChange(null);
    expect(fixture.componentInstance.value()).toBe('');
  });

  it('emits a boolean when the toggle changes', () => {
    const fixture = bootstrap({ inputType: 'boolean-flag', label: 'On' }, false);
    asAny(fixture).onBooleanChange(true);
    expect(fixture.componentInstance.value()).toBe(true);
  });

  it('routes a single path-glob change to a scalar string', () => {
    const fixture = bootstrap({ inputType: 'path-glob', label: 'Glob' }, '');
    asAny(fixture).onPathGlobChange('**/*.md');
    expect(fixture.componentInstance.value()).toBe('**/*.md');
  });

  it('routes a multiple path-glob change to a string[]', () => {
    const fixture = bootstrap({ inputType: 'path-glob', label: 'Globs', multiple: true }, []);
    asAny(fixture).onPathGlobChange(['a', 'b']);
    expect(fixture.componentInstance.value()).toEqual(['a', 'b']);
  });

  it('adds, edits, and removes key-value rows', () => {
    const fixture = bootstrap({ inputType: 'key-value-list', label: 'Map' }, []);
    const ctl = asAny(fixture);
    ctl.addRow();
    expect(fixture.componentInstance.value()).toEqual([{ key: '', value: '' }]);
    ctl.onKeyChange(0, 'Header');
    ctl.onValueChange(0, 'Value');
    expect(fixture.componentInstance.value()).toEqual([{ key: 'Header', value: 'Value' }]);
    ctl.removeRow(0);
    expect(fixture.componentInstance.value()).toEqual([]);
  });
});

describe('InputTypeControl, string-list suggestion palette', () => {
  it('reports no suggestions when the descriptor seeds none (plain chips input)', () => {
    const fixture = bootstrap({ inputType: 'string-list', label: 'Tags' }, []);
    expect(asAny(fixture).hasSuggestions()).toBe(false);
    expect(asAny(fixture).unselectedSuggestions()).toEqual([]);
  });

  it('lists the seeded vocabulary minus the already-selected values', () => {
    const fixture = bootstrap(
      { inputType: 'string-list', label: 'Tags', suggestions: ['infra', 'review', 'docs'] },
      ['infra'],
    );
    const ctl = asAny(fixture);
    expect(ctl.hasSuggestions()).toBe(true);
    expect(ctl.unselectedSuggestions()).toEqual(['review', 'docs']);
  });

  it('appends a clicked suggestion to the value, and never duplicates', () => {
    const fixture = bootstrap(
      { inputType: 'string-list', label: 'Tags', suggestions: ['infra', 'review'] },
      ['infra'],
    );
    const ctl = asAny(fixture);
    ctl.addSuggestion('review');
    expect(fixture.componentInstance.value()).toEqual(['infra', 'review']);
    ctl.addSuggestion('review'); // already present, no-op
    expect(fixture.componentInstance.value()).toEqual(['infra', 'review']);
  });
});
