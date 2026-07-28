/**
 * Importing a project-local drop-in plugin evaluates third-party code
 * with the operator's privileges. The loader already speaks up when a
 * plugin is REFUSED, so staying mute on success made the only invisible
 * outcome the dangerous one. `emitWarnings` now also announces what
 * actually executed, on every run, trusted or not.
 *
 * This matters most while the import-trust store still lives inside the
 * scanned tree (audit C1): the notice is the operator's one signal that
 * code ran at all.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { IDiscoveredPlugin } from '../../../kernel/types/plugin.js';
import type { IPluginRuntime } from '../plugin-runtime/index.js';
import { emitWarnings } from '../plugin-runtime/warnings.js';
import { createPrinter, type IPrinter } from '../printer.js';

interface ICapture {
  printer: IPrinter;
  stdout: () => string;
  stderr: () => string;
}

function capturePrinter(): ICapture {
  const out: string[] = [];
  const err: string[] = [];
  const printer = createPrinter({
    stdout: { write: (s: string) => { out.push(s); return true; } } as NodeJS.WritableStream,
    stderr: { write: (s: string) => { err.push(s); return true; } } as NodeJS.WritableStream,
  });
  return { printer, stdout: () => out.join(''), stderr: () => err.join('') };
}

/** Minimal runtime carrying only what `emitWarnings` reads. */
function runtimeWith(
  discovered: Array<Pick<IDiscoveredPlugin, 'id' | 'status'>>,
  warnings: string[] = [],
): IPluginRuntime {
  return {
    warnings,
    discovered: discovered as IDiscoveredPlugin[],
  } as unknown as IPluginRuntime;
}

describe('executed-plugin notice', () => {
  it('names the plugins whose code was imported', () => {
    const cap = capturePrinter();
    emitWarnings(runtimeWith([{ id: 'my-plugin', status: 'enabled' }]), cap.printer);
    assert.match(cap.stderr(), /Loaded 1 project-local plugin: my-plugin/);
  });

  it('pluralises and lists every executed plugin', () => {
    const cap = capturePrinter();
    emitWarnings(
      runtimeWith([
        { id: 'alpha', status: 'enabled' },
        { id: 'beta', status: 'enabled' },
      ]),
      cap.printer,
    );
    assert.match(cap.stderr(), /Loaded 2 project-local plugins: alpha, beta/);
  });

  it('stays silent when nothing was imported', () => {
    const cap = capturePrinter();
    emitWarnings(runtimeWith([]), cap.printer);
    assert.equal(cap.stderr(), '');
  });

  it('counts only plugins that actually loaded, not refused ones', () => {
    const cap = capturePrinter();
    emitWarnings(
      runtimeWith([
        { id: 'ran', status: 'enabled' },
        { id: 'untrusted', status: 'disabled' },
        { id: 'broken', status: 'load-error' },
      ]),
      cap.printer,
    );
    assert.match(cap.stderr(), /Loaded 1 project-local plugin: ran/);
    assert.ok(!cap.stderr().includes('untrusted'), cap.stderr());
    assert.ok(!cap.stderr().includes('broken'), cap.stderr());
  });

  it('sanitises ids, a plugin dir name is attacker-authored', () => {
    const cap = capturePrinter();
    emitWarnings(runtimeWith([{ id: `ev${'\u001b[2J'}il`, status: 'enabled' }]), cap.printer);
    assert.ok(!cap.stderr().includes('\u001b'), JSON.stringify(cap.stderr()));
    assert.match(cap.stderr(), /evil/);
  });

  it('rides alongside the refusal warnings rather than replacing them', () => {
    const cap = capturePrinter();
    emitWarnings(
      runtimeWith([{ id: 'ran', status: 'enabled' }], ['plugin bad (load-error), skipped: boom']),
      cap.printer,
    );
    assert.match(cap.stderr(), /plugin bad \(load-error\)/);
    assert.match(cap.stderr(), /Loaded 1 project-local plugin: ran/);
  });

  it('never pollutes stdout, the machine-payload channel', () => {
    const cap = capturePrinter();
    emitWarnings(runtimeWith([{ id: 'my-plugin', status: 'enabled' }]), cap.printer);
    assert.equal(cap.stdout(), '');
  });
});
