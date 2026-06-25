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
  type TEmptyFolderChoice,
} from '../empty-folder-prompt.js';

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
  /** A prompt spy that returns a fixed choice and counts its calls. */
  function spyPrompt(choice: TEmptyFolderChoice | null): {
    fn: () => Promise<TEmptyFolderChoice | null>;
    calls: () => number;
  } {
    let calls = 0;
    return {
      fn: () => {
        calls += 1;
        return Promise.resolve(choice);
      },
      calls: () => calls,
    };
  }

  it('serves when a project DB is present (never prompts)', async () => {
    const p = spyPrompt('tutorial');
    const r = await decideBareNoArgs({ hasDb: true, isTty: true, isEmptyDir: true }, p.fn);
    assert.deepEqual(r, { kind: 'route', argv: ['serve'] });
    assert.equal(p.calls(), 0);
  });

  it('routes to the chosen verb in an empty cwd on a TTY', async () => {
    const tut = spyPrompt('tutorial');
    assert.deepEqual(
      await decideBareNoArgs({ hasDb: false, isTty: true, isEmptyDir: true }, tut.fn),
      { kind: 'route', argv: ['tutorial'] },
    );
    assert.equal(tut.calls(), 1);

    const ex = spyPrompt('example');
    assert.deepEqual(
      await decideBareNoArgs({ hasDb: false, isTty: true, isEmptyDir: true }, ex.fn),
      { kind: 'route', argv: ['example'] },
    );
    assert.equal(ex.calls(), 1);
  });

  it('falls through to the hint when the operator gives no valid pick', async () => {
    const p = spyPrompt(null);
    const r = await decideBareNoArgs({ hasDb: false, isTty: true, isEmptyDir: true }, p.fn);
    assert.deepEqual(r, { kind: 'hint' });
    assert.equal(p.calls(), 1);
  });

  it('never prompts on a non-interactive stdin (hint)', async () => {
    const p = spyPrompt('tutorial');
    const r = await decideBareNoArgs({ hasDb: false, isTty: false, isEmptyDir: true }, p.fn);
    assert.deepEqual(r, { kind: 'hint' });
    assert.equal(p.calls(), 0);
  });

  it('never prompts in a non-empty cwd (hint)', async () => {
    const p = spyPrompt('tutorial');
    const r = await decideBareNoArgs({ hasDb: false, isTty: true, isEmptyDir: false }, p.fn);
    assert.deepEqual(r, { kind: 'hint' });
    assert.equal(p.calls(), 0);
  });
});
