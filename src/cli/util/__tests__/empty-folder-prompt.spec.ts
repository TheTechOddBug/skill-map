/**
 * Unit tests for the bare-`sm` empty-folder menu classifier
 * (`classifyEmptyFolderAnswer`). The live readline prompt is exercised
 * end-to-end (non-TTY path) in `cli/__tests__/bare-routing.spec.ts`;
 * here we lock the pure answer-to-verb mapping.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  classifyEmptyFolderAnswer,
  decideBareNoArgs,
  shouldServeAfterInit,
  type IBareNoArgsPrompts,
  type TEmptyFolderChoice,
} from '../empty-folder-prompt.js';
import { ExitCode } from '../exit-codes.js';

describe('classifyEmptyFolderAnswer', () => {
  it('an empty answer takes the default (tutorial)', () => {
    assert.equal(classifyEmptyFolderAnswer(''), 'tutorial');
  });

  it('resolves by option number', () => {
    assert.equal(classifyEmptyFolderAnswer('1'), 'tutorial');
    assert.equal(classifyEmptyFolderAnswer('2'), 'example');
  });

  it('resolves by verb name, case-insensitive', () => {
    assert.equal(classifyEmptyFolderAnswer('tutorial'), 'tutorial');
    assert.equal(classifyEmptyFolderAnswer('Example'), 'example');
    assert.equal(classifyEmptyFolderAnswer('EXAMPLE'), 'example');
  });

  it('returns null for an unrecognised answer', () => {
    assert.equal(classifyEmptyFolderAnswer('3'), null);
    assert.equal(classifyEmptyFolderAnswer('serve'), null);
    assert.equal(classifyEmptyFolderAnswer('x'), null);
  });
});

describe('decideBareNoArgs', () => {
  /** Prompt spies returning fixed answers and counting their calls. */
  function spyPrompts(
    menuChoice: TEmptyFolderChoice | null,
    confirmInitAnswer: boolean,
  ): {
    prompts: IBareNoArgsPrompts;
    menuCalls: () => number;
    confirmInitCalls: () => number;
  } {
    let menuCalls = 0;
    let confirmInitCalls = 0;
    return {
      prompts: {
        menu: () => {
          menuCalls += 1;
          return Promise.resolve(menuChoice);
        },
        confirmInit: () => {
          confirmInitCalls += 1;
          return Promise.resolve(confirmInitAnswer);
        },
      },
      menuCalls: () => menuCalls,
      confirmInitCalls: () => confirmInitCalls,
    };
  }

  it('serves when a project DB is present (never prompts)', async () => {
    const p = spyPrompts('tutorial', true);
    const r = await decideBareNoArgs({ hasDb: true, isTty: true, isEmptyDir: true }, p.prompts);
    assert.deepEqual(r, { kind: 'route', argv: ['serve'] });
    assert.equal(p.menuCalls(), 0);
    assert.equal(p.confirmInitCalls(), 0);
  });

  it('routes to the chosen verb in an empty cwd on a TTY (menu only)', async () => {
    const tut = spyPrompts('tutorial', true);
    assert.deepEqual(
      await decideBareNoArgs({ hasDb: false, isTty: true, isEmptyDir: true }, tut.prompts),
      { kind: 'route', argv: ['tutorial'] },
    );
    assert.equal(tut.menuCalls(), 1);
    assert.equal(tut.confirmInitCalls(), 0);

    const ex = spyPrompts('example', true);
    assert.deepEqual(
      await decideBareNoArgs({ hasDb: false, isTty: true, isEmptyDir: true }, ex.prompts),
      { kind: 'route', argv: ['example'] },
    );
    assert.equal(ex.menuCalls(), 1);
  });

  it('falls through to the hint when the empty-folder menu gives no valid pick', async () => {
    const p = spyPrompts(null, true);
    const r = await decideBareNoArgs({ hasDb: false, isTty: true, isEmptyDir: true }, p.prompts);
    assert.deepEqual(r, { kind: 'hint' });
    assert.equal(p.menuCalls(), 1);
    assert.equal(p.confirmInitCalls(), 0);
  });

  it('offers init in a non-empty cwd on a TTY; accept routes init-then-serve', async () => {
    const p = spyPrompts('tutorial', true);
    const r = await decideBareNoArgs({ hasDb: false, isTty: true, isEmptyDir: false }, p.prompts);
    assert.deepEqual(r, { kind: 'init-then-serve' });
    assert.equal(p.confirmInitCalls(), 1);
    assert.equal(p.menuCalls(), 0);
  });

  it('offers init in a non-empty cwd on a TTY; decline falls through to the hint', async () => {
    const p = spyPrompts('tutorial', false);
    const r = await decideBareNoArgs({ hasDb: false, isTty: true, isEmptyDir: false }, p.prompts);
    assert.deepEqual(r, { kind: 'hint' });
    assert.equal(p.confirmInitCalls(), 1);
    assert.equal(p.menuCalls(), 0);
  });

  it('never prompts on a non-interactive stdin, empty cwd (hint)', async () => {
    const p = spyPrompts('tutorial', true);
    const r = await decideBareNoArgs({ hasDb: false, isTty: false, isEmptyDir: true }, p.prompts);
    assert.deepEqual(r, { kind: 'hint' });
    assert.equal(p.menuCalls(), 0);
    assert.equal(p.confirmInitCalls(), 0);
  });

  it('never prompts on a non-interactive stdin, non-empty cwd (hint)', async () => {
    const p = spyPrompts('tutorial', true);
    const r = await decideBareNoArgs({ hasDb: false, isTty: false, isEmptyDir: false }, p.prompts);
    assert.deepEqual(r, { kind: 'hint' });
    assert.equal(p.menuCalls(), 0);
    assert.equal(p.confirmInitCalls(), 0);
  });
});

describe('shouldServeAfterInit', () => {
  it('continues into serve on a clean init (Ok)', () => {
    assert.equal(shouldServeAfterInit(ExitCode.Ok), true);
  });

  it('continues into serve when the first scan only found issues (Issues)', () => {
    // Regression: init returns Issues (1) when the first scan of a real
    // project finds an error-severity issue (e.g. a broken reference). That
    // is NOT an init failure, the project is provisioned and the map should
    // still open on those issues.
    assert.equal(shouldServeAfterInit(ExitCode.Issues), true);
  });

  it('does NOT serve on a hard init failure', () => {
    assert.equal(shouldServeAfterInit(ExitCode.Error), false);
    assert.equal(shouldServeAfterInit(ExitCode.NotFound), false);
  });
});
