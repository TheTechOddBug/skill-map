/**
 * Unit tests for `cli/util/confirm`. Covers the default-no (legacy)
 * behaviour used by destructive verbs (`db restore`, `sidecar prune`,
 * etc) and the default-yes path used by the consent-style prompts
 * (`.sm` write consent on `sm bump` / `sm sidecar annotate|refresh`).
 */

import { strict as assert } from 'node:assert';
import { Readable, Writable } from 'node:stream';
import { test } from 'node:test';

import { confirm } from '../cli/util/confirm.js';

function pipeAnswer(answer: string): { stdin: Readable; stderr: Writable; out: string[] } {
  const stdin = Readable.from([answer]);
  const out: string[] = [];
  const stderr = new Writable({
    write(chunk, _enc, cb) {
      out.push(chunk.toString());
      cb();
    },
  });
  return { stdin, stderr, out };
}

test('confirm — default-no: empty answer → false', async () => {
  const { stdin, stderr, out } = pipeAnswer('\n');
  const ok = await confirm('proceed?', { stdin, stderr });
  assert.equal(ok, false);
  assert.ok(out.join('').includes('[y/N]'), 'default-no suffix should be [y/N]');
});

test('confirm — default-yes: empty answer → true', async () => {
  const { stdin, stderr, out } = pipeAnswer('\n');
  const ok = await confirm('proceed?', { stdin, stderr }, { defaultAnswer: 'yes' });
  assert.equal(ok, true);
  assert.ok(out.join('').includes('[Y/n]'), 'default-yes suffix should be [Y/n]');
});

test('confirm — default-yes: explicit "n" still returns false', async () => {
  const { stdin, stderr } = pipeAnswer('n\n');
  const ok = await confirm('proceed?', { stdin, stderr }, { defaultAnswer: 'yes' });
  assert.equal(ok, false);
});

test('confirm — default-no: explicit "y" returns true', async () => {
  const { stdin, stderr } = pipeAnswer('y\n');
  const ok = await confirm('proceed?', { stdin, stderr });
  assert.equal(ok, true);
});

test('confirm — default-yes: gibberish falls back to default (true)', async () => {
  const { stdin, stderr } = pipeAnswer('asdf\n');
  const ok = await confirm('proceed?', { stdin, stderr }, { defaultAnswer: 'yes' });
  assert.equal(ok, true);
});

test('confirm — default-no: gibberish stays false (legacy contract)', async () => {
  const { stdin, stderr } = pipeAnswer('asdf\n');
  const ok = await confirm('proceed?', { stdin, stderr });
  assert.equal(ok, false);
});
