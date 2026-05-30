import { describe, expect, it } from 'vitest';

import { viewSurfaceFor } from '../usage-tracker';

/**
 * `viewSurfaceFor` is the pure route -> `ui.view` surface mapping. It reads
 * the path prefix only (never the query string), so no filter state can leak
 * into a usage event.
 */
describe('viewSurfaceFor', () => {
  it('maps the map route (and root redirect) to graph', () => {
    expect(viewSurfaceFor('/map')).toBe('graph');
    expect(viewSurfaceFor('/map?tag=foo&kind=skill')).toBe('graph');
    expect(viewSurfaceFor('/')).toBe('graph');
  });

  it('maps the files route to files', () => {
    expect(viewSurfaceFor('/files')).toBe('files');
    expect(viewSurfaceFor('/files?q=x')).toBe('files');
  });

  it('returns null for untracked routes', () => {
    expect(viewSurfaceFor('/something-else')).toBeNull();
  });
});
