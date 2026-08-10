/**
 * Map-views routes, read + write the committed view files under
 * `<cwd>/.skill-map/views/` from the UI (`spec/map-views.md`).
 *
 *   GET    /api/map-views         → { schemaVersion, kind, views, skipped }
 *   PUT    /api/map-views/:slug   → upsert one view, refreshed GET envelope
 *   DELETE /api/map-views/:slug   → remove one view, refreshed GET envelope
 *
 * Why a dedicated route rather than an extension of
 * `/api/project-preferences`: a view file is its own committed artifact
 * (human curation per the storage rule in `spec/architecture.md`, NOT a
 * config-layer key), so it bypasses `core/config/helper` entirely and
 * funnels through `util/map-views-io.ts`.
 *
 * Consent gate: NONE. Writes are confined to `.skill-map/views/` (the
 * Slug rule structurally forbids traversal and the IO helper asserts
 * containment on top), expand no disk access beyond the project scope
 * directory, and trust no code (a view is inert JSON, never executed
 * or dereferenced on disk; dead references are ignored on apply).
 *
 * Watcher interaction: NONE. Views are presentational, they never
 * change what the scan indexes, so no restart and no cache reload.
 *
 * Every read is fresh from disk (no cache, no watcher; the contract
 * row in `spec/cli-contract.md` §BFF endpoints pins that): git is the
 * merge and review layer, so a `git pull` that lands new view files
 * must surface on the next GET without a server restart.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { appendOperation } from '../../core/operations-log.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { REST_ENVELOPE_SCHEMA_VERSION } from '../envelope.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { makeBodyValidator } from '../util/parse-body.js';
import {
  MAP_VIEW_SLUG_RE,
  deleteMapView,
  listMapViews,
  writeMapView,
  type MapView,
} from '../util/map-views-io.js';
import type { IRouteDeps } from './deps.js';

export interface IMapViewsEnvelope {
  schemaVersion: typeof REST_ENVELOPE_SCHEMA_VERSION;
  kind: 'map-views';
  views: Array<{ slug: string; view: MapView }>;
  skipped: string[];
}

export function registerMapViewsRoutes(app: Hono, deps: IRouteDeps): void {
  app.get('/api/map-views', (c) => {
    return c.json(buildEnvelope(deps));
  });

  // Upsert (last-write-wins; concurrent editors resolve through git,
  // spec/map-views.md §Concurrency). The server re-serializes into the
  // canonical form, so identical curation yields byte-identical files.
  app.put('/api/map-views/:slug', async (c) => {
    const slug = requireValidSlug(c.req.param('slug'));
    const view = await parsePutBody(c.req.raw);
    persistView(deps, slug, view);
    appendOperation(deps.runtimeContext.cwd, {
      op: 'map-views.save',
      target: '*',
      channel: 'ui',
      outcome: 'ok',
      id: slug,
    });
    return c.json(buildEnvelope(deps));
  });

  app.delete('/api/map-views/:slug', (c) => {
    const slug = requireValidSlug(c.req.param('slug'));
    if (!deleteMapView(deps.runtimeContext.cwd, slug)) {
      throw new HTTPException(404, {
        message: tx(SERVER_TEXTS.mapViewNotFound, { slug }),
      });
    }
    appendOperation(deps.runtimeContext.cwd, {
      op: 'map-views.delete',
      target: '*',
      channel: 'ui',
      outcome: 'ok',
      id: slug,
    });
    return c.json(buildEnvelope(deps));
  });
}

function buildEnvelope(deps: IRouteDeps): IMapViewsEnvelope {
  const { views, skipped } = listMapViews(deps.runtimeContext.cwd);
  return {
    schemaVersion: REST_ENVELOPE_SCHEMA_VERSION,
    kind: 'map-views',
    views,
    skipped,
  };
}

/**
 * Gate the `:slug` param against the Slug rule of
 * `map-view.schema.json` BEFORE any filesystem access. The rule
 * structurally forbids `/`, `\` and `.`, so a passing slug can never
 * traverse outside the views directory (the IO helper still asserts
 * containment as the second lock). The failing value is sanitised
 * before interpolation so a hostile param cannot smuggle ANSI / C0
 * controls into the error envelope or the server log (audit L1/L4).
 */
function requireValidSlug(raw: string): string {
  if (MAP_VIEW_SLUG_RE.test(raw)) return raw;
  throw new HTTPException(400, {
    message: tx(SERVER_TEXTS.mapViewSlugInvalid, { slug: sanitizeForTerminal(raw) }),
  });
}

/**
 * Persist through the IO helper; any throw (containment assertion,
 * filesystem error) surfaces as a directed 400 via the global
 * `app.onError`. Split out so the PUT handler stays under the lint
 * complexity cap.
 */
function persistView(deps: IRouteDeps, slug: string, view: MapView): void {
  try {
    writeMapView(deps.runtimeContext.cwd, slug, view);
  } catch (err) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.mapViewPersistFailed, {
        message: formatErrorMessage(err),
      }),
    });
  }
}

/**
 * Body schema for `PUT /api/map-views/:slug`, a STRUCTURAL MIRROR of
 * `spec/schemas/map-view.schema.json` (same required set, same closed
 * objects, same pair / pin / group shapes) inlined because the body
 * validators share one plain AJV instance with no spec `$ref` registry
 * (see `util/parse-body.ts`). Drift guard: the route spec AJV-validates
 * the written file against the REAL spec schema via the
 * schema-validators loader, so a divergence between this mirror and the
 * spec fails the suite instead of shipping.
 */
const NODE_PATH_SCHEMA = {
  type: 'string',
  minLength: 1,
  pattern: '^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$)).*$',
} as const;

const POINT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y'],
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
  },
} as const;

const GROUP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'label', 'members'],
  properties: {
    id: { type: 'string', pattern: MAP_VIEW_SLUG_RE.source },
    label: { type: 'string', minLength: 1, maxLength: 80 },
    color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
    members: { type: 'array', items: NODE_PATH_SCHEMA },
    position: POINT_SCHEMA,
    size: {
      type: 'object',
      additionalProperties: false,
      required: ['width', 'height'],
      properties: {
        width: { type: 'number', exclusiveMinimum: 0 },
        height: { type: 'number', exclusiveMinimum: 0 },
      },
    },
  },
} as const;

const PUT_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'kind', 'name', 'overrides', 'pins'],
  properties: {
    schemaVersion: { const: 1 },
    kind: { const: 'map-view' },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    description: { type: 'string', maxLength: 500 },
    overrides: {
      type: 'array',
      items: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        prefixItems: [
          { anyOf: [{ const: '' }, NODE_PATH_SCHEMA] },
          { enum: ['include', 'exclude'] },
        ],
        items: false,
      },
    },
    pins: {
      type: 'object',
      propertyNames: NODE_PATH_SCHEMA,
      additionalProperties: POINT_SCHEMA,
    },
    groups: { type: 'array', items: GROUP_SCHEMA },
  },
} as const;

const parsePutBody = makeBodyValidator<MapView>(PUT_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.mapViewBodyNotJson,
  notObject: SERVER_TEXTS.mapViewBodyNotObject,
  invalid: SERVER_TEXTS.mapViewBodyInvalid,
  mapping: {
    '/schemaVersion:required': SERVER_TEXTS.mapViewSchemaVersionInvalid,
    '/schemaVersion:const': SERVER_TEXTS.mapViewSchemaVersionInvalid,
    '/kind:required': SERVER_TEXTS.mapViewKindInvalid,
    '/kind:const': SERVER_TEXTS.mapViewKindInvalid,
    '/name:required': SERVER_TEXTS.mapViewNameMissing,
    '/name:type:string': SERVER_TEXTS.mapViewNameInvalid,
    '/name:minLength': SERVER_TEXTS.mapViewNameInvalid,
    '/name:maxLength': SERVER_TEXTS.mapViewNameInvalid,
    '/description:type:string': SERVER_TEXTS.mapViewDescriptionInvalid,
    '/description:maxLength': SERVER_TEXTS.mapViewDescriptionInvalid,
    '/overrides:required': SERVER_TEXTS.mapViewOverridesInvalid,
    '/overrides:type:array': SERVER_TEXTS.mapViewOverridesInvalid,
    '/overrides/*:type:array': SERVER_TEXTS.mapViewOverridesInvalid,
    '/overrides/*:minItems': SERVER_TEXTS.mapViewOverridesInvalid,
    '/overrides/*:maxItems': SERVER_TEXTS.mapViewOverridesInvalid,
    '/overrides/*:items': SERVER_TEXTS.mapViewOverridesInvalid,
    '/overrides/*/*:enum': SERVER_TEXTS.mapViewOverridesInvalid,
    '/overrides/*/*:anyOf': SERVER_TEXTS.mapViewOverridesInvalid,
    '/pins:required': SERVER_TEXTS.mapViewPinsInvalid,
    '/pins:type:object': SERVER_TEXTS.mapViewPinsInvalid,
    '/pins:propertyNames': SERVER_TEXTS.mapViewPinsInvalid,
    '/groups:type:array': SERVER_TEXTS.mapViewGroupsInvalid,
    '/groups/*:type:object': SERVER_TEXTS.mapViewGroupsInvalid,
    '/groups/*/id:required': SERVER_TEXTS.mapViewGroupsInvalid,
    '/groups/*/label:required': SERVER_TEXTS.mapViewGroupsInvalid,
    '/groups/*/members:required': SERVER_TEXTS.mapViewGroupsInvalid,
  },
});
