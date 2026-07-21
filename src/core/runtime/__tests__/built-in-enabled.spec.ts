/**
 * Unit tests for `built-in-enabled.ts`, the enabled gate for DIRECT
 * built-in extension use outside the composed catalogs (2026-07-21
 * sweep). Consumers: `sm bump` (single-extension form) and the CLI
 * entry's boot/shutdown hook dispatcher (resolver-factory form). The
 * semantics under test are the composer's own: live toggle from the
 * project's layered config over the installed default derived from
 * `stability` + `defaultEnabled`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { strictEqual } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { builtInEnabledResolverFor, isBuiltInEnabledFor } from '../built-in-enabled.js';

let tmpRoot: string;
let counter = 0;

function freshProject(settings?: Record<string, unknown>): string {
  counter += 1;
  const root = join(tmpRoot, `proj-${counter}`);
  mkdirSync(join(root, '.skill-map'), { recursive: true });
  if (settings !== undefined) {
    writeFileSync(join(root, '.skill-map', 'settings.json'), JSON.stringify(settings), 'utf8');
  }
  return root;
}

before(() => {
  // AGENTS.md baseline, temp files always under `.tmp/`.
  const projectTmp = resolve(process.cwd(), '.tmp');
  mkdirSync(projectTmp, { recursive: true });
  tmpRoot = mkdtempSync(join(projectTmp, 'built-in-enabled-'));
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('isBuiltInEnabledFor', () => {
  it('a stable extension with no config entry is enabled (installed default)', () => {
    const cwd = freshProject();
    strictEqual(
      isBuiltInEnabledFor(cwd, { pluginId: 'core', id: 'update-check', stability: 'stable' }),
      true,
    );
  });

  it('defaultEnabled: false ships disabled even with no config entry (the sm bump gate)', () => {
    const cwd = freshProject();
    strictEqual(
      isBuiltInEnabledFor(cwd, {
        pluginId: 'core',
        id: 'node-bump',
        stability: 'stable',
        defaultEnabled: false,
      }),
      false,
    );
  });

  it('an explicit per-extension enable overrides the opt-out default', () => {
    const cwd = freshProject({
      plugins: { core: { extensions: { 'node-bump': { enabled: true } } } },
    });
    strictEqual(
      isBuiltInEnabledFor(cwd, {
        pluginId: 'core',
        id: 'node-bump',
        stability: 'stable',
        defaultEnabled: false,
      }),
      true,
    );
  });

  it('an explicit per-extension disable overrides the enabled default (the boot-hook gate)', () => {
    const cwd = freshProject({
      plugins: { core: { extensions: { 'update-check': { enabled: false } } } },
    });
    strictEqual(
      isBuiltInEnabledFor(cwd, { pluginId: 'core', id: 'update-check', stability: 'stable' }),
      false,
    );
  });

  it('a plugin-level disable takes the whole plugin down with it', () => {
    const cwd = freshProject({ plugins: { core: { enabled: false } } });
    strictEqual(
      isBuiltInEnabledFor(cwd, { pluginId: 'core', id: 'update-check', stability: 'stable' }),
      false,
    );
  });
});

describe('builtInEnabledResolverFor', () => {
  it('one config read answers for a whole extension list (the dispatcher filter shape)', () => {
    const cwd = freshProject({
      plugins: { core: { extensions: { 'update-check': { enabled: false } } } },
    });
    const enabled = builtInEnabledResolverFor(cwd);
    const hooks = [
      { pluginId: 'core', id: 'update-check', stability: 'stable' as const },
      { pluginId: 'core', id: 'other-hook', stability: 'stable' as const },
    ];
    strictEqual(hooks.filter(enabled).map((h) => h.id).join(','), 'other-hook');
  });
});
