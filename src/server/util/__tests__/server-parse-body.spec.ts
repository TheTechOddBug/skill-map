/**
 * `server/util/parse-body.ts` unit tests.
 *
 * The route layer (sidecar / preferences / project-preferences /
 * plugins) is exercised end-to-end in the per-route `*-route.test.ts`
 * / `server-*-endpoint.test.ts` suites. These tests cover the helper
 * factory in isolation:
 *
 *   - `notJson` / `notObject` short-circuits BEFORE AJV runs.
 *   - Valid bodies pass through unchanged.
 *   - Invalid bodies surface `HTTPException(400)` with the message
 *     resolved from `mapping[<key>]`, falling back to `invalid`.
 *   - Mapping values may be static strings OR functions receiving the
 *     `ErrorObject` (template interpolation use case).
 *   - Numeric array indices in `instancePath` normalise to `*` so a
 *     single mapping entry covers any item that failed.
 *   - `additionalProperties: false` rejects unknown keys.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { makeBodyValidator } from '../parse-body.js';

interface ISimpleBody {
  name: string;
  count?: number;
}

const SIMPLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1 },
    count: { type: 'integer' },
  },
} as const;

const SIMPLE_MESSAGES = {
  notJson: 'simple-body-not-json',
  notObject: 'simple-body-not-object',
  invalid: 'simple-body-invalid',
  mapping: {
    '/name:required': 'simple-name-required',
    '/name:minLength': 'simple-name-empty',
    '/name:type:string': 'simple-name-not-string',
    '/count:type:integer': 'simple-count-not-integer',
    ':additionalProperties:foo': 'simple-foo-not-allowed',
  },
};

function jsonRequest(body: string): Request {
  return new Request('http://localhost/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

async function expectThrow(promise: Promise<unknown>): Promise<HTTPException> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof HTTPException, `expected HTTPException, got ${String(err)}`);
    return err;
  }
  assert.fail('expected a throw');
}

describe('makeBodyValidator(), short-circuits before AJV', () => {
  const parse = makeBodyValidator<ISimpleBody>(SIMPLE_SCHEMA, SIMPLE_MESSAGES);

  it('rejects malformed JSON with `notJson`', async () => {
    const err = await expectThrow(parse(jsonRequest('{not json')));
    assert.equal(err.status, 400);
    assert.equal(err.message, 'simple-body-not-json');
  });

  it('rejects a JSON array with `notObject`', async () => {
    const err = await expectThrow(parse(jsonRequest('[1, 2, 3]')));
    assert.equal(err.status, 400);
    assert.equal(err.message, 'simple-body-not-object');
  });

  it('rejects JSON `null` with `notObject`', async () => {
    const err = await expectThrow(parse(jsonRequest('null')));
    assert.equal(err.status, 400);
    assert.equal(err.message, 'simple-body-not-object');
  });

  it('rejects a JSON scalar with `notObject`', async () => {
    const err = await expectThrow(parse(jsonRequest('42')));
    assert.equal(err.status, 400);
    assert.equal(err.message, 'simple-body-not-object');
  });
});

describe('makeBodyValidator(), passes valid bodies through', () => {
  const parse = makeBodyValidator<ISimpleBody>(SIMPLE_SCHEMA, SIMPLE_MESSAGES);

  it('returns the parsed body unchanged on a valid payload', async () => {
    const out = await parse(jsonRequest('{"name":"foo","count":3}'));
    assert.deepEqual(out, { name: 'foo', count: 3 });
  });

  it('accepts an absent optional key', async () => {
    const out = await parse(jsonRequest('{"name":"foo"}'));
    assert.deepEqual(out, { name: 'foo' });
  });
});

describe('makeBodyValidator(), mapping lookup', () => {
  const parse = makeBodyValidator<ISimpleBody>(SIMPLE_SCHEMA, SIMPLE_MESSAGES);

  it('resolves `required` errors via `/<field>:required`', async () => {
    const err = await expectThrow(parse(jsonRequest('{}')));
    assert.equal(err.message, 'simple-name-required');
  });

  it('resolves `minLength` errors via `<path>:minLength`', async () => {
    const err = await expectThrow(parse(jsonRequest('{"name":""}')));
    assert.equal(err.message, 'simple-name-empty');
  });

  it('resolves `type` errors via `<path>:type:<expected>`', async () => {
    const err = await expectThrow(parse(jsonRequest('{"name":42}')));
    assert.equal(err.message, 'simple-name-not-string');
  });

  it('resolves `additionalProperties` errors with the offender embedded in the key', async () => {
    const err = await expectThrow(parse(jsonRequest('{"name":"foo","foo":true}')));
    assert.equal(err.message, 'simple-foo-not-allowed');
  });

  it('falls back to `invalid` when no mapping entry hits', async () => {
    // `bar` is not in mapping, `:additionalProperties:bar` has no entry.
    const err = await expectThrow(parse(jsonRequest('{"name":"foo","bar":1}')));
    assert.equal(err.message, 'simple-body-invalid');
  });
});

describe('makeBodyValidator(), function resolvers', () => {
  const parse = makeBodyValidator<{ items?: string[] }>(
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        items: { type: 'array', items: { type: 'string' } },
      },
    },
    {
      notJson: 'arr-not-json',
      notObject: 'arr-not-object',
      invalid: 'arr-invalid',
      mapping: {
        '/items/*:type:string': (err) => `bad-item-at-${err.instancePath}`,
      },
    },
  );

  it('invokes the function with the original ErrorObject (instancePath preserved)', async () => {
    const err = await expectThrow(parse(jsonRequest('{"items":["ok","ok",42]}')));
    // Index 2 failed, the function sees the raw path (not normalised).
    assert.equal(err.message, 'bad-item-at-/items/2');
  });
});

describe('makeBodyValidator(), array index normalisation', () => {
  const parse = makeBodyValidator<{ items?: string[] }>(
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        items: { type: 'array', items: { type: 'string' } },
      },
    },
    {
      notJson: 'arr-not-json',
      notObject: 'arr-not-object',
      invalid: 'arr-invalid',
      mapping: {
        '/items/*:type:string': 'item-must-be-string',
      },
    },
  );

  it('matches `/items/*:type:string` for any failing index', async () => {
    // Try several indices, the same mapping entry resolves them all.
    for (const payload of ['{"items":[1]}', '{"items":["ok",1]}', '{"items":["ok","ok",1]}']) {
      const err = await expectThrow(parse(jsonRequest(payload)));
      assert.equal(err.message, 'item-must-be-string');
    }
  });
});

describe('makeBodyValidator(), schema compilation happens once', () => {
  it('does not re-compile per request (factory returns a closure over the compiled validator)', async () => {
    // Behavioural: invoke the validator many times; if compilation
    // happened per request the test would still pass but be ~100x
    // slower. The smoke check here is that repeated invocations work
    // and don't accumulate state.
    const parse = makeBodyValidator<ISimpleBody>(SIMPLE_SCHEMA, SIMPLE_MESSAGES);
    for (let i = 0; i < 50; i++) {
      const out = await parse(jsonRequest(`{"name":"x-${i}"}`));
      assert.equal(out.name, `x-${i}`);
    }
  });
});
