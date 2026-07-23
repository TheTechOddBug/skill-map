/**
 * `GET /api/config/resolution` integration tests (the settings-hierarchy
 * viewer's data, `spec/cli-contract.md` §Serve route table): flattened
 * leaf rows with per-key layer provenance, and server-side masking of
 * `secret`-typed plugin settings.
 */

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  bootAndUse,
  serverUrl,
  setupProbProject,
  SKILL_NODE,
  type IProbProject,
} from './helpers/prob-fixture.js';

interface IRow {
  key: string;
  value: unknown;
  layer: string;
  secret: boolean;
}

let tmpRoot: string;
let project: IProbProject;

before(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'skill-map-config-resolution-'));
  project = await setupProbProject(join(tmpRoot, 'proj'), [SKILL_NODE], {
    installSkill: false,
  });
  // Project layer: flip a real leaf; project-local layer: a secret-typed
  // plugin setting value (github/enrichment declares `token` as secret).
  writeFileSync(
    join(project.root, '.skill-map', 'settings.json'),
    JSON.stringify({ scan: { respectGitignore: true } }),
  );
  writeFileSync(
    join(project.root, '.skill-map', 'settings.local.json'),
    JSON.stringify({
      plugins: {
        github: { extensions: { enrichment: { settings: { token: 'hunter2' } } } },
      },
    }),
  );
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('GET /api/config/resolution', () => {
  it('flattens leaf rows with layer provenance and masks secret settings', async () => {
    await bootAndUse(project, async (handle) => {
      const res = await fetch(serverUrl(handle, '/api/config/resolution'));
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        kind: string;
        value: { rows: IRow[] };
      };
      assert.equal(body.kind, 'config.resolution');
      const byKey = new Map(body.value.rows.map((r) => [r.key, r]));

      // A project-layer override wins with its provenance.
      assert.equal(byKey.get('scan.respectGitignore')?.value, true);
      assert.equal(byKey.get('scan.respectGitignore')?.layer, 'project');

      // An untouched key reads from defaults.
      assert.equal(byKey.get('scan.strict')?.layer, 'defaults');

      // Rows are LEAVES only: no row for the parent group.
      assert.equal(byKey.has('scan'), false);

      // The secret-typed plugin setting is masked, never in clear.
      const token = byKey.get('plugins.github.extensions.enrichment.settings.token');
      assert.ok(token, 'secret setting row present');
      assert.equal(token.secret, true);
      assert.equal(token.layer, 'project-local');
      assert.notEqual(token.value, 'hunter2');
      assert.ok(!JSON.stringify(body).includes('hunter2'), 'clear value never on the wire');
    });
  });
});
