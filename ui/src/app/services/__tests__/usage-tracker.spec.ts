import { describe, expect, it } from 'vitest';

import { viewNameFor } from '../usage-tracker';

/**
 * `viewNameFor` is the pure route -> `ui.view.<view>` name-suffix mapping. It
 * reads the path prefix only (never the query string), so no filter state can
 * leak into a usage event, and the suffix is a closed set so the PostHog event
 * catalog stays bounded.
 */
describe('viewNameFor', () => {
  it('maps the map route (and root redirect) to map', () => {
    expect(viewNameFor('/map')).toBe('map');
    expect(viewNameFor('/map?tag=foo&kind=skill')).toBe('map');
    expect(viewNameFor('/')).toBe('map');
  });

  it('maps the files route to files', () => {
    expect(viewNameFor('/files')).toBe('files');
    expect(viewNameFor('/files?q=x')).toBe('files');
  });

  it('returns null for untracked routes', () => {
    expect(viewNameFor('/something-else')).toBeNull();
  });
});
