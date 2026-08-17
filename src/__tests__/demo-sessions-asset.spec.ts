/**
 * Guard over `web/scripts/demo-sessions.json`, the CURATED session
 * recordings the demo bundle ships so its Sessions tab can replay a
 * believable run (spec `provider-activity.md` §Session journal; user
 * decision 2026-08-17). Hand-authored data drifts two ways, and this
 * pins both from the only workspace that carries AJV + the spec:
 *
 *   1. Shape: every recording must validate against
 *      `session-recording.schema.json`, or the demo's reader would
 *      silently SKIP it (the off-shape dialect) and the tab ships empty.
 *   2. Reference: every `nodePath` / `childNodePath` must name a real
 *      `fixtures/demo/` file (or an `mcp://` virtual), or the replay
 *      lights nothing for that frame and the curated story quietly rots
 *      when the fixture is reorganized.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadSchemaValidators } from '../kernel/adapters/schema-validators.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const ASSET = join(REPO_ROOT, 'web', 'scripts', 'demo-sessions.json');
const FIXTURE_ROOT = join(REPO_ROOT, 'fixtures', 'demo');

interface IFrameData {
  nodePath?: string;
  childNodePath?: string;
  parentNodePath?: string;
}

interface IRecording {
  sessionId?: string;
  frames: Array<{ data: IFrameData }>;
}

function loadAsset(): IRecording[] {
  return JSON.parse(readFileSync(ASSET, 'utf8')) as IRecording[];
}

describe('demo-sessions curated asset', () => {
  it('every recording validates against session-recording.schema.json', () => {
    const validators = loadSchemaValidators();
    const sessions = loadAsset();
    assert.ok(sessions.length > 0, 'the demo ships at least one curated session');
    for (const recording of sessions) {
      const result = validators.validate('session-recording', recording);
      const detail = result.ok ? '' : result.errors;
      assert.equal(result.ok, true, `${recording.sessionId ?? '(no id)'}: ${detail}`);
    }
  });

  it('every referenced path exists in fixtures/demo (mcp:// virtuals aside)', () => {
    for (const recording of loadAsset()) {
      for (const frame of recording.frames) {
        const paths = [frame.data.nodePath, frame.data.childNodePath, frame.data.parentNodePath];
        for (const path of paths) {
          if (path === undefined || path.startsWith('mcp://')) continue;
          assert.equal(
            existsSync(join(FIXTURE_ROOT, path)),
            true,
            `${recording.sessionId ?? '(no id)'} references a missing fixture path: ${path}`,
          );
        }
      }
    }
  });
});
