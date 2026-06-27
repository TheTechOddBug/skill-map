/**
 * Unit coverage for the `sm tutorial` destination catalog + answer
 * classifier. These are the pure pieces behind the interactive prompt
 * (the spawn-based tests in `tutorial-cli.spec.ts` run with a piped,
 * non-TTY stdin, so they exercise the silent-default path, not the
 * prompt itself).
 *
 * Contract under test:
 *   - by default the catalog lists the ready scaffold destinations
 *     (`claude`, the beta rich-track `codex`, and the stable open-standard
 *     `agent-skills`); the universal `markdown` base declares no scaffold, so
 *     it never appears;
 *   - the experimental gate still exists (`includeExperimental`), though no
 *     built-in scaffolder is experimental today, so the flag adds nothing
 *     among built-ins;
 *   - `classifyAnswer` resolves an answer to the row it names.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { classifyAnswer, labelWithAka, listScaffoldTargets } from '../tutorial.js';
import { TUTORIAL_TEXTS } from '../../i18n/tutorial.texts.js';

describe('sm tutorial destination catalog', () => {
  it('lists the ready scaffold destinations by default (claude, codex, agent-skills)', () => {
    const targets = listScaffoldTargets();
    // claude (stable, rich), codex (beta, rich) and agent-skills (stable,
    // basic) all declare a `scaffold.skillDir`; beta ships enabled, so all
    // three appear by default, in registration order.
    assert.deepEqual(
      targets.map((t) => t.id),
      ['claude', 'codex', 'agent-skills'],
    );
    assert.ok(targets[0]!.skillDir, 'claude must carry a skillDir');
    // Codex shares the `.agents/skills` territory with the basic family, so it
    // carries a `.codex` marker the verb drops to disambiguate its lens.
    assert.equal(targets.find((t) => t.id === 'codex')?.marker, '.codex');
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

describe('sm tutorial prompt rendering', () => {
  const targets = listScaffoldTargets();
  const byId = (id: string) => targets.find((t) => t.id === id)!;

  it('renders Claude and Codex by their plain vendor label (no aka)', () => {
    assert.equal(labelWithAka(byId('claude')), "Anthropic's Claude");
    assert.equal(labelWithAka(byId('codex')), "OpenAI's Codex");
  });

  it('leads with the aka vendor for the open standard, provider label in parens', () => {
    // Several providers share `.agents/skills`, so the folder cannot identify
    // the lens; the vendor name does. The open standard leads with its aka
    // vendor (Antigravity) and keeps the standard label as the qualifier.
    assert.equal(
      labelWithAka(byId('agent-skills')),
      "Google's Antigravity (Standard: Agent skills)",
    );
  });

  it('omits the destination folder from the option template', () => {
    // The folder is deliberately not interpolated: `.agents/skills` is shared
    // by codex + agent-skills, so showing it would be ambiguous.
    assert.ok(!TUTORIAL_TEXTS.promptOption.includes('skillDir'));
    assert.ok(TUTORIAL_TEXTS.promptOption.includes('{{label}}'));
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
