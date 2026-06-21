/**
 * Unit coverage for the `sm tutorial` destination catalog + answer
 * classifier. These are the pure pieces behind the interactive prompt
 * (the spawn-based tests in `tutorial-cli.spec.ts` run with a piped,
 * non-TTY stdin, so they exercise the silent-default path, not the
 * prompt itself).
 *
 * Contract under test:
 *   - the catalog lists `claude` as the only selectable destination and
 *     the coming-soon vendors (`openai`, `agent-skills`, ...) as
 *     non-selectable teasers;
 *   - `classifyAnswer` resolves an answer to the row it names, so the
 *     prompt loop can re-ask when a coming-soon row is picked.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  classifyAnswer,
  listScaffoldTargets,
  selectableTargets,
} from '../tutorial.js';

describe('sm tutorial destination catalog', () => {
  it('lists claude as the only selectable destination', () => {
    const selectable = selectableTargets(listScaffoldTargets());
    assert.deepEqual(
      selectable.map((t) => t.id),
      ['claude'],
    );
    assert.equal(selectable[0]!.comingSoon, false);
    assert.ok(selectable[0]!.skillDir, 'claude must carry a skillDir');
  });

  it('lists the coming-soon vendors as non-selectable teasers', () => {
    const targets = listScaffoldTargets();
    const comingSoon = targets.filter((t) => t.comingSoon).map((t) => t.id);
    // openai + agent-skills are coming-soon today; they appear in the
    // prompt but cannot be picked.
    assert.ok(comingSoon.includes('openai'), `got ${JSON.stringify(comingSoon)}`);
    assert.ok(comingSoon.includes('agent-skills'), `got ${JSON.stringify(comingSoon)}`);
    // The universal markdown fallback is neither selectable nor coming-soon.
    assert.ok(!targets.some((t) => t.id === 'markdown'));
  });
});

describe('sm tutorial classifyAnswer', () => {
  const targets = listScaffoldTargets();
  const def = selectableTargets(targets)[0]!;

  it('accepts the default on an empty answer', () => {
    assert.equal(classifyAnswer('', targets, def)?.id, def.id);
  });

  it('resolves the selectable destination by index and by id', () => {
    assert.equal(classifyAnswer('1', targets, def)?.id, 'claude');
    assert.equal(classifyAnswer('claude', targets, def)?.id, 'claude');
  });

  it('resolves a coming-soon row but flags it comingSoon (caller re-asks)', () => {
    const openai = classifyAnswer('openai', targets, def);
    assert.equal(openai?.id, 'openai');
    assert.equal(openai?.comingSoon, true);
  });

  it('returns null for an unrecognised answer', () => {
    assert.equal(classifyAnswer('garbage', targets, def), null);
  });
});
