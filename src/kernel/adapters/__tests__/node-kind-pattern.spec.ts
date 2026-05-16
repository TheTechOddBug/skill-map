/**
 * `node.schema.json#/properties/kind` pattern conformance, audit
 * `app-hacker` H1.
 *
 * The UI uses the kind name as a fragment of CSS custom-property
 * identifiers (`--sm-kind-<name>`) injected into a `<style>` tag. A
 * Provider that emits a kind containing `;`, `{`, `}`, quotes, or
 * whitespace could break out of the declaration context and inject
 * arbitrary CSS rules (defacement, redress, exfiltration via `url()`).
 * The schema now constrains kind names to a CSS-safe identifier shape,
 * `^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`, enforced by AJV at the kernel
 * boundary so a hostile or buggy Provider can never reach the UI's
 * `<style>` sink.
 *
 * Tests use the cached, baked-in AJV validator (`loadSchemaValidators`)
 * so we exercise the same code path the orchestrator uses for every
 * node it builds.
 */

import { describe, it } from 'node:test';
import { strictEqual, ok } from 'node:assert';

import { loadSchemaValidators } from '../schema-validators.js';

function makeNode(kind: string): Record<string, unknown> {
  return {
    path: 'demo.md',
    kind,
    provider: 'claude',
    bodyHash: 'a'.repeat(64),
    frontmatterHash: 'b'.repeat(64),
    bytes: { frontmatter: 0, body: 0, total: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
  };
}

describe('node.schema.json kind pattern, audit H1, valid kinds accepted', () => {
  const validators = loadSchemaValidators();

  const ACCEPTED = [
    'skill',
    'agent',
    'command',
    'markdown',
    'cursorRule',
    'obsidian_canvas',
    'a',
    'a-b',
    'a_b',
    'a1',
    'A1B2',
    'a'.repeat(64),
  ];

  for (const good of ACCEPTED) {
    it(`accepts kind: ${JSON.stringify(good)}`, () => {
      const result = validators.validate('node', makeNode(good));
      strictEqual(result.ok, true, `expected accepted, got error: ${result.ok ? '' : result.errors}`);
    });
  }
});

describe('node.schema.json kind pattern, audit H1, CSS-unsafe kinds rejected', () => {
  const validators = loadSchemaValidators();

  const REJECTED: ReadonlyArray<readonly [string, string]> = [
    ['x; }', 'closes the CSS rule and starts a new one'],
    ['x { ', 'opens a block mid-declaration'],
    ['x"onload', 'breaks out of an attribute context'],
    ['x y', 'whitespace inside the identifier'],
    ['<script>', 'angle brackets'],
    ['0agent', 'leading digit'],
    ['-agent', 'leading hyphen'],
    ['_agent', 'leading underscore (not a letter)'],
    ['agent.dot', 'dot is not in the allowed alphabet'],
    ['agent/slash', 'slash is not in the allowed alphabet'],
    ['agent\\backslash', 'backslash is not in the allowed alphabet'],
    ['a'.repeat(65), 'exceeds 64-char ceiling'],
    ['', 'empty (also fails minLength: 1)'],
  ];

  for (const [bad, reason] of REJECTED) {
    it(`rejects kind: ${JSON.stringify(bad)} (${reason})`, () => {
      const result = validators.validate('node', makeNode(bad));
      strictEqual(
        result.ok,
        false,
        `expected rejected for "${bad}" (${reason}), but it was accepted`,
      );
      if (!result.ok) {
        ok(
          /pattern|minLength|must match pattern/.test(result.errors),
          `expected pattern/minLength error, got: ${result.errors}`,
        );
      }
    });
  }
});
