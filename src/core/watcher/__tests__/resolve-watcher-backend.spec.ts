import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import { resolveWatcherBackend } from '../runtime.js';

describe('resolveWatcherBackend', () => {
  it('auto + followSymlinks off resolves to parcel (the scaling default)', () => {
    strictEqual(resolveWatcherBackend({ backend: 'auto', followSymlinks: false }), 'parcel');
  });

  it('auto + followSymlinks on resolves to chokidar (live symlink watch)', () => {
    strictEqual(resolveWatcherBackend({ backend: 'auto', followSymlinks: true }), 'chokidar');
  });

  it("explicit 'parcel' forces parcel regardless of followSymlinks", () => {
    strictEqual(resolveWatcherBackend({ backend: 'parcel', followSymlinks: true }), 'parcel');
    strictEqual(resolveWatcherBackend({ backend: 'parcel', followSymlinks: false }), 'parcel');
  });

  it("explicit 'chokidar' forces chokidar regardless of followSymlinks", () => {
    strictEqual(resolveWatcherBackend({ backend: 'chokidar', followSymlinks: false }), 'chokidar');
    strictEqual(resolveWatcherBackend({ backend: 'chokidar', followSymlinks: true }), 'chokidar');
  });
});
