/**
 * `<sm-plugin-contributions>` — surfaces the plugin namespaces / root
 * contributions a sidecar carries outside the four reserved blocks
 * (`for`, `annotations`, `settings`, `audit`). Catalog curation
 * (2026-05-07) tiered the inspector into a collapsible
 * "Plugin contributions (N namespaces)" section; this component owns
 * the rendering once the host expands it.
 *
 * The component fetches the runtime annotation-contribution catalog
 * from `GET /api/annotations/registered` once on construction and
 * caches it so subsequent inspector switches reuse the same payload.
 * In demo mode the fetch may fail (no live BFF) — when it does, the
 * component simply renders every namespace as "unregistered". No
 * thrown error reaches the inspector.
 *
 * Per the curation decision:
 *   - Registered plugin namespace → header `▶ <plugin-id>`, no badge,
 *     each contributed key carries the registered schema description
 *     as a tooltip.
 *   - Unregistered namespace → header `▶ <plugin-id>` with a muted
 *     "unregistered" badge.
 *   - Root-level contribution (registered with `location: 'root'`) →
 *     surfaces inline with a "from plugin: X" badge.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { PLUGIN_CONTRIBUTIONS_TEXTS } from '../../../i18n/plugin-contributions.texts';
import {
  DATA_SOURCE,
  type IDataSourcePort,
} from '../../../services/data-source/data-source.port';
import type { IRegisteredAnnotationKeyApi } from '../../../models/api';

/** Reserved root keys per `spec/schemas/sidecar.schema.json`. */
const RESERVED_BLOCKS: ReadonlySet<string> = new Set([
  'identity',
  'annotations',
  'settings',
  'audit',
]);

interface INamespaceRow {
  /** Either the plugin id (for namespaced contributions) or the literal key (for unknowns). */
  pluginId: string;
  registered: boolean;
  /** Sub-rows: each declared key inside the namespace, value pre-formatted as JSON. */
  rows: ReadonlyArray<{ key: string; value: string; description: string | null }>;
}

interface IRootRow {
  key: string;
  /** Plugin id when the root key is a registered root contribution; null when unknown. */
  pluginId: string | null;
  value: string;
}

@Component({
  selector: 'sm-plugin-contributions',
  imports: [TooltipModule],
  templateUrl: './plugin-contributions.html',
  styleUrl: './plugin-contributions.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PluginContributions {
  private readonly dataSource: IDataSourcePort = inject(DATA_SOURCE);

  /**
   * Sidecar root payload — the parsed YAML of the `.sm` file. The
   * component inspects every top-level key and classifies it:
   * reserved, registered namespace, registered root, or unregistered.
   * Absent → renders nothing (no overlay = no plugin surface).
   */
  readonly sidecarRoot = input<Record<string, unknown> | null | undefined>(undefined);

  protected readonly texts = PLUGIN_CONTRIBUTIONS_TEXTS;

  /** Catalog fetch state — `null` until the first fetch resolves. */
  private readonly catalog = signal<readonly IRegisteredAnnotationKeyApi[] | null>(null);

  constructor() {
    // Fire-and-forget catalog fetch on construction. Failure (e.g. demo
    // bundle, network down) leaves `catalog` at `[]` and the template
    // renders all non-reserved namespaces as "unregistered".
    void this.fetchCatalog();
  }

  /** All non-reserved root keys grouped by plugin id. */
  protected readonly namespaces = computed<readonly INamespaceRow[]>(() => {
    const root = this.sidecarRoot();
    if (!root) return [];
    const cat = this.catalog();
    const namespacedRegistered = new Map<string, IRegisteredAnnotationKeyApi[]>();
    if (cat) {
      for (const entry of cat) {
        if (entry.location !== 'namespaced') continue;
        const list = namespacedRegistered.get(entry.pluginId);
        if (list) list.push(entry);
        else namespacedRegistered.set(entry.pluginId, [entry]);
      }
    }
    const out: INamespaceRow[] = [];
    for (const [key, value] of Object.entries(root)) {
      if (RESERVED_BLOCKS.has(key)) continue;
      // Skip root-level contributions (registered with `location: 'root'`)
      // — those surface in the rootContributions list below.
      if (this.isRegisteredRootKey(key)) continue;
      const isObj = typeof value === 'object' && value !== null && !Array.isArray(value);
      const inner = isObj ? (value as Record<string, unknown>) : { value };
      const registered = namespacedRegistered.has(key);
      const declarations = namespacedRegistered.get(key) ?? [];
      const rows: INamespaceRow['rows'] = Object.entries(inner).map(([k, v]) => ({
        key: k,
        value: stringifyValue(v),
        description: registered
          ? findDescription(declarations, k)
          : null,
      }));
      out.push({ pluginId: key, registered, rows });
    }
    return out;
  });

  /** Root-level contributions (registered with `location: 'root'`). */
  protected readonly rootContributions = computed<readonly IRootRow[]>(() => {
    const root = this.sidecarRoot();
    if (!root) return [];
    const cat = this.catalog();
    if (!cat) return [];
    const rootByKey = new Map<string, IRegisteredAnnotationKeyApi>();
    for (const entry of cat) {
      if (entry.location === 'root') rootByKey.set(entry.key, entry);
    }
    const out: IRootRow[] = [];
    for (const [key, value] of Object.entries(root)) {
      if (RESERVED_BLOCKS.has(key)) continue;
      const decl = rootByKey.get(key);
      if (!decl) continue;
      out.push({ key, pluginId: decl.pluginId, value: stringifyValue(value) });
    }
    return out;
  });

  protected readonly count = computed<number>(
    () => this.namespaces().length + this.rootContributions().length,
  );

  protected readonly isEmpty = computed<boolean>(() => this.count() === 0);

  private isRegisteredRootKey(key: string): boolean {
    const cat = this.catalog();
    if (!cat) return false;
    return cat.some((e) => e.location === 'root' && e.key === key);
  }

  private async fetchCatalog(): Promise<void> {
    try {
      const items = await this.dataSource.getRegisteredAnnotations();
      this.catalog.set(items);
    } catch {
      // Swallow — demo / disconnected mode. The template renders
      // everything as unregistered.
      this.catalog.set([]);
    }
  }
}

function stringifyValue(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function findDescription(
  decls: readonly IRegisteredAnnotationKeyApi[],
  key: string,
): string | null {
  // The plugin's manifest declares `annotationContributions: { <key>: { schema, ... } }`
  // and the schema's `description` is the tooltip we surface.
  for (const d of decls) {
    if (d.key === key) {
      const desc = d.schema['description'];
      if (typeof desc === 'string' && desc.length > 0) return desc;
      return null;
    }
  }
  return null;
}
