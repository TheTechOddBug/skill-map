import { describe, expect, it } from 'vitest';

import {
  HOME_PLACEHOLDER,
  PROJECT_PLACEHOLDER,
  QUERY_VALUE_PLACEHOLDER,
  scrubEvent,
  scrubString,
} from '../scrub';

/**
 * Hostile-input coverage for the UI scrubber. Mirrors the CLI suite at
 * `src/core/telemetry/__tests__/scrub.spec.ts` so the two ports stay in
 * lockstep: linux / macOS / Windows / root home redaction, embedded
 * mid-message paths, non-home paths untouched, and `scrubEvent` walking
 * nested fields + stripping `server_name` / `user` + never mutating.
 *
 * The UI port is dependency-free and intentionally has no Sentry import,
 * so this runs as a plain unit spec through `ng test` (the
 * `@angular/build:unit-test` builder) with Vitest's `describe/it/expect`.
 */

describe('scrubString', () => {
  it('redacts a linux /home/<user> prefix, keeps the trailing path', () => {
    expect(scrubString('/home/alice/projects/skill-map/x.ts')).toBe(
      `${HOME_PLACEHOLDER}/projects/skill-map/x.ts`,
    );
  });

  it('redacts a macOS /Users/<user> prefix', () => {
    expect(scrubString('/Users/alice/work/app.js')).toBe(
      `${HOME_PLACEHOLDER}/work/app.js`,
    );
  });

  it('redacts a Windows backslash C:\\Users\\<user> prefix', () => {
    expect(scrubString('C:\\Users\\alice\\projects\\x.ts')).toBe(
      `${HOME_PLACEHOLDER}\\projects\\x.ts`,
    );
  });

  it('redacts a Windows forward-slash C:/Users/<user> prefix', () => {
    expect(scrubString('C:/Users/alice/projects/x.ts')).toBe(
      `${HOME_PLACEHOLDER}/projects/x.ts`,
    );
  });

  it('redacts the /root account home', () => {
    expect(scrubString('/root/x.ts')).toBe(`${HOME_PLACEHOLDER}/x.ts`);
  });

  it('redacts a path embedded mid-message', () => {
    expect(scrubString('ENOENT: open /home/bob/secret/notes.md failed')).toBe(
      `ENOENT: open ${HOME_PLACEHOLDER}/secret/notes.md failed`,
    );
  });

  it('handles a username with dots and dashes', () => {
    expect(scrubString('/home/al.ice-bob/x')).toBe(`${HOME_PLACEHOLDER}/x`);
  });

  it('redacts multiple home paths in one string', () => {
    expect(scrubString('/home/a/x.ts -> /Users/b/y.ts')).toBe(
      `${HOME_PLACEHOLDER}/x.ts -> ${HOME_PLACEHOLDER}/y.ts`,
    );
  });

  it('leaves non-home absolute paths untouched (no over-scrub)', () => {
    expect(scrubString('/usr/lib/node/x.js')).toBe('/usr/lib/node/x.js');
    expect(scrubString('/var/log/app.log')).toBe('/var/log/app.log');
  });

  it('leaves a string with no path untouched', () => {
    expect(scrubString('TypeError: cannot read property')).toBe(
      'TypeError: cannot read property',
    );
  });
});

describe('scrubString, extraRoots (project-root collapse)', () => {
  it('collapses the project root BEFORE the home patterns, hiding the project name', () => {
    expect(
      scrubString('/home/alice/work/acme-client/docs/x.md', ['/home/alice/work/acme-client']),
    ).toBe(`${PROJECT_PLACEHOLDER}/docs/x.md`);
  });

  it('matches roots literally, so regex metacharacters need no escaping', () => {
    expect(scrubString('/srv/repo (v2)/a.md', ['/srv/repo (v2)'])).toBe(
      `${PROJECT_PLACEHOLDER}/a.md`,
    );
  });

  it('applies roots longest-first so a nested root is not shadowed by its parent', () => {
    expect(scrubString('/srv/repo/nested/file', ['/srv/repo', '/srv/repo/nested'])).toBe(
      `${PROJECT_PLACEHOLDER}/file`,
    );
  });

  it('empty / absent roots leave the home-only behavior unchanged', () => {
    expect(scrubString('/home/alice/x', [])).toBe(`${HOME_PLACEHOLDER}/x`);
    expect(scrubString('/home/alice/x', [''])).toBe(`${HOME_PLACEHOLDER}/x`);
  });

  it('threads roots through the scrubEvent walk', () => {
    const scrubbed = scrubEvent(
      { message: 'boom at /home/a/proj/file.md' },
      ['/home/a/proj'],
    );
    expect(scrubbed.message).toBe(`boom at ${PROJECT_PLACEHOLDER}/file.md`);
  });
});

describe('scrubString, masked URL query parameters', () => {
  it('masks the percent-encoded node path in $current_url, keeps closed-enum params', () => {
    expect(
      scrubString(
        'http://127.0.0.1:4242/?kinds=skill&path=.claude%2Fskills%2Fformularios-partes%2FSKILL.md',
      ),
    ).toBe(`http://127.0.0.1:4242/?kinds=skill&path=${QUERY_VALUE_PLACEHOLDER}`);
  });

  it('masks the operator-typed search text, stops at the next param', () => {
    expect(scrubString('/?search=budget%20plan&favoritesOnly=true')).toBe(
      `/?search=${QUERY_VALUE_PLACEHOLDER}&favoritesOnly=true`,
    );
  });

  it('never touches a lookalike parameter name', () => {
    expect(scrubString('/x?depath=keep&pathway=keep')).toBe('/x?depath=keep&pathway=keep');
  });

  it('masks $current_url through the scrubEvent walk', () => {
    const event = {
      event: 'ui.view.workspace',
      properties: { $current_url: 'http://localhost:4242/?path=agents%2Fmain.md' },
    };
    const out = scrubEvent(event);
    expect(out.properties.$current_url).toBe(
      `http://localhost:4242/?path=${QUERY_VALUE_PLACEHOLDER}`,
    );
  });
});

describe('scrubEvent', () => {
  it('redacts abs_path and filename in stack frames', () => {
    const event = {
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                {
                  abs_path: '/home/alice/app/dist/cli.js',
                  filename: '/home/alice/app/dist/cli.js',
                },
              ],
            },
          },
        ],
      },
    };
    const out = scrubEvent(event);
    const frame = out.exception.values[0]?.stacktrace.frames[0];
    expect(frame?.abs_path).toBe(`${HOME_PLACEHOLDER}/app/dist/cli.js`);
    expect(frame?.filename).toBe(`${HOME_PLACEHOLDER}/app/dist/cli.js`);
  });

  it('redacts the top-level message and the exception value', () => {
    const event = {
      message: 'failed reading /home/alice/notes.md',
      exception: { values: [{ value: 'ENOENT /Users/bob/x.md' }] },
    };
    const out = scrubEvent(event);
    expect(out.message).toBe(`failed reading ${HOME_PLACEHOLDER}/notes.md`);
    expect(out.exception.values[0]?.value).toBe(`ENOENT ${HOME_PLACEHOLDER}/x.md`);
  });

  it('redacts breadcrumb messages and string data values', () => {
    const event = {
      breadcrumbs: [
        { message: 'cwd /home/alice/p', data: { path: '/home/alice/p/file.md', count: 3 } },
      ],
    };
    const out = scrubEvent(event);
    const crumb = out.breadcrumbs[0];
    expect(crumb?.message).toBe(`cwd ${HOME_PLACEHOLDER}/p`);
    expect(crumb?.data.path).toBe(`${HOME_PLACEHOLDER}/p/file.md`);
    expect(crumb?.data.count).toBe(3);
  });

  it('redacts a path hidden in an unmodeled nested field', () => {
    const event = { extra: { nested: { deep: ['/home/alice/leak.ts'] } } };
    const out = scrubEvent(event);
    expect(out.extra.nested.deep[0]).toBe(`${HOME_PLACEHOLDER}/leak.ts`);
  });

  it('strips server_name and user envelope keys', () => {
    const event = {
      server_name: 'alices-macbook.local',
      user: { id: '42', ip_address: '10.0.0.2', username: 'alice' },
      message: 'boom',
    };
    const out = scrubEvent(event) as Record<string, unknown>;
    expect('server_name' in out).toBe(false);
    expect('user' in out).toBe(false);
    expect(out['message']).toBe('boom');
  });

  it('does not mutate the input event', () => {
    const event = { message: '/home/alice/x', server_name: 'host' };
    const snapshot = JSON.stringify(event);
    scrubEvent(event);
    expect(JSON.stringify(event)).toBe(snapshot);
  });

  it('preserves non-string primitives and unknown fields', () => {
    const event = { level: 'error', sampled: true, retries: 0, tags: { verb: 'scan' }, missing: null };
    const out = scrubEvent(event);
    expect(out).toEqual(event);
  });
});
