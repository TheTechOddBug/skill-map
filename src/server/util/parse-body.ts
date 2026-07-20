/**
 * AJV-backed body validator factory for Hono PATCH/POST routes.
 *
 * Why: the BFF used to ship five hand-rolled `parseBody` / `parsePatchBody`
 * helpers (one per mutating route) that re-implemented "read JSON →
 * shape guard → typed throw" with subtle drift between sites (some
 * coerced `force === true`, others returned the raw boolean; each
 * carried its own `eslint-disable complexity`). AJV is already loaded
 * across the kernel (plugin manifest validation, sidecar parse,
 * schema-validators) so the new helper takes zero new dependencies
 * while consolidating the pattern.
 *
 * Schemas compile ONCE at module import (the route binds the validator
 * to a module-level constant). The hot path is:
 *
 *   req.json() → typeof guard → compiled.validate() → throw or return
 *
 * No per-request AJV instance, no per-request compile.
 *
 * **Error envelope discipline.** Each call site supplies the message
 * constants from its own `*.texts.ts` namespace:
 *
 *   - `notJson`  , `req.json()` threw (malformed body).
 *   - `notObject`, body parsed but is not a plain object (`null`,
 *                   array, scalar). The helper rejects these BEFORE
 *                   calling AJV so the message is route-specific
 *                   (AJV's own root-type errors are generic).
 *   - `invalid`  , generic fallback when no entry in `mapping`
 *                   matches the first AJV error.
 *   - `mapping`  , optional table keyed by `<instancePath>:<keyword>`
 *                   (see `makeMappingKey` for the per-keyword key shape)
 *                   that returns either a static string OR a callback
 *                   receiving the `ErrorObject` (used to interpolate
 *                   the offending field name into a `{{key}}`
 *                   template, see `routes/project-preferences.ts`).
 *
 * AJV runs with `allErrors: false`: the first failure wins, matching
 * the semantic of the hand-rolled parsers (early-throw on the first
 * shape violation). `strict: false` mirrors how the rest of the
 * codebase configures AJV (kernel/adapters/schema-validators.ts,
 * sidecar/parse.ts).
 */

import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

export type TBodyErrorResolver = string | ((err: ErrorObject) => string);

export interface IBodyValidatorMessages {
  /** Thrown when `req.json()` rejects (malformed body). */
  notJson: string;
  /** Thrown when the parsed body is not a plain object. */
  notObject: string;
  /** Fallback when the first AJV error has no mapping entry. */
  invalid: string;
  /**
   * Optional table keyed by `<instancePath>:<keyword>` (see
   * `makeMappingKey`). Values may be a static string OR a function that
   * receives the first AJV `ErrorObject` and returns the rendered
   * message (use this when the message interpolates a value from the
   * offending field, e.g. the field name from `instancePath`).
   */
  mapping?: Record<string, TBodyErrorResolver>;
}

export type TBodyValidator<T> = (req: Request) => Promise<T>;

export interface IBodyValidatorOptions<T> {
  /**
   * When set, an ABSENT or empty request body resolves to this value
   * instead of the `notJson` 400. For verbs whose body is optional by
   * contract (e.g. the finding DELETE, where the consent flags only
   * ride along when a suppression lift needs them); a PRESENT body
   * still validates in full.
   */
  emptyAs?: T;
}

export function makeBodyValidator<T>(
  schema: object,
  messages: IBodyValidatorMessages,
  options: IBodyValidatorOptions<T> = {},
): TBodyValidator<T> {
  const ajv = new Ajv2020({ strict: false, allErrors: false });
  const validate = ajv.compile<T>(schema);
  return async function parseBody(req: Request): Promise<T> {
    const text = await req.text();
    if (options.emptyAs !== undefined && text.trim().length === 0) {
      return options.emptyAs;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      throw new HTTPException(400, { message: messages.notJson });
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new HTTPException(400, { message: messages.notObject });
    }
    if (validate(raw)) {
      return raw as T;
    }
    const message = resolveErrorMessage(validate.errors, messages);
    throw new HTTPException(400, { message });
  };
}

function resolveErrorMessage(
  errors: readonly ErrorObject[] | null | undefined,
  messages: IBodyValidatorMessages,
): string {
  const first = errors?.[0];
  if (!first) return messages.invalid;
  const key = makeMappingKey(first);
  const resolver = messages.mapping?.[key];
  if (typeof resolver === 'string') return resolver;
  if (typeof resolver === 'function') return resolver(first);
  return messages.invalid;
}

/**
 * Compose a stable mapping key from an AJV `ErrorObject`. The key
 * embeds enough context that two errors at the same `instancePath` but
 * different keywords (e.g. `/force:type:boolean` vs `/force:required`)
 * resolve to distinct entries.
 *
 * Keyword-specific param embedding:
 *   - `required`              → `<path>/<missingProperty>:required`
 *   - `type`                  → `<path>:type:<expected>`
 *   - `additionalProperties`  → `<path>:additionalProperties:<offender>`
 *
 * Other keywords (`minLength`, `minProperties`, `pattern`, ...) embed
 * just the keyword name. Extend this switch as new schemas surface
 * additional keywords whose `params` should disambiguate the message.
 *
 * Numeric segments inside `instancePath` (array indices, AJV emits
 * `/items/3` for the fourth element) are normalised to `*` so a
 * mapping can express "any item failed" with a single
 * `/items/*:type:string` entry. Property names that happen to be
 * numeric are not affected (the path uses unique segment boundaries).
 */
function makeMappingKey(err: ErrorObject): string {
  const path = normalizeArrayIndices(err.instancePath);
  switch (err.keyword) {
    case 'required': {
      const missing = (err.params as { missingProperty?: string }).missingProperty ?? '';
      return `${path}/${missing}:required`;
    }
    case 'type': {
      const expected = (err.params as { type?: string }).type ?? '';
      return `${path}:type:${expected}`;
    }
    case 'additionalProperties': {
      const offender = (err.params as { additionalProperty?: string }).additionalProperty ?? '';
      return `${path}:additionalProperties:${offender}`;
    }
    default:
      return `${path}:${err.keyword}`;
  }
}

function normalizeArrayIndices(path: string): string {
  return path.replace(/\/\d+(?=\/|$)/g, '/*');
}
