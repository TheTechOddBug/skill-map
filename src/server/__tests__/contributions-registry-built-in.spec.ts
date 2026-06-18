import { describe, it } from 'node:test';
import { strictEqual, ok } from 'node:assert';

import { buildBuiltInContributionsRegistry } from '../index.js';

/**
 * Guards the helper the demo dataset build consumes
 * (`web/scripts/build-demo-dataset.js`). The demo scans with
 * `--no-plugins`, so the registry it embeds must come from the
 * built-ins-only kernel. If this drifts to empty (or loses a known
 * counter), the public web demo silently regresses to value-only
 * counters with blank icons (the bug this helper was added to fix),
 * with no coverage to catch it, that was the original gap.
 */
describe('buildBuiltInContributionsRegistry', () => {
  it('returns a non-empty registry of built-in view contributions', () => {
    const registry = buildBuiltInContributionsRegistry();
    ok(Object.keys(registry).length > 0, 'expected at least one built-in entry');
  });

  it('carries the known counter icons (tools / link / external-url)', () => {
    const registry = buildBuiltInContributionsRegistry();

    const tools = registry['claude/tools-counter/count'];
    ok(tools, 'expected claude/tools-counter/count entry');
    strictEqual(tools.icon, 'pi-wrench');

    const linksIn = registry['core/link-counter/linksIn'];
    ok(linksIn, 'expected core/link-counter/linksIn entry');
    strictEqual(linksIn.icon, 'pi-download');

    const linksOut = registry['core/link-counter/linksOut'];
    ok(linksOut, 'expected core/link-counter/linksOut entry');
    strictEqual(linksOut.icon, 'pi-upload');

    const externalUrls = registry['core/external-url-counter/count'];
    ok(externalUrls, 'expected core/external-url-counter/count entry');
    strictEqual(externalUrls.icon, 'pi-link');
  });

  it('keys every entry by its qualified id and echoes the parts', () => {
    const registry = buildBuiltInContributionsRegistry();
    for (const [qualifiedId, entry] of Object.entries(registry)) {
      strictEqual(
        qualifiedId,
        `${entry.pluginId}/${entry.extensionId}/${entry.contributionId}`,
      );
      strictEqual(typeof entry.slot, 'string');
    }
  });
});
