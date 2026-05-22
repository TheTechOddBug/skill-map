import { describe, it, before, after } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveProviderWalk } from '../../../../../kernel/extensions/index.js';
import { claudeProvider } from '../index.js';

let root: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'claude-provider-'));

  const write = (rel: string, content: string) => {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };

  write(
    '.claude/agents/backend.md',
    [
      '---',
      'name: backend',
      'description: Backend architect',
      'metadata:',
      '  version: 1.0.0',
      '---',
      'Body text.',
    ].join('\n'),
  );
  write(
    '.claude/commands/deploy.md',
    ['---', 'name: deploy', '---', '/deploy body'].join('\n'),
  );
  write(
    '.claude/skills/code-review/SKILL.md',
    ['---', 'name: code-review', '---', 'Skill body.'].join('\n'),
  );
  write('notes/readme.md', 'Plain note.');
  write('.git/HEAD', 'ref: refs/heads/main'); // should be ignored
  write('node_modules/foo/thing.md', 'should be ignored');
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('claude provider', () => {
  it('walks the scope and yields one node per markdown file', async () => {
    const collected: string[] = [];
    for await (const n of resolveProviderWalk(claudeProvider)([root])) {
      collected.push(n.path);
    }
    collected.sort();
    deepStrictEqual(collected, [
      '.claude/agents/backend.md',
      '.claude/commands/deploy.md',
      '.claude/skills/code-review/SKILL.md',
      'notes/readme.md',
    ]);
  });

  it('parses frontmatter via yaml and leaves body intact', async () => {
    for await (const n of resolveProviderWalk(claudeProvider)([root])) {
      if (n.path !== '.claude/agents/backend.md') continue;
      strictEqual((n.frontmatter as { name?: string }).name, 'backend');
      strictEqual((n.frontmatter as { description?: string }).description, 'Backend architect');
      strictEqual(n.body.trim(), 'Body text.');
      return;
    }
    ok(false, 'backend.md not found');
  });

  it('classifies paths by convention; disclaims everything else', () => {
    strictEqual(claudeProvider.classify('.claude/agents/x.md', {}), 'agent');
    strictEqual(claudeProvider.classify('.claude/commands/y.md', {}), 'command');
    strictEqual(claudeProvider.classify('.claude/skills/n/SKILL.md', {}), 'skill');
    // spec 0.18.0: markdown is no longer claude's territory. Files
    // under `.claude/hooks/`, `notes/`, `CLAUDE.md`, and arbitrary
    // markdown at the root are disclaimed here so the built-in
    // `core/markdown` Provider picks them up via its universal
    // fallback classify.
    strictEqual(claudeProvider.classify('.claude/hooks/z.md', {}), null);
    strictEqual(claudeProvider.classify('notes/readme.md', {}), null);
    strictEqual(claudeProvider.classify('CLAUDE.md', {}), null);
    strictEqual(claudeProvider.classify('random.md', {}), null);
    // Foreign vendor territory, also disclaimed.
    strictEqual(claudeProvider.classify('.codex/agents/x.toml', {}), null);
    strictEqual(claudeProvider.classify('.agents/skills/foo/SKILL.md', {}), null);
    // Supporting files inside a skill folder are NOT skills themselves.
    // Only `<name>/SKILL.md` is the canonical entry-point; helpers,
    // README, references, and nested SKILL.md files are disclaimed so
    // `core/markdown` claims them as plain markdown.
    strictEqual(claudeProvider.classify('.claude/skills/foo/README.md', {}), null);
    strictEqual(claudeProvider.classify('.claude/skills/foo/helpers.md', {}), null);
    strictEqual(claudeProvider.classify('.claude/skills/foo/sub/SKILL.md', {}), null);
    // Case-insensitive match on the filename.
    strictEqual(claudeProvider.classify('.claude/skills/foo/skill.md', {}), 'skill');
  });

  it('handles files with no frontmatter', async () => {
    // Use a node that has no frontmatter, `notes/readme.md` is plain prose.
    for await (const n of resolveProviderWalk(claudeProvider)([root])) {
      if (n.path !== 'notes/readme.md') continue;
      deepStrictEqual(n.frontmatter, {});
      strictEqual(n.body, 'Plain note.');
      return;
    }
    ok(false, 'notes/readme.md not found');
  });

  // Phase 3 (spec 0.8.0): the Provider owns its per-kind frontmatter
  // schemas. Smoke-test that every kind it can classify into has a
  // catalog entry whose schemaJson AJV-validates against the live
  // provider-frontmatter validator built from the Provider itself.
  it('every kind it classifies into resolves a per-kind schema via provider.kinds', async () => {
    const { buildProviderFrontmatterValidator } = await import('../../../../../kernel/adapters/schema-validators.js');
    const validator = buildProviderFrontmatterValidator([claudeProvider]);
    const kinds = ['skill', 'agent', 'command'] as const;
    for (const kind of kinds) {
      const entry = claudeProvider.kinds[kind];
      ok(entry, `claude provider must declare a catalog entry for kind ${kind}`);
      // A minimal frontmatter that satisfies base required fields. The
      // per-kind schemas all extend base via $ref-by-$id; if the loader
      // could not resolve the cross-package $ref this would surface as
      // a compile-time AJV error during `buildProviderFrontmatterValidator`.
      const fm = { name: 'x', description: 'y', metadata: { version: '1.0.0' } };
      const result = validator.validate(claudeProvider, kind, fm);
      ok(result.ok, `frontmatter for kind ${kind} must validate; got: ${result.ok ? '' : result.errors}`);
    }
  });

  // Step 14.5.d: every kind declares its UI presentation so the BFF can
  // build the kindRegistry and the UI never has to hardcode visuals for
  // a built-in. The shape lives in `IProviderKindUi`; this assertion is
  // a contract guard, not a value assertion (specific colors / labels
  // can drift across releases).
  it('every kind declares ui presentation (label + color, optional dark + emoji + icon)', () => {
    const kinds = ['skill', 'agent', 'command'] as const;
    for (const kind of kinds) {
      const entry = claudeProvider.kinds[kind];
      ok(entry, `claude provider must declare a catalog entry for kind ${kind}`);
      ok(entry.ui, `kind ${kind} must declare ui presentation`);
      ok(typeof entry.ui.label === 'string' && entry.ui.label.length > 0, `kind ${kind} ui.label must be a non-empty string`);
      ok(/^#[0-9a-fA-F]{6}$/.test(entry.ui.color), `kind ${kind} ui.color must be #RRGGBB`);
      if (entry.ui.colorDark !== undefined) {
        ok(/^#[0-9a-fA-F]{6}$/.test(entry.ui.colorDark), `kind ${kind} ui.colorDark must be #RRGGBB when present`);
      }
      if (entry.ui.icon !== undefined) {
        ok(entry.ui.icon.kind === 'pi' || entry.ui.icon.kind === 'svg', `kind ${kind} ui.icon.kind must be 'pi' or 'svg'`);
        if (entry.ui.icon.kind === 'pi') {
          ok(/^pi-[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.ui.icon.id), `kind ${kind} ui.icon.id must match pi-* pattern`);
        } else {
          ok(entry.ui.icon.path.length > 0, `kind ${kind} ui.icon.path must be non-empty`);
        }
      }
    }
  });
});
