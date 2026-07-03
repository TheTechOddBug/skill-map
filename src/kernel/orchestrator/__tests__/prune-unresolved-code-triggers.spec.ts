/**
 * Unit tests for the code-region trigger resolution gate
 * (`prune-unresolved-code-triggers`, spec/architecture.md §Extractor ·
 * code-region triggers). The rule: an unresolved `mentions` / `invokes`
 * link whose EVERY occurrence carries a code-region context is removed;
 * anything with a prose occurrence, a resolution, no occurrence data,
 * or a path-style kind passes through untouched.
 */

import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import { pruneUnresolvedCodeTriggers } from '../prune-unresolved-code-triggers.js';
import type { Link, LinkOccurrence } from '../../types.js';

function occurrence(over: Partial<LinkOccurrence> = {}): LinkOccurrence {
  return {
    extractor: 'backtick-mention',
    originalTrigger: '@reviewer',
    location: { line: 1 },
    ...over,
  };
}

function mention(over: Partial<Link> = {}): Link {
  return {
    source: 'src.md',
    target: '@reviewer',
    kind: 'mentions',
    confidence: 1.0,
    sources: ['backtick-mention'],
    trigger: { originalTrigger: '@reviewer', normalizedTrigger: '@reviewer' },
    ...over,
  };
}

function invocation(over: Partial<Link> = {}): Link {
  return {
    source: 'src.md',
    target: '/deploy',
    kind: 'invokes',
    confidence: 1.0,
    sources: ['backtick-slash'],
    trigger: { originalTrigger: '/deploy', normalizedTrigger: '/deploy' },
    ...over,
  };
}

describe('pruneUnresolvedCodeTriggers', () => {
  it('prunes an unresolved mention whose only occurrence is an inline code span', () => {
    const links = [mention({ occurrences: [occurrence({ context: 'inline-code' })] })];
    strictEqual(pruneUnresolvedCodeTriggers(links).length, 0);
  });

  it('prunes an unresolved mention whose occurrences are all code regions (span + fence)', () => {
    const links = [
      mention({
        occurrences: [
          occurrence({ context: 'inline-code' }),
          occurrence({ context: 'code-block', location: { line: 5 } }),
        ],
      }),
    ];
    strictEqual(pruneUnresolvedCodeTriggers(links).length, 0);
  });

  it('prunes an unresolved invocation whose only occurrence is a code region', () => {
    const links = [
      invocation({
        occurrences: [
          occurrence({ extractor: 'backtick-slash', originalTrigger: '/tmp', context: 'inline-code' }),
        ],
      }),
    ];
    strictEqual(pruneUnresolvedCodeTriggers(links).length, 0);
  });

  it('keeps a resolved mention even when every occurrence is a code region', () => {
    const links = [
      mention({
        resolvedTarget: '.claude/agents/reviewer.md',
        occurrences: [occurrence({ context: 'code-block' })],
      }),
    ];
    strictEqual(pruneUnresolvedCodeTriggers(links).length, 1);
  });

  it('keeps a resolved invocation even when every occurrence is a code region', () => {
    const links = [
      invocation({
        resolvedTarget: '.claude/skills/deploy/SKILL.md',
        occurrences: [
          occurrence({ extractor: 'backtick-slash', originalTrigger: '/deploy', context: 'code-block' }),
        ],
      }),
    ];
    strictEqual(pruneUnresolvedCodeTriggers(links).length, 1);
  });

  it('keeps an unresolved trigger that has at least one prose occurrence', () => {
    // Prose at-directive emit merged with a backtick-mention emit via
    // dedupeLinks: the prose half is authored intent, so the merged
    // edge survives and stays eligible for the broken flag. Same rule
    // for a prose slash-command merged with a backtick-slash.
    const links = [
      mention({
        sources: ['at-directive', 'backtick-mention'],
        occurrences: [
          occurrence({ extractor: 'at-directive' }),
          occurrence({ context: 'inline-code', location: { line: 9 } }),
        ],
      }),
      invocation({
        sources: ['slash-command', 'backtick-slash'],
        occurrences: [
          occurrence({ extractor: 'slash-command', originalTrigger: '/ghost' }),
          occurrence({ extractor: 'backtick-slash', originalTrigger: '/ghost', context: 'code-block' }),
        ],
      }),
    ];
    strictEqual(pruneUnresolvedCodeTriggers(links).length, 2);
  });

  it('keeps an unresolved trigger with no occurrence data (synthetic emission)', () => {
    strictEqual(pruneUnresolvedCodeTriggers([mention()]).length, 1);
    strictEqual(pruneUnresolvedCodeTriggers([invocation({ occurrences: [] })]).length, 1);
  });

  it('never touches path-style kinds, unresolved code-region points still flag broken', () => {
    const points: Link = {
      source: 'src.md',
      target: 'refs/missing.md',
      kind: 'points',
      confidence: 1.0,
      sources: ['backtick-path'],
      occurrences: [
        { extractor: 'backtick-path', originalTrigger: 'refs/missing.md', context: 'inline-code' },
      ],
    };
    strictEqual(pruneUnresolvedCodeTriggers([points]).length, 1);
  });

  it('treats an escaped context as non-code (no prune)', () => {
    const links = [mention({ occurrences: [occurrence({ context: 'escaped' })] })];
    strictEqual(pruneUnresolvedCodeTriggers(links).length, 1);
  });
});
