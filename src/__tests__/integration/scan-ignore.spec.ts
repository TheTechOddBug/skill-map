/**
 * Step 6.4, `.skillmapignore` parser + scan integration. Two layers:
 *
 *   1. Unit tests for `buildIgnoreFilter`, defaults, config.ignore,
 *      .skillmapignore text, negation, layering.
 *   2. End-to-end via `runScan`, assert the walker actually skips
 *      directories the filter excludes (and includes the ones it
 *      doesn't).
 */

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createKernel, runScan } from '../../kernel/index.js';
import { builtIns } from '../../plugins/built-ins.js';
import {
  buildIgnoreFilter,
  composeScopeIgnoreFilter,
  readGitignoreText,
  readIgnoreFileText,
} from '../../kernel/scan/ignore.js';

let root: string;
let counter = 0;

function freshScope(label: string): string {
  counter += 1;
  const dir = join(root, `${label}-${counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(dir: string, rel: string, body: string): void {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
}

function writeMd(dir: string, rel: string, kind: string): void {
  writeFile(
    dir,
    rel,
    `---\nname: ${rel}\nkind: ${kind}\n---\nbody for ${rel}\n`,
  );
}

before(() => {
  root = mkdtempSync(join(tmpdir(), 'skill-map-ignore-'));
});

after(() => {
  rmSync(root, { recursive: true, force: true });
});

// -----------------------------------------------------------------------------
// Unit tests on the filter
// -----------------------------------------------------------------------------

describe('buildIgnoreFilter, defaults', () => {
  it('skips .git, node_modules, dist, .tmp, .skill-map by default', () => {
    const filter = buildIgnoreFilter();
    assert.equal(filter.ignores('.git/HEAD'), true);
    assert.equal(filter.ignores('node_modules/foo'), true);
    assert.equal(filter.ignores('dist/index.js'), true);
    assert.equal(filter.ignores('.tmp/scratch.md'), true);
    assert.equal(filter.ignores('.skill-map/skill-map.db'), true);
  });

  it('does NOT skip ordinary files', () => {
    const filter = buildIgnoreFilter();
    assert.equal(filter.ignores('README.md'), false);
    assert.equal(filter.ignores('docs/getting-started.md'), false);
    assert.equal(filter.ignores('.claude/agents/foo.md'), false);
  });

  it('empty / root path is never ignored', () => {
    const filter = buildIgnoreFilter();
    assert.equal(filter.ignores(''), false);
    assert.equal(filter.ignores('.'), false);
  });
});

describe('buildIgnoreFilter, configIgnore layer', () => {
  it('adds patterns from config.ignore on top of defaults', () => {
    const filter = buildIgnoreFilter({ configIgnore: ['*.draft.md'] });
    assert.equal(filter.ignores('skills/wip.draft.md'), true);
    assert.equal(filter.ignores('skills/final.md'), false);
  });

  it('directory pattern matches descendants', () => {
    const filter = buildIgnoreFilter({ configIgnore: ['private/'] });
    assert.equal(filter.ignores('private/secret.md'), true);
    assert.equal(filter.ignores('public/secret.md'), false);
  });
});

describe('buildIgnoreFilter, ignoreFileText layer', () => {
  it('parses a real .skillmapignore body with comments + blank lines', () => {
    // Real `.skillmapignore` files have no leading indent; gitignore
    // syntax treats whitespace as part of the pattern.
    const text = '# comment line, ignored\n*.bak\n\nlegacy/\n';
    const filter = buildIgnoreFilter({ ignoreFileText: text });
    assert.equal(filter.ignores('skills/foo.bak'), true);
    assert.equal(filter.ignores('legacy/old.md'), true);
    assert.equal(filter.ignores('skills/foo.md'), false);
  });
});

describe('buildIgnoreFilter, gitignoreText layer', () => {
  it('excludes whatever the .gitignore text excludes', () => {
    const filter = buildIgnoreFilter({ gitignoreText: 'build/\n*.gen.md\n' });
    assert.equal(filter.ignores('build/out.md'), true);
    assert.equal(filter.ignores('skills/foo.gen.md'), true);
    assert.equal(filter.ignores('skills/foo.md'), false);
  });

  it('.skillmapignore can !-re-include a path the .gitignore excluded (later layer wins)', () => {
    // Precedence: defaults -> .gitignore -> config.ignore -> .skillmapignore.
    const filter = buildIgnoreFilter({
      gitignoreText: 'generated/*.md\n',
      ignoreFileText: '!generated/keep.md\n',
    });
    assert.equal(filter.ignores('generated/drop.md'), true);
    assert.equal(filter.ignores('generated/keep.md'), false);
  });
});

describe('buildIgnoreFilter, layering', () => {
  it('combines all three layers; later layers can negate earlier ones', () => {
    // gitignore semantics: re-including a file inside an excluded
    // directory is not possible. Use a file pattern instead so the
    // negation can actually take effect.
    const filter = buildIgnoreFilter({
      configIgnore: ['*.draft.md'],
      ignoreFileText: '!skills/keep.draft.md',
    });
    assert.equal(filter.ignores('skills/wip.draft.md'), true);
    assert.equal(filter.ignores('skills/keep.draft.md'), false);
    assert.equal(filter.ignores('any.log'), true); // default still applies
  });

  it('includeDefaults: false skips bundled defaults', () => {
    const filter = buildIgnoreFilter({
      includeDefaults: false,
      configIgnore: ['*.tmp.md'],
    });
    // defaults would have skipped node_modules, without them, they pass
    assert.equal(filter.ignores('node_modules/foo'), false);
    // but the explicit pattern still applies
    assert.equal(filter.ignores('scratch.tmp.md'), true);
  });
});

describe('readIgnoreFileText', () => {
  it('returns the file contents when present', () => {
    const dir = freshScope('readignore-present');
    writeFileSync(join(dir, '.skillmapignore'), '*.draft.md\n');
    const text = readIgnoreFileText(dir);
    assert.equal(text, '*.draft.md\n');
  });

  it('returns undefined when missing', () => {
    const dir = freshScope('readignore-missing');
    assert.equal(readIgnoreFileText(dir), undefined);
  });
});

describe('readGitignoreText', () => {
  it('returns the .gitignore contents when present', () => {
    const dir = freshScope('readgitignore-present');
    writeFileSync(join(dir, '.gitignore'), 'dist/\n');
    assert.equal(readGitignoreText(dir), 'dist/\n');
  });

  it('returns undefined when missing', () => {
    const dir = freshScope('readgitignore-missing');
    assert.equal(readGitignoreText(dir), undefined);
  });
});

describe('composeScopeIgnoreFilter, .gitignore opt-in (scan.respectGitignore)', () => {
  it('does NOT read .gitignore by default (flag off): a git-ignored path is not excluded', () => {
    const dir = freshScope('compose-default-off');
    writeFileSync(join(dir, '.gitignore'), 'generated/\n');
    const filter = composeScopeIgnoreFilter(dir);
    // .gitignore is not folded in, so its path is NOT excluded...
    assert.equal(filter.ignores('generated/leaked.md'), false);
    // ...while the bundled defaults still apply.
    assert.equal(filter.ignores('node_modules/foo'), true);
  });

  it('reads .gitignore when respectGitignore is true', () => {
    const dir = freshScope('compose-on');
    writeFileSync(join(dir, '.gitignore'), 'generated/\n');
    const filter = composeScopeIgnoreFilter(dir, undefined, { respectGitignore: true });
    assert.equal(filter.ignores('generated/leaked.md'), true);
  });

  it('with the flag on, .skillmapignore can !-re-include a git-ignored file', () => {
    const dir = freshScope('compose-on-negate');
    writeFileSync(join(dir, '.gitignore'), 'generated/*.md\n');
    writeFileSync(join(dir, '.skillmapignore'), '!generated/keep.md\n');
    const filter = composeScopeIgnoreFilter(dir, undefined, { respectGitignore: true });
    assert.equal(filter.ignores('generated/drop.md'), true);
    assert.equal(filter.ignores('generated/keep.md'), false);
  });
});

// -----------------------------------------------------------------------------
// End-to-end through runScan
// -----------------------------------------------------------------------------

describe('scan integration, filter applied at the walker', () => {
  it('respects .skillmapignore patterns: drafts are excluded from the result', async () => {
    const dir = freshScope('e2e-skipignore');
    writeMd(dir, '.claude/agents/keep.md', 'agent');
    writeMd(dir, '.claude/agents/wip.draft.md', 'agent');
    writeFileSync(join(dir, '.skillmapignore'), '*.draft.md\n');

    const filter = buildIgnoreFilter({
      ignoreFileText: readIgnoreFileText(dir),
    });
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [dir],
      extensions: builtIns(),
      ignoreFilter: filter,
    });

    const paths = result.nodes.map((n) => n.path).sort();
    assert.deepEqual(paths, ['.claude/agents/keep.md']);
  });

  it('respects config.ignore patterns even without a .skillmapignore file', async () => {
    const dir = freshScope('e2e-config-ignore');
    writeMd(dir, '.claude/agents/included.md', 'agent');
    writeMd(dir, 'private/excluded.md', 'agent');

    const filter = buildIgnoreFilter({ configIgnore: ['private/'] });
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [dir],
      extensions: builtIns(),
      ignoreFilter: filter,
    });

    const paths = result.nodes.map((n) => n.path).sort();
    assert.deepEqual(paths, ['.claude/agents/included.md']);
  });

  it('default filter still skips node_modules / .git when no extra config supplied', async () => {
    const dir = freshScope('e2e-defaults');
    writeMd(dir, '.claude/agents/real.md', 'agent');
    writeMd(dir, 'node_modules/junk/leaked.md', 'agent');
    writeMd(dir, '.git/leaked.md', 'agent');

    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [dir],
      extensions: builtIns(),
      ignoreFilter: buildIgnoreFilter(),
    });

    const paths = result.nodes.map((n) => n.path).sort();
    assert.deepEqual(paths, ['.claude/agents/real.md']);
  });

  it('respects .gitignore: a git-ignored .md is absent from the scan result', async () => {
    const dir = freshScope('e2e-gitignore');
    writeMd(dir, '.claude/agents/keep.md', 'agent');
    writeMd(dir, 'generated/leaked.md', 'agent');
    writeFileSync(join(dir, '.gitignore'), 'generated/\n');

    const filter = buildIgnoreFilter({
      gitignoreText: readGitignoreText(dir),
    });
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [dir],
      extensions: builtIns(),
      ignoreFilter: filter,
    });

    const paths = result.nodes.map((n) => n.path).sort();
    assert.deepEqual(paths, ['.claude/agents/keep.md']);
  });

  it('scan.respectGitignore off (default): a git-ignored .md IS indexed', async () => {
    // Both files live under `.claude/` so the Claude Provider claims
    // them; the `.gitignore` basename pattern matches `secret.md` at any
    // depth. With the flag off, `composeScopeIgnoreFilter` never reads
    // `.gitignore`, so the git-ignored note still reaches the graph.
    const dir = freshScope('e2e-gitignore-off');
    writeMd(dir, '.claude/agents/keep.md', 'agent');
    writeMd(dir, '.claude/agents/secret.md', 'agent');
    writeFileSync(join(dir, '.gitignore'), 'secret.md\n');

    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [dir],
      extensions: builtIns(),
      ignoreFilter: composeScopeIgnoreFilter(dir, undefined),
    });

    const paths = result.nodes.map((n) => n.path).sort();
    assert.deepEqual(paths, ['.claude/agents/keep.md', '.claude/agents/secret.md']);
  });

  it('scan.respectGitignore on: the same git-ignored .md is excluded', async () => {
    const dir = freshScope('e2e-gitignore-on');
    writeMd(dir, '.claude/agents/keep.md', 'agent');
    writeMd(dir, '.claude/agents/secret.md', 'agent');
    writeFileSync(join(dir, '.gitignore'), 'secret.md\n');

    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [dir],
      extensions: builtIns(),
      ignoreFilter: composeScopeIgnoreFilter(dir, undefined, { respectGitignore: true }),
    });

    const paths = result.nodes.map((n) => n.path).sort();
    assert.deepEqual(paths, ['.claude/agents/keep.md']);
  });

  it('negation: ignore-file un-includes a file the config layer excluded', async () => {
    // gitignore can't re-include files inside an excluded directory,
    // so the config layer uses a file-glob (`.claude/private/*`)
    // instead of a directory pattern. The walker still descends and
    // the negation re-includes keep.md. Paths sit under `.claude/`
    // so the Claude Provider claims them (post-Phase-B classify is
    // strict, files outside any Provider's territory are dropped).
    const dir = freshScope('e2e-negation');
    writeMd(dir, '.claude/private/keep.md', 'agent');
    writeMd(dir, '.claude/private/skip.md', 'agent');
    writeFileSync(join(dir, '.skillmapignore'), '!.claude/private/keep.md\n');

    const filter = buildIgnoreFilter({
      configIgnore: ['.claude/private/*'],
      ignoreFileText: readIgnoreFileText(dir),
    });
    const kernel = await createKernel();
    const result = await runScan(kernel, {
      roots: [dir],
      extensions: builtIns(),
      ignoreFilter: filter,
    });

    const paths = result.nodes.map((n) => n.path).sort();
    assert.deepEqual(paths, ['.claude/private/keep.md']);
  });
});
