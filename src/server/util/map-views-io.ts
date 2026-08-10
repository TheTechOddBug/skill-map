/**
 * Map-view file I/O for the BFF's map-views route
 * (`spec/map-views.md`; one committed JSON document per named view
 * under `<cwd>/.skill-map/views/<slug>.json`).
 *
 *   - `listMapViews(cwd)`: reads every `<slug>.json` in the views
 *     directory (absent directory reads as zero views), AJV-validates
 *     each against `spec/schemas/map-view.schema.json`, and returns the
 *     valid ones sorted by slug plus the basenames it skipped. A
 *     hand-edited broken file must never take the whole list down, so
 *     parse / validation failures are per-file: skipped + logged (warn).
 *   - `canonicalizeMapView(view)`: the canonical serialization form
 *     (`spec/map-views.md` §Canonical serialization): fixed top-level
 *     key order, byte-sorted `pins`, `description` / `groups` omitted
 *     when empty, `overrides` order preserved verbatim.
 *   - `writeMapView(cwd, slug, view)`: canonicalizes and writes
 *     atomically (temp file plus rename) with LF, 2-space indent and a
 *     single trailing newline, creating the directory on first use.
 *   - `deleteMapView(cwd, slug)`: removes one view file.
 *
 * Not a config-layer concern: a view file is its own committed artifact
 * (human curation, per the storage rule in `spec/architecture.md`), so
 * the helper bypasses `core/config/helper` and writes directly to disk,
 * mirroring `util/skillmapignore-io.ts`.
 *
 * The write / delete paths trust NOTHING about the slug: callers gate
 * it against `MAP_VIEW_SLUG_RE` first (the route returns 400), and both
 * paths still assert the resolved file stays directly under the views
 * directory (belt and braces against a future caller skipping the
 * gate). Containment violations throw crude `Error`s, they signal a
 * caller defect, not user input, matching `core/paths/path-guard.ts`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';

import { defaultProjectViewsDir, mapViewFilePath } from '../../core/paths/db-path.js';
import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { log } from '../../kernel/util/logger.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';

/**
 * The Slug rule of `map-view.schema.json#/$defs/Slug`, verbatim: 1-64
 * lowercase alphanumerics and hyphens, no leading or trailing hyphen.
 * Structurally forbids `/`, `\` and `.`, so a conforming slug can never
 * traverse outside the views directory. The route gates `:slug` with
 * this BEFORE any filesystem access.
 */
export const MAP_VIEW_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** Flow-coordinate position (`map-view.schema.json#/$defs/Point`). */
export interface MapViewPoint {
  x: number;
  y: number;
}

/** One visual group (`map-view.schema.json#/$defs/Group`, reserved surface, round-tripped verbatim). */
export interface MapViewGroup {
  id: string;
  label: string;
  color?: string;
  members: string[];
  position?: MapViewPoint;
  size?: { width: number; height: number };
}

/**
 * One map-view document (`spec/schemas/map-view.schema.json`). Domain
 * type, name mirrors the schema title. The slug is NOT stored inside
 * the document; the filename is the identity.
 */
export interface MapView {
  schemaVersion: 1;
  kind: 'map-view';
  name: string;
  description?: string;
  overrides: Array<[string, 'include' | 'exclude']>;
  pins: Record<string, MapViewPoint>;
  groups?: MapViewGroup[];
}

export interface IMapViewListing {
  /** Valid views, sorted by slug (byte order ascending). */
  views: Array<{ slug: string; view: MapView }>;
  /** Basenames of files that failed the slug rule, JSON parse, or schema validation. */
  skipped: string[];
}

/**
 * Read every view under `<cwd>/.skill-map/views/`. Fresh read per call
 * (no cache, no watcher; the contract row pins that). Files whose
 * basename is not `<slug>.json`, fail JSON parse, or fail schema
 * validation land in `skipped` (logged at warn); directories are
 * ignored outright.
 */
export function listMapViews(cwd: string): IMapViewListing {
  const dir = defaultProjectViewsDir(cwd);
  const views: Array<{ slug: string; view: MapView }> = [];
  const skipped: string[] = [];
  for (const entry of readDirSafe(dir)) {
    const slug = slugForBasename(entry);
    if (slug === null) {
      skip(skipped, entry, 'invalid filename');
      continue;
    }
    const view = readValidView(dir, entry, skipped);
    if (view !== null) views.push({ slug, view });
  }
  views.sort((a, b) => byteCompare(a.slug, b.slug));
  return { views, skipped };
}

/**
 * Canonical serialization form (`spec/map-views.md` §Canonical
 * serialization): top-level key order `schemaVersion, kind, name,
 * description, overrides, pins, groups`; `pins` keys byte-sorted
 * ascending; `description` and `groups` omitted when empty or absent;
 * `overrides` array order preserved VERBATIM (it is include seniority,
 * not a sortable list). Pure object shaping, serialization itself
 * happens in `writeMapView`.
 */
export function canonicalizeMapView(view: MapView): MapView {
  const pins: Record<string, MapViewPoint> = {};
  const sortedEntries = Object.entries(view.pins).sort(([a], [b]) => byteCompare(a, b));
  for (const [key, point] of sortedEntries) {
    pins[key] = { x: point.x, y: point.y };
  }
  const canonical: MapView = {
    schemaVersion: 1,
    kind: 'map-view',
    name: view.name,
    ...(view.description !== undefined && view.description.length > 0
      ? { description: view.description }
      : {}),
    overrides: view.overrides,
    pins,
    ...(view.groups !== undefined && view.groups.length > 0 ? { groups: view.groups } : {}),
  };
  return canonical;
}

/**
 * Persist one view: canonical form, UTF-8, LF, 2-space indent, single
 * trailing newline, atomic (temp file plus rename, so a crashed write
 * never leaves a half-serialized view). Creates the views directory on
 * first use. Throws on containment violation or any filesystem error;
 * the route wraps the throw into its 400 envelope.
 */
export function writeMapView(cwd: string, slug: string, view: MapView): void {
  const file = assertContainedViewFile(cwd, slug);
  mkdirSync(defaultProjectViewsDir(cwd), { recursive: true });
  const content = `${JSON.stringify(canonicalizeMapView(view), null, 2)}\n`;
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, file);
}

/**
 * Remove one view file. Returns `false` when the file does not exist
 * (the route maps that to 404); throws on containment violation or any
 * other filesystem error.
 */
export function deleteMapView(cwd: string, slug: string): boolean {
  const file = assertContainedViewFile(cwd, slug);
  if (!existsSync(file)) return false;
  unlinkSync(file);
  return true;
}

/**
 * Resolve `<viewsDir>/<slug>.json` and assert it sits DIRECTLY inside
 * the views directory. The slug regex already forbids every traversal
 * shape; this is the belt-and-braces second lock (same idiom as
 * `core/paths/path-guard.ts:assertContained`).
 */
function assertContainedViewFile(cwd: string, slug: string): string {
  const root = resolve(defaultProjectViewsDir(cwd));
  const file = resolve(mapViewFilePath(cwd, slug));
  if (!file.startsWith(root + sep) || dirname(file) !== root) {
    throw new Error(`map view path escapes the views directory: ${slug}`);
  }
  return file;
}

/** `foo.json` -> `foo` when it matches the Slug rule, else `null`. */
function slugForBasename(basename: string): string | null {
  if (!basename.endsWith('.json')) return null;
  const slug = basename.slice(0, -'.json'.length);
  return MAP_VIEW_SLUG_RE.test(slug) ? slug : null;
}

/**
 * Parse + validate one view file. Returns the typed document, or
 * `null` after pushing the basename into `skipped` (with a warn log)
 * when the file is unreadable, not valid JSON, or fails the schema.
 */
function readValidView(dir: string, basename: string, skipped: string[]): MapView | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolve(dir, basename), 'utf8')) as unknown;
  } catch {
    skip(skipped, basename, 'not valid JSON');
    return null;
  }
  const result = loadSchemaValidators().validate<MapView>('map-view', parsed);
  if (!result.ok) {
    skip(skipped, basename, result.errors);
    return null;
  }
  return result.data;
}

function skip(skipped: string[], basename: string, reason: string): void {
  skipped.push(basename);
  log.warn(
    tx(SERVER_TEXTS.mapViewFileSkipped, {
      file: sanitizeForTerminal(basename),
      reason: sanitizeForTerminal(reason),
    }),
  );
}

/**
 * List the directory's plain files; absent directory (or any read
 * error) reads as zero views by contract. Directories are ignored, a
 * nested folder is not a view candidate and not worth a skip entry.
 */
function readDirSafe(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Byte order ascending (UTF-8), the sort the canonical serialization
 * pins for `pins` keys. Differs from the default UTF-16 code-unit sort
 * only for astral code points, but "byte-sorted" is the normative
 * wording, so compare the actual bytes.
 */
function byteCompare(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
