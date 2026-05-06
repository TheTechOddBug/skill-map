/**
 * `GET /api/annotations/registered` — read-only catalog of plugin-contributed
 * annotation keys (Step 9.6.6, BFF half).
 *
 * Surface:
 *
 *   ```jsonc
 *   {
 *     "schemaVersion": "1",
 *     "kind": "annotations.registered",   // canonical, listed in
 *                                         // rest-envelope.schema.json's
 *                                         // enum (R7 closed at 9.6.7,
 *                                         // alongside `sidecar.bumped`).
 *     "items": IRegisteredAnnotationKey[],
 *     "counts": { "total": <int> }
 *   }
 *   ```
 *
 * The handler is a pure projection of `kernel.getRegisteredAnnotationKeys()`
 * — populated once by `registerEnabledExtensions` after every plugin loads,
 * never mutated thereafter, frozen so list / read-side handlers can hand
 * it out without copying. Built-in catalog keys (from
 * `annotations.schema.json`) are NOT included: the UI knows the built-in
 * set via the bundled spec; this endpoint only exposes the plugin layer
 * the UI can't otherwise discover at runtime.
 *
 * No filters, no pagination, no auth — the catalog is small (typically
 * 0-50 entries) and the BFF stays unauthenticated in v0 (mirrors the
 * existing `/api/plugins`, `/api/config` siblings).
 *
 * The kernel reference is captured by closure; the composition root
 * (`server/index.ts`) instantiates the kernel, populates the catalog,
 * and threads it through `IAnnotationsRouteDeps`.
 */

import type { Hono } from 'hono';

import type { Kernel } from '../../kernel/index.js';
import type { IRegisteredAnnotationKey } from '../../kernel/types/annotation-catalog.js';

/**
 * REST envelope `kind` discriminator. Listed in the canonical
 * `rest-envelope.schema.json#/properties/kind/enum` since 9.6.7 (R7
 * closed alongside `sidecar.bumped`).
 */
const ENVELOPE_KIND = 'annotations.registered' as const;

export interface IAnnotationsRegisteredEnvelope {
  schemaVersion: '1';
  kind: typeof ENVELOPE_KIND;
  items: IRegisteredAnnotationKey[];
  counts: { total: number };
}

export interface IAnnotationsRouteDeps {
  kernel: Kernel;
}

export function registerAnnotationsRoute(
  app: Hono,
  deps: IAnnotationsRouteDeps,
): void {
  app.get('/api/annotations/registered', (c) => {
    // Copy the frozen catalog into a fresh array so an accidental
    // mutation by JSON serialization middleware (or a future response
    // transformer) cannot reach back into the kernel's frozen view.
    const items = [...deps.kernel.getRegisteredAnnotationKeys()];
    const envelope: IAnnotationsRegisteredEnvelope = {
      schemaVersion: '1',
      kind: ENVELOPE_KIND,
      items,
      counts: { total: items.length },
    };
    return c.json(envelope);
  });
}
