import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  HOME_PLACEHOLDER,
  PROJECT_PLACEHOLDER,
  QUERY_VALUE_PLACEHOLDER,
  scrubEvent,
  scrubString,
} from '../scrub.js';

describe('scrubString', () => {
  it('redacts a linux /home/<user> prefix, keeps the trailing path', () => {
    assert.equal(
      scrubString('/home/alice/projects/skill-map/x.ts'),
      `${HOME_PLACEHOLDER}/projects/skill-map/x.ts`,
    );
  });

  it('redacts a macOS /Users/<user> prefix', () => {
    assert.equal(
      scrubString('/Users/alice/work/app.js'),
      `${HOME_PLACEHOLDER}/work/app.js`,
    );
  });

  it('redacts a Windows backslash C:\\Users\\<user> prefix', () => {
    assert.equal(
      scrubString('C:\\Users\\alice\\projects\\x.ts'),
      `${HOME_PLACEHOLDER}\\projects\\x.ts`,
    );
  });

  it('redacts a Windows forward-slash C:/Users/<user> prefix', () => {
    assert.equal(
      scrubString('C:/Users/alice/projects/x.ts'),
      `${HOME_PLACEHOLDER}/projects/x.ts`,
    );
  });

  it('redacts the /root account home', () => {
    assert.equal(scrubString('/root/x.ts'), `${HOME_PLACEHOLDER}/x.ts`);
  });

  it('redacts a path embedded mid-message', () => {
    assert.equal(
      scrubString('ENOENT: open /home/bob/secret/notes.md failed'),
      `ENOENT: open ${HOME_PLACEHOLDER}/secret/notes.md failed`,
    );
  });

  it('handles a username with dots and dashes', () => {
    assert.equal(
      scrubString('/home/al.ice-bob/x'),
      `${HOME_PLACEHOLDER}/x`,
    );
  });

  it('redacts multiple home paths in one string', () => {
    assert.equal(
      scrubString('/home/a/x.ts -> /Users/b/y.ts'),
      `${HOME_PLACEHOLDER}/x.ts -> ${HOME_PLACEHOLDER}/y.ts`,
    );
  });

  it('leaves non-home absolute paths untouched (no over-scrub)', () => {
    assert.equal(scrubString('/usr/lib/node/x.js'), '/usr/lib/node/x.js');
    assert.equal(scrubString('/var/log/app.log'), '/var/log/app.log');
  });

  it('leaves a string with no path untouched', () => {
    assert.equal(scrubString('TypeError: cannot read property'), 'TypeError: cannot read property');
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
                { abs_path: '/home/alice/app/dist/cli.js', filename: '/home/alice/app/dist/cli.js' },
              ],
            },
          },
        ],
      },
    };
    const out = scrubEvent(event);
    const frame = out.exception.values[0]?.stacktrace.frames[0];
    assert.equal(frame?.abs_path, `${HOME_PLACEHOLDER}/app/dist/cli.js`);
    assert.equal(frame?.filename, `${HOME_PLACEHOLDER}/app/dist/cli.js`);
  });

  it('redacts the top-level message and the exception value', () => {
    const event = {
      message: 'failed reading /home/alice/notes.md',
      exception: { values: [{ value: 'ENOENT /Users/bob/x.md' }] },
    };
    const out = scrubEvent(event);
    assert.equal(out.message, `failed reading ${HOME_PLACEHOLDER}/notes.md`);
    assert.equal(out.exception.values[0]?.value, `ENOENT ${HOME_PLACEHOLDER}/x.md`);
  });

  it('redacts breadcrumb messages and string data values', () => {
    const event = {
      breadcrumbs: [
        { message: 'cwd /home/alice/p', data: { path: '/home/alice/p/file.md', count: 3 } },
      ],
    };
    const out = scrubEvent(event);
    const crumb = out.breadcrumbs[0];
    assert.equal(crumb?.message, `cwd ${HOME_PLACEHOLDER}/p`);
    assert.equal(crumb?.data.path, `${HOME_PLACEHOLDER}/p/file.md`);
    assert.equal(crumb?.data.count, 3);
  });

  it('redacts a path hidden in an unmodeled nested field', () => {
    const event = { extra: { nested: { deep: ['/home/alice/leak.ts'] } } };
    const out = scrubEvent(event);
    assert.equal(out.extra.nested.deep[0], `${HOME_PLACEHOLDER}/leak.ts`);
  });

  it('strips server_name and user envelope keys', () => {
    const event = {
      server_name: 'alices-macbook.local',
      user: { id: '42', ip_address: '10.0.0.2', username: 'alice' },
      message: 'boom',
    };
    const out = scrubEvent(event) as Record<string, unknown>;
    assert.equal('server_name' in out, false);
    assert.equal('user' in out, false);
    assert.equal(out['message'], 'boom');
  });

  it('does not mutate the input event', () => {
    const event = { message: '/home/alice/x', server_name: 'host' };
    const snapshot = JSON.stringify(event);
    scrubEvent(event);
    assert.equal(JSON.stringify(event), snapshot);
  });

  it('preserves non-string primitives and unknown fields', () => {
    const event = { level: 'error', sampled: true, retries: 0, tags: { verb: 'scan' }, missing: null };
    const out = scrubEvent(event);
    assert.deepEqual(out, event);
  });
});

/**
 * Audit L1: the home patterns only recognise `/home/<u>`, `/Users/<u>`,
 * `C:\Users\<u>` and `/root`, so a checkout anywhere else reached
 * Sentry verbatim and disclosed the project (often the client) name in
 * every frame. The driver supplies its own root; the scrubber stays pure.
 */
describe('scrubString, masked URL query parameters', () => {
  it('masks a percent-encoded node path in a full URL, keeps closed-enum params', () => {
    const out = scrubString(
      'http://127.0.0.1:4242/?kinds=skill&path=.claude%2Fskills%2Fformularios-partes%2FSKILL.md',
    );
    assert.equal(out, `http://127.0.0.1:4242/?kinds=skill&path=${QUERY_VALUE_PLACEHOLDER}`);
  });

  it('masks the operator-typed search text', () => {
    const out = scrubString('http://localhost:4242/?search=my%20secret%20notes&severities=error');
    assert.equal(
      out,
      `http://localhost:4242/?search=${QUERY_VALUE_PLACEHOLDER}&severities=error`,
    );
  });

  it('masks when the param leads the query string and stops at a fragment', () => {
    assert.equal(
      scrubString('/x?path=a%2Fb.md#section'),
      `/x?path=${QUERY_VALUE_PLACEHOLDER}#section`,
    );
  });

  it('never touches a lookalike parameter name', () => {
    assert.equal(scrubString('/x?depath=keep&pathway=keep'), '/x?depath=keep&pathway=keep');
  });

  it('masks case-insensitively', () => {
    assert.equal(scrubString('/x?Path=Secret.md'), `/x?Path=${QUERY_VALUE_PLACEHOLDER}`);
  });
});

describe('scrubString, caller-supplied project roots', () => {
  it('redacts a project root the home patterns cannot see', () => {
    const out = scrubString('at load (/srv/work/client-acme/src/x.ts:12)', [
      '/srv/work/client-acme',
    ]);
    assert.equal(out, `at load (${PROJECT_PLACEHOLDER}/src/x.ts:12)`);
    assert.ok(!out.includes('client-acme'));
  });

  it('redacts a WSL-style mounted root', () => {
    const out = scrubString('/mnt/d/work/client-x/notes.md', ['/mnt/d/work/client-x']);
    assert.equal(out, `${PROJECT_PLACEHOLDER}/notes.md`);
  });

  it('beats the home pattern for a project INSIDE the home dir', () => {
    // `<HOME>/work/acme` would still leak the project name; the project
    // root runs first precisely so it collapses whole.
    const out = scrubString('/home/alice/work/acme/src/x.ts', ['/home/alice/work/acme']);
    assert.equal(out, `${PROJECT_PLACEHOLDER}/src/x.ts`);
    assert.ok(!out.includes('acme'));
  });

  it('still redacts the home dir for paths outside the project root', () => {
    const out = scrubString('/home/alice/other/y.ts', ['/srv/work/acme']);
    assert.equal(out, `${HOME_PLACEHOLDER}/other/y.ts`);
  });

  it('matches roots literally, a regex metacharacter needs no escaping', () => {
    const out = scrubString('/srv/a+b(c)/src/x.ts', ['/srv/a+b(c)']);
    assert.equal(out, `${PROJECT_PLACEHOLDER}/src/x.ts`);
  });

  it('applies the longest root first so a parent cannot shadow a child', () => {
    const out = scrubString('/srv/work/acme/src/x.ts', ['/srv/work', '/srv/work/acme']);
    assert.equal(out, `${PROJECT_PLACEHOLDER}/src/x.ts`);
  });

  it('ignores empty roots instead of redacting everything', () => {
    const out = scrubString('plain message', ['']);
    assert.equal(out, 'plain message');
  });

  it('scrubEvent threads the roots through every nested string', () => {
    const event = {
      message: '/srv/work/acme/a.ts',
      exception: { values: [{ stacktrace: { frames: [{ filename: '/srv/work/acme/b.ts' }] } }] },
    };
    const out = scrubEvent(event, ['/srv/work/acme']) as typeof event;
    assert.equal(out.message, `${PROJECT_PLACEHOLDER}/a.ts`);
    assert.equal(
      out.exception.values[0]!.stacktrace.frames[0]!.filename,
      `${PROJECT_PLACEHOLDER}/b.ts`,
    );
  });
});
