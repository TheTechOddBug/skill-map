import { describe, it } from 'node:test';
import { strictEqual } from 'node:assert';

import { resolveWatcherBackend } from '../runtime.js';

describe('resolveWatcherBackend', () => {
  it('returns the persisted backend when no override is present', () => {
    strictEqual(resolveWatcherBackend('chokidar'), 'chokidar');
    strictEqual(resolveWatcherBackend('parcel'), 'parcel');
  });

  it('an override wins over the persisted backend', () => {
    strictEqual(resolveWatcherBackend('chokidar', 'parcel'), 'parcel');
    strictEqual(resolveWatcherBackend('parcel', 'chokidar'), 'chokidar');
  });

  it('an undefined override falls back to the persisted backend', () => {
    strictEqual(resolveWatcherBackend('parcel', undefined), 'parcel');
    strictEqual(resolveWatcherBackend('chokidar', undefined), 'chokidar');
  });
});
