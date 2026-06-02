import { describe, expect, it } from 'vitest';

import { viewNameFor } from '../usage-tracker';

/**
 * `viewNameFor` is the pure route -> `ui.view.<view>` name-suffix mapping. It
 * reads the path prefix only (never the query string), so no filter state can
 * leak into a usage event, and the suffix is a closed set so the PostHog event
 * catalog stays bounded.
 */
describe('viewNameFor', () => {
  it('maps the workspace route to workspace', () => {
    expect(viewNameFor('/')).toBe('workspace');
    expect(viewNameFor('/?path=agents/architect.md')).toBe('workspace');
    expect(viewNameFor('/?tag=foo&kind=skill')).toBe('workspace');
  });

  it('returns null for untracked routes', () => {
    expect(viewNameFor('/something-else')).toBeNull();
  });
});
