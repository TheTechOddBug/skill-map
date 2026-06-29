/**
 * `collectReadExtensions` unit, the deduped union of provider read
 * extensions used to scope the live watcher to scannable file types.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { collectReadExtensions } from '../provider.js';

describe('collectReadExtensions', () => {
  it('defaults to .md when a provider declares no read', () => {
    assert.deepEqual(collectReadExtensions([{}]), ['.md']);
  });

  it('reads a single read rule', () => {
    assert.deepEqual(
      collectReadExtensions([{ read: { extensions: ['.mdc'], parser: 'plain' } }]),
      ['.mdc'],
    );
  });

  it('flattens a multi-rule read array (codex .toml + .md)', () => {
    const exts = collectReadExtensions([
      {
        read: [
          { extensions: ['.toml'], parser: 'toml' },
          { extensions: ['.md'], parser: 'frontmatter-yaml' },
        ],
      },
    ]);
    assert.deepEqual(exts.sort(), ['.md', '.toml']);
  });

  it('dedupes extensions across providers', () => {
    const exts = collectReadExtensions([
      { read: { extensions: ['.md'], parser: 'frontmatter-yaml' } },
      { read: { extensions: ['.md', '.toml'], parser: 'toml' } },
    ]);
    assert.deepEqual(exts.sort(), ['.md', '.toml']);
  });

  it('returns an empty union for no providers', () => {
    assert.deepEqual(collectReadExtensions([]), []);
  });
});
