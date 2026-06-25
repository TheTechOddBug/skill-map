/**
 * Unit coverage for the `sm tutorial` destination catalog + answer
 * classifier. These are the pure pieces behind the interactive prompt
 * (the spawn-based tests in `tutorial-cli.spec.ts` run with a piped,
 * non-TTY stdin, so they exercise the silent-default path, not the
 * prompt itself).
 *
 * Contract under test:
 *   - by default the catalog lists the ready scaffold destinations
 *     (`claude` + the stable open-standard `agent-skills`); the universal
 *     `markdown` base declares no scaffold, so it never appears;
 *   - the experimental gate still exists (`includeExperimental`), though no
 *     built-in scaffolder is experimental today, so the flag adds nothing
 *     among built-ins;
 *   - `classifyAnswer` resolves an answer to the row it names.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { classifyAnswer, listScaffoldTargets } from '../tutorial.js';

describe('sm tutorial destination catalog', () => {
  it('lists the ready scaffold destinations by default (claude, agent-skills)', () => {
    const targets = listScaffoldTargets();
    // Only `claude` and `agent-skills` declare a `scaffold.skillDir`; both
    // are stable now, so both appear by default, in registration order.
    assert.deepEqual(
      targets.map((t) => t.id),
      ['claude', 'agent-skills'],
    );
    assert.ok(targets[0]!.skillDir, 'claude must carry a skillDir');
  });

  it('carries the stable open-standard by default; the markdown base never scaffolds', () => {
    const ids = listScaffoldTargets(true).map((t) => t.id);
    assert.ok(ids.includes('claude'), `got ${JSON.stringify(ids)}`);
    // agent-skills is stable and declares a `scaffold.skillDir`, so it is in
    // the default catalog too (no `--experimental` needed).
    assert.ok(ids.includes('agent-skills'), `got ${JSON.stringify(ids)}`);
    assert.ok(listScaffoldTargets().some((t) => t.id === 'agent-skills'));
    // The universal markdown base declares no scaffold, so it never appears.
    assert.ok(!ids.includes('markdown'));
  });
});

describe('sm tutorial classifyAnswer', () => {
  const targets = listScaffoldTargets(true);
  const def = targets[0]!;

  it('accepts the default on an empty answer', () => {
    assert.equal(classifyAnswer('', targets, def)?.id, def.id);
  });

  it('resolves a destination by index and by id', () => {
    assert.equal(classifyAnswer('1', targets, def)?.id, 'claude');
    assert.equal(classifyAnswer('claude', targets, def)?.id, 'claude');
    assert.equal(classifyAnswer('agent-skills', targets, def)?.id, 'agent-skills');
  });

  it('returns null for an unrecognised answer', () => {
    assert.equal(classifyAnswer('garbage', targets, def), null);
  });
});
