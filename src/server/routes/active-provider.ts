/**
 * Active provider lens route, read + write the project's active
 * provider.
 *
 *   GET   /api/active-provider                 → current envelope (resolved + detected + drift)
 *   POST  /api/active-provider/accept-markers  → reconcile the markers snapshot (SPA "Dismiss")
 *   PATCH /api/active-provider                 → switch the lens; refresh the markers snapshot; atomically drop scan_*
 *
 * The persisted setting lives at `.skill-map/settings.json` under the
 * `activeProvider` key (project layer, committed). When the operator
 * switches it, the scan_* zone is cleared atomically so the persisted
 * graph cannot reflect the previous lens (see
 * `spec/architecture.md` §Active Provider Lens). `state_*` and
 * `config_*` zones survive untouched. The switch also refreshes the
 * `activeProviderMarkers` snapshot to the detected set (mirroring the
 * CLI's `sm config set activeProvider`, snapshot write #3), so any
 * pending marker-drift notice clears the moment the lens changes.
 *
 * GET response shape:
 *
 *   ```json
 *   {
 *     "activeProvider": "claude" | "agent-skills",
 *     "detected": ["claude", "codex"],
 *     "source": "config" | "autodetect" | "default",
 *     "selectable": ["claude", "codex", "agent-skills"],
 *     "markerDrift": { "added": ["codex"], "removed": [], "detected": ["claude", "codex"] } | null
 *   }
 *   ```
 *
 * `POST /api/active-provider/accept-markers` takes no body: it derives
 * the detected set server-side, writes it as the `activeProviderMarkers`
 * snapshot, and returns the same GET envelope (now `markerDrift: null`).
 *
 * PATCH body shape:
 *
 *   ```json
 *   { "activeProvider": "claude" }
 *   ```
 *
 * Mirrors the body-parsing convention of `routes/preferences.ts`
 * (AJV-backed `makeBodyValidator`, errors flow through
 * `app.onError` via `HTTPException`).
 */

import { existsSync } from 'node:fs';

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { resolveActiveProvider } from '../../core/config/active-provider.js';
import {
  computeMarkerDrift,
  reconcileMarkersSnapshot,
  type IMarkerDrift,
} from '../../core/runtime/active-provider-bootstrap.js';
import { writeConfigValue } from '../../core/config/helper.js';
import { resolveDbPath } from '../../core/paths/db-path.js';
import { buildFreshResolver } from '../../core/runtime/fresh-resolver.js';
import { isPluginExtensionEnabled } from '../../core/runtime/plugin-runtime/resolver.js';
import { dropScanZone } from '../../cli/util/scan-zone-drop.js';
import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { tx } from '../../kernel/util/tx.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { makeBodyValidator } from '../util/parse-body.js';
import type { IRouteDeps } from './deps.js';

export interface IActiveProviderEnvelope {
  activeProvider: string;
  detected: readonly string[];
  source: 'config' | 'autodetect' | 'default';
  /**
   * Registered LENS Provider ids (gated, `gatedByActiveLens: true`) that
   * are enabled right now, resolved against the live per-extension resolver
   * (the layered config `settings.json#/plugins`, the same resolution
   * `GET /api/plugins` applies). This is the subset of
   * `providerRegistry` eligible to become the lens. The non-gated
   * `markdown` base is never here (it is the substrate, not a lens). A
   * lens the operator disabled, or one that ships disabled by default
   * (`stability: experimental`), drops out of `selectable` but stays in
   * `providerRegistry` (the static boot catalog keeps it so already-scanned
   * nodes still render their chip). The SPA greys out (and refuses to
   * select) any dropdown entry absent from this set, so a disabled lens can
   * never be picked. See `spec/cli-contract.md` §Active provider lens.
   */
  selectable: readonly string[];
  /**
   * Filesystem-marker drift relative to the persisted
   * `activeProviderMarkers` snapshot (a Provider directory appeared or
   * vanished since the lens was chosen), or `null` when the detected set
   * matches the snapshot (or no snapshot exists). Applies the same
   * ships-disabled exclusion as the scan-time drift check. The SPA
   * renders a dismissable notice from a non-null value; **Dismiss**
   * issues `POST /api/active-provider/accept-markers`, which reconciles
   * the snapshot so the next envelope reads `markerDrift: null`. Unlike
   * the CLI, the server does NOT log the scan-time drift `⚠` warn; this
   * field is the operator surface. See `spec/cli-contract.md` §Active
   * provider lens (Provider-marker drift).
   */
  markerDrift: IMarkerDrift | null;
}

interface IPatchBody {
  activeProvider: string;
}

interface ILensSwitchResult {
  dropped: { tableCount: number; tableNames: readonly string[] } | null;
}

export function registerActiveProviderRoute(app: Hono, deps: IRouteDeps): void {
  app.get('/api/active-provider', async (c) => {
    return c.json(await buildEnvelope(deps));
  });

  // SPA "Dismiss" action for the marker-drift notice. Reconciles the
  // persisted `activeProviderMarkers` snapshot with the current
  // filesystem-detected set so the drift clears in both the SPA and the
  // CLI (`sm scan` stops warning), then returns the refreshed envelope
  // (now `markerDrift: null`). No request body: the detected set is
  // derived server-side. A later, different marker change drifts again.
  app.post('/api/active-provider/accept-markers', async (c) => {
    const cwd = deps.runtimeContext.cwd;
    const detected = resolveActiveProvider(cwd, deps.providers).detected;
    try {
      reconcileMarkersSnapshot(cwd, detected);
    } catch (err) {
      throw new HTTPException(400, {
        message: tx(SERVER_TEXTS.activeProviderMarkersPersistFailed, {
          message: formatErrorMessage(err),
        }),
      });
    }
    // The write changed on-disk config; reload the cached service so a
    // subsequent read through it stays coherent (mirrors the PATCH path).
    deps.configService.reload();
    return c.json(await buildEnvelope(deps));
  });

  app.patch('/api/active-provider', async (c) => {
    const body = await parsePatchBody(c.req.raw);
    // Only a selectable lens may become the active lens. This rejects the
    // non-gated `markdown` base (never a lens) and any disabled provider,
    // closing the loop the SPA enforces client-side via the dropdown.
    const selectable = await resolveSelectableProviders(deps);
    if (!selectable.includes(body.activeProvider)) {
      throw new HTTPException(400, {
        message: tx(SERVER_TEXTS.activeProviderNotSelectable, {
          id: body.activeProvider,
          selectable: selectable.join(', '),
        }),
      });
    }
    const result = applyLensSwitch(deps, body.activeProvider);
    deps.configService.reload();
    return c.json({ ...(await buildEnvelope(deps)), switch: result });
  });
}

async function buildEnvelope(deps: IRouteDeps): Promise<IActiveProviderEnvelope> {
  const r = resolveActiveProvider(deps.runtimeContext.cwd, deps.providers);
  return {
    activeProvider: r.resolved,
    detected: r.detected,
    source: r.source,
    selectable: await resolveSelectableProviders(deps),
    // Same provider list the envelope resolved `detected` from, so the
    // drift's `detected` lines up with the envelope's `detected`.
    markerDrift: computeMarkerDrift(deps.runtimeContext.cwd, deps.providers),
  };
}

/**
 * Project the set of registered Providers that are enabled right now.
 * Reads a fresh resolver from the layered config (`settings.json#/plugins`)
 * so a mid-session toggle is honoured without restarting `sm serve`,
 * mirroring `GET /api/plugins`. Keyed by
 * `provider.id` to line up with the `providerRegistry` the dropdown
 * iterates; deduped to stay stable when a plugin shadows a built-in id.
 */
async function resolveSelectableProviders(deps: IRouteDeps): Promise<string[]> {
  const resolveEnabled = await buildFreshResolver({
    effectiveConfig: () => deps.configService.effective(),
  });
  const selectable = new Set<string>();
  for (const provider of deps.providers) {
    // A provider is selectable when it is a LENS (gated on the active lens)
    // AND enabled right now. The non-gated `markdown` base is the universal
    // substrate, not a lens, so it drops out here even though it is enabled.
    // `isPluginExtensionEnabled` threads `installedDefaultEnabled(stability)`,
    // so experimental providers (ships-disabled by default) also drop out
    // until the operator enables them.
    if (
      provider.gatedByActiveLens === true &&
      isPluginExtensionEnabled(provider, resolveEnabled)
    ) {
      selectable.add(provider.id);
    }
  }
  return [...selectable];
}

/**
 * Persist the new lens, then drop the scan_* zone atomically. The
 * drop is silent when no DB file exists yet (fresh project, never
 * scanned). Returns the drop outcome so the response can tell the UI
 * what was cleared and prompt a rescan.
 */
function applyLensSwitch(deps: IRouteDeps, newValue: string): ILensSwitchResult {
  const cwd = deps.runtimeContext.cwd;
  try {
    writeConfigValue('activeProvider', newValue, { target: 'project', cwd });
  } catch (err) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.activeProviderPersistFailed, {
        message: formatErrorMessage(err),
      }),
    });
  }
  // Mirror the CLI's `sm config set activeProvider` (spec architecture.md
  // §Active Provider Lens, snapshot write #3): a manual lens switch is an
  // explicit provider decision, so refresh the `activeProviderMarkers`
  // snapshot to the detected set. Without this the marker-drift notice
  // (and `sm scan`'s warn) lingers after the switch, because
  // `computeMarkerDrift` keeps diffing the stale pre-switch snapshot, so
  // the drift banner never dismisses when the operator picks "Switch
  // lens". `detected` is filesystem-derived (independent of the lens just
  // written); this mirrors POST /accept-markers.
  const detected = resolveActiveProvider(cwd, deps.providers).detected;
  try {
    reconcileMarkersSnapshot(cwd, detected);
  } catch (err) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.activeProviderMarkersPersistFailed, {
        message: formatErrorMessage(err),
      }),
    });
  }
  const dbPath = resolveDbPath({ db: undefined, cwd });
  if (!existsSync(dbPath)) return { dropped: null };
  const dropResult = dropScanZone(dbPath);
  return {
    dropped: {
      tableCount: dropResult.tableCount,
      tableNames: dropResult.droppedTables,
    },
  };
}

const PATCH_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['activeProvider'],
  properties: {
    activeProvider: { type: 'string', minLength: 1 },
  },
} as const;

const parsePatchBody = makeBodyValidator<IPatchBody>(PATCH_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.activeProviderBodyNotJson,
  notObject: SERVER_TEXTS.activeProviderBodyNotObject,
  invalid: SERVER_TEXTS.activeProviderBodyMissing,
  mapping: {
    ':required': SERVER_TEXTS.activeProviderBodyMissing,
    '/activeProvider:type:string': SERVER_TEXTS.activeProviderValueNotString,
    '/activeProvider:minLength': SERVER_TEXTS.activeProviderValueEmpty,
  },
});
