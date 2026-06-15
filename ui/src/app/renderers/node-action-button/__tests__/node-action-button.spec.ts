import { describe, expect, it, vi, beforeEach } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import {
  DeferBlockBehavior,
  TestBed,
  type ComponentFixture,
} from '@angular/core/testing';

import { NodeActionButton } from '../node-action-button';
import { ActionDispatchService } from '../../../../services/action-dispatch';
import type { IRendererInputs } from '../../../slots/slot-renderer-map';

/**
 * NodeActionButton renderer (`inspector.action.button` slot). The two
 * click flows: a direct dispatch when the payload has no `prompt`, and
 * the parametrized prompt flow (open dialog -> collect via
 * `<sm-input-type-control>` -> dispatch with `{ [paramKey]: value }`)
 * when it does. The `.sm` consent handshake lives in
 * `ActionDispatchService`, stubbed here, so these tests only assert the
 * renderer's own behaviour (which dispatch, with what input).
 */

interface IStubDispatcher {
  dispatch: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  dismissError: ReturnType<typeof vi.fn>;
}

let stub: IStubDispatcher;

function makeStub(): IStubDispatcher {
  return {
    dispatch: vi.fn().mockResolvedValue(undefined),
    error: vi.fn().mockReturnValue(null),
    dismissError: vi.fn(),
  };
}

function makeInputs(overrides: Partial<IRendererInputs> = {}): IRendererInputs {
  return {
    pluginId: 'core',
    extensionId: 'annotation-stale',
    contributionId: 'bumpButton',
    nodePath: 'agents/architect.md',
    payload: {},
    ...overrides,
  };
}

async function bootstrap(inputs: IRendererInputs): Promise<ComponentFixture<NodeActionButton>> {
  TestBed.resetTestingModule();
  // The prompt dialog is @defer-wrapped; the component must be in
  // `imports` AND compiled so the deferred dependency graph resolves
  // under the AOT test runner (matching app.spec.ts). Playthrough then
  // renders deferred blocks synchronously so the DOM assertions see the
  // dialog.
  await TestBed.configureTestingModule({
    imports: [NodeActionButton],
    providers: [
      provideZonelessChangeDetection(),
      { provide: ActionDispatchService, useValue: stub },
    ],
    deferBlockBehavior: DeferBlockBehavior.Playthrough,
  }).compileComponents();
  const fixture = TestBed.createComponent(NodeActionButton);
  fixture.componentRef.setInput('inputs', inputs);
  fixture.detectChanges();
  return fixture;
}

// The prompt dialog uses PrimeNG `appendTo="body"`, so its content (and the
// inner control) mounts on `document.body`, NOT inside the detached fixture
// host. Query the document so the assertions find it where it actually lands.
// `TestBed.resetTestingModule()` in each `bootstrap` destroys the prior
// component, so PrimeNG removes its body-appended DOM, no cross-test leak.
function el(testid: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
}

/** Reach the protected click handlers without leaning on PrimeNG DOM. */
function ctrl(fixture: ComponentFixture<NodeActionButton>): {
  run(): void;
  onPromptConfirmed(v: unknown): void;
  cancelPrompt(): void;
  promptOpen(): boolean;
} {
  return fixture.componentInstance as unknown as {
    run(): void;
    onPromptConfirmed(v: unknown): void;
    cancelPrompt(): void;
    promptOpen(): boolean;
  };
}

const PROMPT_INPUTS = makeInputs({
  contributionId: 'supersedeButton',
  payload: {
    actionId: 'core/node-supersede',
    label: 'Supersede',
    enabled: true,
    prompt: {
      inputType: 'single-string',
      paramKey: 'supersededBy',
      label: 'Replacement node path',
    },
  },
});

beforeEach(() => {
  stub = makeStub();
});

describe('NodeActionButton, direct dispatch (no prompt)', () => {
  it('dispatches immediately on click with the static input', async () => {
    const fixture = await bootstrap(
      makeInputs({ payload: { actionId: 'core/node-bump', label: 'Bump', enabled: true, input: { foo: 1 } } }),
    );
    ctrl(fixture).run();
    await fixture.whenStable();
    expect(stub.dispatch).toHaveBeenCalledTimes(1);
    expect(stub.dispatch).toHaveBeenCalledWith('core/node-bump', 'agents/architect.md', { foo: 1 });
  });

  it('does not open the prompt dialog when there is no prompt', async () => {
    const fixture = await bootstrap(
      makeInputs({ payload: { actionId: 'core/node-bump', label: 'Bump', enabled: true } }),
    );
    ctrl(fixture).run();
    fixture.detectChanges();
    expect(el('action-prompt-dialog')).toBeNull();
  });

  it('does not dispatch when the button is disabled', async () => {
    const fixture = await bootstrap(
      makeInputs({ payload: { actionId: 'core/node-bump', label: 'Bump', enabled: false } }),
    );
    ctrl(fixture).run();
    await fixture.whenStable();
    expect(stub.dispatch).not.toHaveBeenCalled();
  });
});

describe('NodeActionButton, prompt flow', () => {
  it('opens the prompt dialog on click instead of dispatching', async () => {
    const fixture = await bootstrap(PROMPT_INPUTS);
    expect(ctrl(fixture).promptOpen()).toBe(false);
    ctrl(fixture).run();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(ctrl(fixture).promptOpen()).toBe(true);
    // The deferred dialog (Playthrough) renders its own + the control testid.
    expect(el('action-prompt-dialog')).not.toBeNull();
    expect(el('action-prompt-control')).not.toBeNull();
    expect(stub.dispatch).not.toHaveBeenCalled();
  });

  it('dispatches with { [paramKey]: confirmedValue } on confirm', async () => {
    const fixture = await bootstrap(PROMPT_INPUTS);
    ctrl(fixture).run();
    fixture.detectChanges();
    ctrl(fixture).onPromptConfirmed('agents/successor.md');
    await fixture.whenStable();
    expect(stub.dispatch).toHaveBeenCalledTimes(1);
    expect(stub.dispatch).toHaveBeenCalledWith(
      'core/node-supersede',
      'agents/architect.md',
      { supersededBy: 'agents/successor.md' },
    );
  });

  it('merges the confirmed value over any static input', async () => {
    const fixture = await bootstrap(
      makeInputs({
        payload: {
          actionId: 'core/node-supersede',
          label: 'Supersede',
          enabled: true,
          input: { reason: 'merge' },
          prompt: { inputType: 'single-string', paramKey: 'supersededBy', label: 'Replacement' },
        },
      }),
    );
    ctrl(fixture).run();
    fixture.detectChanges();
    ctrl(fixture).onPromptConfirmed('agents/successor.md');
    await fixture.whenStable();
    expect(stub.dispatch).toHaveBeenCalledWith(
      'core/node-supersede',
      'agents/architect.md',
      { reason: 'merge', supersededBy: 'agents/successor.md' },
    );
  });

  it('dispatches a string[] for a string-list prompt', async () => {
    const fixture = await bootstrap(
      makeInputs({
        payload: {
          actionId: 'core/node-set-tags',
          label: 'Edit tags',
          enabled: true,
          prompt: { inputType: 'string-list', paramKey: 'tags', label: 'Tags' },
        },
      }),
    );
    ctrl(fixture).run();
    fixture.detectChanges();
    ctrl(fixture).onPromptConfirmed(['alpha', 'beta']);
    await fixture.whenStable();
    expect(stub.dispatch).toHaveBeenCalledWith(
      'core/node-set-tags',
      'agents/architect.md',
      { tags: ['alpha', 'beta'] },
    );
  });

  it('closes without dispatching on cancel', async () => {
    const fixture = await bootstrap(PROMPT_INPUTS);
    ctrl(fixture).run();
    fixture.detectChanges();
    ctrl(fixture).cancelPrompt();
    fixture.detectChanges();
    expect(ctrl(fixture).promptOpen()).toBe(false);
    expect(stub.dispatch).not.toHaveBeenCalled();
  });
});
