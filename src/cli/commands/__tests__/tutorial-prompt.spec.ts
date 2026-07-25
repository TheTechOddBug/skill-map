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

import {
  listScaffoldDestinations,
  listScaffoldTargets,
} from '../../../core/agent-skill/targets.js';
import { classifyAnswer, labelWithAka } from '../tutorial.js';
import { TUTORIAL_TEXTS } from '../../i18n/tutorial.texts.js';

describe('sm tutorial destination catalog', () => {
  it('lists the ready scaffold destinations by default (claude, codex, agent-skills)', () => {
    const targets = listScaffoldDestinations();
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
    const ids = listScaffoldDestinations(true).map((t) => t.id);
    assert.ok(ids.includes('claude'), `got ${JSON.stringify(ids)}`);
    // agent-skills is stable and declares a `scaffold.skillDir`, so it is in
    // the default catalog too (no `--experimental` needed).
    assert.ok(ids.includes('agent-skills'), `got ${JSON.stringify(ids)}`);
    assert.ok(listScaffoldDestinations().some((t) => t.id === 'agent-skills'));
    // The universal markdown base declares no scaffold, so it never appears.
    assert.ok(!ids.includes('markdown'));
  });
});

describe('sm tutorial prompt rendering', () => {
  const targets = listScaffoldDestinations();
  const byId = (id: string) => targets.find((t) => t.id === id)!;

  it('renders Claude and Codex by their plain vendor label (no aka)', () => {
    assert.equal(labelWithAka(byId('claude')), "Anthropic's Claude");
    assert.equal(labelWithAka(byId('codex')), "OpenAI's Codex");
  });

  it('leads with the standard label for the open lens, supporting vendors in parens', () => {
    // Several providers share `.agents/skills`, so the folder cannot identify
    // the lens. The basic book teaches the open standard itself, so the
    // standard label leads and the vendors that build on it (Antigravity and
    // OpenCode, then a trailing `others`) follow in parens, never the other
    // way round.
    assert.equal(
      labelWithAka(byId('agent-skills')),
      "Standard: Agent skills (Google's Antigravity, OpenCode, others)",
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
  const targets = listScaffoldDestinations(true);
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

describe('shared-territory lenses (sharedWith)', () => {
  /**
   * `antigravity` and `opencode` READ the open `.agents/skills` territory
   * that `agent-skills` owns, so they resolve as PER-LENS targets (a skill
   * installed there is discovered by their runtime, so `sm agent install /
   * status` and the Quick Start row must work under those lenses) but are
   * NOT separate destination choices: one territory stays one prompt row.
   */
  it('per-lens catalog resolves the sharing lenses, marked with their owner', () => {
    const byId = new Map(listScaffoldTargets(true).map((t) => [t.id, t]));
    for (const id of ['antigravity', 'opencode']) {
      const row = byId.get(id);
      assert.ok(row, `${id} must resolve as a per-lens target`);
      assert.equal(row!.skillDir, '.agents/skills');
      assert.equal(row!.sharedWith, 'agent-skills');
    }
  });

  it('the destination catalog lists owners only (no duplicate territory rows)', () => {
    const ids = listScaffoldDestinations(true).map((t) => t.id);
    assert.ok(!ids.includes('antigravity'), `got ${JSON.stringify(ids)}`);
    assert.ok(!ids.includes('opencode'), `got ${JSON.stringify(ids)}`);
    assert.ok(ids.includes('agent-skills'), 'the owner still leads its territory');
  });
});
