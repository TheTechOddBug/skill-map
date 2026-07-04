/**
 * Non-destructive merge / removal round-trip for the activity bridge's
 * `json-hooks` entries (see `spec/provider-activity.md` and
 * `hooks-merge.ts`). The load-bearing assertions: operator
 * hooks survive untouched, install is idempotent, and uninstall
 * restores the original document shape exactly.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { IActivityInstallEvent } from '../../../kernel/extensions/index.js';
import { hasActivityHooks, mergeActivityHooks, removeActivityHooks } from '../hooks-merge.js';

const MARKER = '.skill-map/activity/bridge.js';
const COMMAND = `node ${MARKER} claude`;

const EVENTS: readonly IActivityInstallEvent[] = [
  { event: 'UserPromptExpansion', matcher: '*' },
  { event: 'PreToolUse', matcher: '^(Skill|Agent)$' },
  { event: 'SubagentStart', matcher: '*' },
  { event: 'SubagentStop', matcher: '*' },
];

/** A realistic user settings.json: pre-existing hooks + unrelated keys. */
function userSettings(): Record<string, unknown> {
  return {
    permissions: { allow: ['Bash(ls:*)'] },
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'node .claude/hooks/my-guard.mjs' }],
        },
      ],
      Stop: [{ hooks: [{ type: 'command', command: './notify.sh' }] }],
    },
  };
}

describe('mergeActivityHooks', () => {
  it('appends our entries while preserving every operator hook', () => {
    const settings = userSettings();
    const result = mergeActivityHooks(settings, EVENTS, COMMAND, MARKER);
    assert.equal(result.changed, true);
    assert.deepEqual(result.alreadyWired, []);

    const hooks = settings['hooks'] as Record<string, unknown[]>;
    // Operator's PreToolUse guard is still first; ours appended after.
    assert.equal(hooks['PreToolUse']?.length, 2);
    assert.deepEqual(hooks['PreToolUse']?.[0], userSettings()['hooks']!['PreToolUse' as never][0]);
    assert.deepEqual(hooks['PreToolUse']?.[1], {
      matcher: '^(Skill|Agent)$',
      hooks: [{ type: 'command', command: COMMAND }],
    });
    // Untouched operator event and unrelated top-level keys survive.
    assert.equal(hooks['Stop']?.length, 1);
    assert.deepEqual(settings['permissions'], { allow: ['Bash(ls:*)'] });
    // New events created for the ones the user did not have.
    assert.equal(hooks['UserPromptExpansion']?.length, 1);
    assert.equal(hooks['SubagentStart']?.length, 1);
    assert.equal(hooks['SubagentStop']?.length, 1);
  });

  it('is idempotent: a second merge changes nothing', () => {
    const settings = userSettings();
    mergeActivityHooks(settings, EVENTS, COMMAND, MARKER);
    const snapshot = JSON.stringify(settings);

    const second = mergeActivityHooks(settings, EVENTS, COMMAND, MARKER);
    assert.equal(second.changed, false);
    assert.equal(second.alreadyWired.length, EVENTS.length);
    assert.equal(JSON.stringify(settings), snapshot);
  });

  it('starts from an empty document (fresh project, no settings.json)', () => {
    const settings: Record<string, unknown> = {};
    const result = mergeActivityHooks(settings, EVENTS, COMMAND, MARKER);
    assert.equal(result.changed, true);
    const hooks = settings['hooks'] as Record<string, unknown[]>;
    assert.equal(Object.keys(hooks).length, EVENTS.length);
  });

  it('refuses to clobber a foreign non-object `hooks` value', () => {
    const settings: Record<string, unknown> = { hooks: 'not an object' };
    assert.throws(() => mergeActivityHooks(settings, EVENTS, COMMAND, MARKER));
    assert.equal(settings['hooks'], 'not an object');
  });
});

describe('removeActivityHooks', () => {
  it('install -> uninstall restores the original document exactly', () => {
    const settings = userSettings();
    const original = JSON.stringify(settings);

    mergeActivityHooks(settings, EVENTS, COMMAND, MARKER);
    const changed = removeActivityHooks(settings, MARKER);

    assert.equal(changed, true);
    assert.equal(JSON.stringify(settings), original);
  });

  it('uninstall on a never-installed document is a no-op', () => {
    const settings = userSettings();
    const original = JSON.stringify(settings);
    assert.equal(removeActivityHooks(settings, MARKER), false);
    assert.equal(JSON.stringify(settings), original);
  });

  it('prunes the hooks object entirely when we were its only content', () => {
    const settings: Record<string, unknown> = {};
    mergeActivityHooks(settings, EVENTS, COMMAND, MARKER);
    removeActivityHooks(settings, MARKER);
    assert.deepEqual(settings, {});
  });

  it('hasActivityHooks: read-only probe flips with wiring and never mutates', () => {
    const settings = userSettings();
    assert.equal(hasActivityHooks(settings, MARKER), false);

    mergeActivityHooks(settings, EVENTS, COMMAND, MARKER);
    const wired = JSON.stringify(settings);
    assert.equal(hasActivityHooks(settings, MARKER), true);
    assert.equal(JSON.stringify(settings), wired);

    removeActivityHooks(settings, MARKER);
    assert.equal(hasActivityHooks(settings, MARKER), false);
  });

  it('hasActivityHooks: false on empty / malformed hooks shapes', () => {
    assert.equal(hasActivityHooks({}, MARKER), false);
    assert.equal(hasActivityHooks({ hooks: 'not-an-object' }, MARKER), false);
    assert.equal(hasActivityHooks({ hooks: { PreToolUse: 'not-an-array' } }, MARKER), false);
  });
});
