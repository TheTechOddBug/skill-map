/**
 * `unknown-field` rule (Step 9.6.6) — Tier-1 typo guard for `.sm`
 * sidecars. Walks the parsed sidecar root for every node that carries
 * one and emits one `warn` issue per truly-unknown key, across three
 * surfaces:
 *
 *   1. Inside the `annotations:` block — keys not in the
 *      `annotations.schema.json` catalog. Plugins do NOT contribute to
 *      `annotations:` (it's the skill-map-curated surface); any unknown
 *      key here is a typo or a stale field.
 *   2. At the sidecar root — keys outside the four reserved blocks
 *      (`identity`, `annotations`, `settings`, `audit`) that are also NOT a
 *      registered plugin namespace `<plugin-id>:` AND NOT a registered
 *      `location: 'root'` contribution.
 *   3. Inside a registered plugin namespace `<plugin-id>:` — values
 *      that fail the schema declared by the owning plugin's
 *      `annotationContributions[<key>].schema`. The rule only validates
 *      contributions whose `location` is `'namespaced'`; root
 *      contributions are validated against their own schema in case (2).
 *
 * Severity is always `warn` — Decision #4 of the Step 9.6.6 brief.
 * Analyzer id: `unknown-field`. Built-in catalog (the set of legitimate
 * `annotations:` keys) is loaded once from
 * `@skill-map/spec/schemas/annotations.schema.json` at module init so a
 * spec bump that adds a field auto-flows through without code changes.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';

import type { IAnalyzer, IAnalyzerContext } from '../../../kernel/extensions/index.js';
import type { IRegisteredAnnotationKey } from '../../../kernel/types/annotation-catalog.js';
import type { Issue } from '../../../kernel/types.js';
import { applyAjvFormats } from '../../../kernel/util/ajv-interop.js';
import { tx } from '../../../kernel/util/tx.js';
import { UNKNOWN_FIELD_TEXTS } from '../../i18n/unknown-field.texts.js';

const ID = 'unknown-field';

/**
 * Reserved top-level blocks per `sidecar.schema.json`. Anything outside
 * this set AND not a registered plugin namespace / root contribution is
 * flagged as an unknown root key.
 */
const RESERVED_ROOT_BLOCKS = new Set(['identity', 'annotations', 'settings', 'audit']);

export const unknownFieldAnalyzer: IAnalyzer = {
  id: ID,
  pluginId: 'core',
  kind: 'analyzer',
  version: '1.0.0',
  description:
    'Catches typos and unrecognized keys inside `.sm` sidecars, including plugin-contributed annotation fields that fail their own schema.',
  stability: 'stable',
  mode: 'deterministic',

  viewContributions: {
    // Corner badge on the graph card; count omitted when there is a
    // single unknown field (avoids a noisy "icon + 1" chip).
    alert: {
      slot: 'graph.node.alert',
      // Filled warning triangle on the corner — matches the broken-ref
      // alert's "attention-grabbing solid" pattern; the footer chip
      // below stays outlined for the quieter counter pairing.
      icon: 'fa-solid fa-triangle-exclamation',
      emitWhenEmpty: false,
    },
    // Footer chip on the card — `_counter` shape but rendered icon-only
    // (the analyzer emits `value: 0` so NodeCounter hides the number
    // and only the glyph shows). PrimeIcons `pi-question-circle` so the
    // visual weight matches `annotation-stale`'s `pi-clock` chip
    // sitting next to it on the same footer row. `emitWhenEmpty: true`
    // is required: with `value: 0` the slot treats the payload as
    // empty, so the manifest has to opt in to keep the emission.
    chip: {
      slot: 'card.footer.right',
      icon: 'pi-question-circle',
      emitWhenEmpty: true,
      priority: 30,
    },
  },

  // eslint-disable-next-line complexity
  evaluate(ctx: IAnalyzerContext): Issue[] {
    const sidecarRoots = ctx.sidecarRoots;
    if (!sidecarRoots || sidecarRoots.size === 0) return [];

    const knownAnnotationKeys = getKnownAnnotationKeys();
    const contributions = ctx.annotationContributions ?? [];
    const namespacedByPlugin = indexNamespacedContributions(contributions);
    const rootKeys = indexRootContributions(contributions);
    const knownPluginIds = collectPluginIds(contributions);

    const issues: Issue[] = [];
    // Per-node aggregation so we emit ONE badge / chip per node, not
    // one per offending key. The map counts across all three surfaces
    // (annotations / root / plugin-namespace) the rule inspects below.
    const perNode = new Map<string, number>();
    const bump = (nodePath: string): void => {
      perNode.set(nodePath, (perNode.get(nodePath) ?? 0) + 1);
    };
    for (const node of ctx.nodes) {
      const root = sidecarRoots.get(node.path);
      if (!root) continue;

      // (1) annotations: block — flag keys not in the curated catalog.
      const annotations = root['annotations'];
      if (annotations !== undefined && annotations !== null && typeof annotations === 'object' && !Array.isArray(annotations)) {
        for (const key of Object.keys(annotations as Record<string, unknown>)) {
          if (!knownAnnotationKeys.has(key)) {
            issues.push({
              analyzerId: ID,
              severity: 'warn',
              nodeIds: [node.path],
              message: tx(UNKNOWN_FIELD_TEXTS.unknownAnnotationKey, {
                path: node.path,
                key,
              }),
              data: { surface: 'annotations', key },
            });
            bump(node.path);
          }
        }
      }

      // (2) top-level keys — flag unknowns; (3) plugin-namespaced
      // values — validate against the plugin's contributed schema.
      for (const key of Object.keys(root)) {
        if (RESERVED_ROOT_BLOCKS.has(key)) continue;
        if (rootKeys.has(key)) continue; // legitimate root contribution
        if (knownPluginIds.has(key)) {
          // Plugin namespace block. Validate every contributed
          // namespaced key under it against the contributing plugin's
          // schema; keys NOT contributed by the plugin are tolerated
          // (the namespace itself is open by spec — `additionalProperties: true`).
          const block = root[key];
          if (block === null || typeof block !== 'object' || Array.isArray(block)) continue;
          const contribsForPlugin = namespacedByPlugin.get(key);
          if (!contribsForPlugin) continue;
          for (const [contribKey, validator] of contribsForPlugin) {
            const value = (block as Record<string, unknown>)[contribKey];
            if (value === undefined) continue;
            if (validator(value)) continue;
            const errors = (validator.errors ?? [])
              .map((e) => `${e.instancePath || '(root)'} ${e.message ?? e.keyword}`)
              .join('; ');
            issues.push({
              analyzerId: ID,
              severity: 'warn',
              nodeIds: [node.path],
              message: tx(UNKNOWN_FIELD_TEXTS.pluginNamespaceInvalid, {
                path: node.path,
                pluginId: key,
                key: contribKey,
                errors,
              }),
              data: { surface: 'plugin-namespace', pluginId: key, key: contribKey },
            });
            bump(node.path);
          }
          continue;
        }
        // Truly unknown root key.
        issues.push({
          analyzerId: ID,
          severity: 'warn',
          nodeIds: [node.path],
          message: tx(UNKNOWN_FIELD_TEXTS.unknownRootKey, {
            path: node.path,
            key,
          }),
          data: { surface: 'root', key },
        });
        bump(node.path);
      }
    }
    for (const [nodePath, count] of perNode) {
      const tooltip =
        count === 1
          ? UNKNOWN_FIELD_TEXTS.alertTooltipSingle
          : tx(UNKNOWN_FIELD_TEXTS.alertTooltipMany, { count });
      // Icon-only alert (no count on payload — the corner stays a single
      // glyph). The footer chip below also renders icon-only via
      // `value: 0` so neither surface shows the raw count; the tooltip
      // carries the number on both.
      ctx.emitContribution(nodePath, 'alert', {
        icon: 'fa-solid fa-triangle-exclamation',
        severity: 'warn',
        tooltip,
      });
      ctx.emitContribution(nodePath, 'chip', {
        value: 0,
        severity: 'warn',
        tooltip,
      });
    }
    return issues;
  },
};

// --- internal helpers ------------------------------------------------------

let cachedKnownKeys: Set<string> | null = null;

/**
 * Load the curated `annotations:` catalog at module init from
 * `@skill-map/spec/schemas/annotations.schema.json`. Keeps this rule
 * automatically in sync with spec evolution — adding a new conventional
 * field is a one-line spec change, no rule update required.
 */
function getKnownAnnotationKeys(): Set<string> {
  if (cachedKnownKeys) return cachedKnownKeys;
  const require = createRequire(import.meta.url);
  const indexPath = require.resolve('@skill-map/spec/index.json');
  const specRoot = dirname(indexPath);
  const schema = JSON.parse(
    readFileSync(resolve(specRoot, 'schemas/annotations.schema.json'), 'utf8'),
  ) as { properties?: Record<string, unknown> };
  cachedKnownKeys = new Set(Object.keys(schema.properties ?? {}));
  return cachedKnownKeys;
}

/**
 * Test-only escape hatch — drop the cached catalog so a test can rebuild
 * it after monkey-patching the spec package.
 */
export function _resetUnknownFieldRuleCacheForTests(): void {
  cachedKnownKeys = null;
}

type TValidator = ValidateFunction & {
  errors?: { instancePath: string; message?: string; keyword: string }[] | null;
};

/**
 * Index `location: 'namespaced'` contributions by plugin id, with their
 * inline schemas already AJV-compiled. The compiler runs once per rule
 * invocation (cheap; the catalog is small and the schemas are inline
 * objects).
 */
function indexNamespacedContributions(
  contributions: readonly IRegisteredAnnotationKey[],
): Map<string, Map<string, TValidator>> {
  const out = new Map<string, Map<string, TValidator>>();
  const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true });
  applyAjvFormats(ajv);
  for (const entry of contributions) {
    if (entry.location !== 'namespaced') continue;
    let bucket = out.get(entry.pluginId);
    if (!bucket) {
      bucket = new Map<string, TValidator>();
      out.set(entry.pluginId, bucket);
    }
    try {
      bucket.set(entry.key, ajv.compile(entry.schema) as TValidator);
    } catch {
      // The plugin loader rejects schemas that fail to compile; if a
      // bad one slips through here, skip it silently — there's nothing
      // useful to validate against.
    }
  }
  return out;
}

/** Collect every key claimed via `location: 'root'`. Shared root contributions
 * are not allowed at the per-extension validation stage; only `exclusive`
 * survives, but the rule treats both as "registered" for tolerance. */
function indexRootContributions(
  contributions: readonly IRegisteredAnnotationKey[],
): Set<string> {
  const out = new Set<string>();
  for (const entry of contributions) {
    if (entry.location === 'root') out.add(entry.key);
  }
  return out;
}

/** Plugin ids known to ship at least one contribution — these legitimise
 * a `<plugin-id>:` root namespace block, even when the block contains
 * keys the plugin did not declare (the namespace itself is open). */
function collectPluginIds(contributions: readonly IRegisteredAnnotationKey[]): Set<string> {
  const out = new Set<string>();
  for (const entry of contributions) out.add(entry.pluginId);
  return out;
}
