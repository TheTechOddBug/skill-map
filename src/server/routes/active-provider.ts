/**
 * Active provider lens route, read + write the project's active
 * provider.
 *
 *   GET   /api/active-provider  → current envelope (resolved + detected list)
 *   PATCH /api/active-provider  → switch the lens; atomically drop scan_*
 *
 * The persisted setting lives at `.skill-map/settings.json` under the
 * `activeProvider` key (project layer, committed). When the operator
 * switches it, the scan_* zone is cleared atomically so the persisted
 * graph cannot reflect the previous lens (see
 * `spec/architecture.md` §Active Provider Lens). `state_*` and
 * `config_*` zones survive untouched.
 *
 * GET response shape:
 *
 *   ```json
 *   {
 *     "activeProvider": "claude" | null,
 *     "detected": ["claude", "openai"],
 *     "source": "config" | "autodetect" | "none"
 *   }
 *   ```
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
  activeProvider: string | null;
  detected: readonly string[];
  source: 'config' | 'autodetect' | 'none';
  /**
   * Registered-Provider ids that are enabled right now, resolved against
   * the live per-extension resolver (`config_plugins` layered over
   * `settings.json#/plugins`, the same resolution `GET /api/plugins`
   * applies). This is the subset of `providerRegistry` eligible to
   * become the lens. A Provider the operator disabled drops out of
   * `selectable` but stays in `providerRegistry` (the static boot
   * catalog keeps it so already-scanned nodes still render their chip).
   * The SPA greys out (and refuses to select) any dropdown entry absent
   * from this set, so a disabled Provider can never be picked as the
   * lens. See `spec/cli-contract.md` §Active provider lens.
   */
  selectable: readonly string[];
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

  app.patch('/api/active-provider', async (c) => {
    const body = await parsePatchBody(c.req.raw);
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
  };
}

/**
 * Project the set of registered Providers that are enabled right now.
 * Reads a fresh resolver (`config_plugins` layered over
 * `settings.json#/plugins`) so a mid-session toggle is honoured without
 * restarting `sm serve`, mirroring `GET /api/plugins`. Keyed by
 * `provider.id` to line up with the `providerRegistry` the dropdown
 * iterates; deduped to stay stable when a plugin shadows a built-in id.
 */
async function resolveSelectableProviders(deps: IRouteDeps): Promise<string[]> {
  const resolveEnabled = await buildFreshResolver({
    databasePath: deps.options.dbPath,
    effectiveConfig: () => deps.configService.effective(),
    fallbackResolver: deps.pluginRuntime.resolveEnabled,
  });
  const selectable = new Set<string>();
  for (const provider of deps.providers) {
    if (isPluginExtensionEnabled(provider, resolveEnabled)) {
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
