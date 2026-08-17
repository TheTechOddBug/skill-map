/**
 * Live-activity install management (`spec/provider-activity.md`
 * §Install management over HTTP):
 *
 *   - `GET  /api/activity/install?provider=<id>`, install-status probe.
 *   - `POST /api/activity/install`, HTTP equivalent of
 *     `sm activity install <provider>`.
 *   - `POST /api/activity/uninstall`, HTTP equivalent of
 *     `sm activity uninstall <provider>` (but consent-gated, see below).
 *
 * The SPA drives these from Settings → Project (the button below the
 * lens selector). Both mutating verbs modify files skill-map does not
 * own (the provider's project-local hook config) plus the bridge
 * artifact, so they carry a SERVER-ENFORCED consent gate: without
 * `confirm: true` in the body the route refuses `412 confirm-required`
 * and touches NOTHING; the SPA surfaces the refusal as an explicit
 * consent dialog naming the target file and retries. This is the HTTP
 * analogue of the CLI's TTY prompt, deliberately applied to uninstall
 * too (stricter than the CLI, which only prompts on install).
 *
 * The mechanics live in the shared engine (`core/activity/install.ts`),
 * the same code the CLI verbs drive, so the two surfaces cannot drift.
 * Providers resolve off `deps.providers` (built-ins + loaded drop-ins),
 * a superset of the CLI's built-ins-only set.
 *
 * These routes are loopback-gated like every `/api/*` route; they do
 * NOT take the serve.json token (that authenticates the bridge's ingest
 * path, not the operator's own UI).
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { formatErrorMessage } from '../../kernel/util/format-error.js';
import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import type { IProvider } from '../../kernel/extensions/index.js';
import { readConfigValue, writeConfigValue } from '../../core/config/helper.js';
import {
  activityInstallStatus,
  demoteShellCaptureLevel,
  installActivityBridge,
  uninstallActivityBridge,
} from '../../core/activity/install.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { makeBodyValidator } from '../util/parse-body.js';
import { parseRequiredString } from '../util/parse-query.js';
import type { IRouteDeps } from './deps.js';

/** Wire shape of the status probe (and the base of both mutation responses). */
export interface IActivityInstallStatusEnvelope {
  provider: string;
  /** The provider declares `activity` with an implemented install kind. */
  supported: boolean;
  /** `configWired && bridgePresent`. */
  installed: boolean;
  /** Scope-relative hook config path (`null` when unsupported). */
  configPath: string | null;
  configWired: boolean;
  bridgePresent: boolean;
  /** How many hook events the descriptor wires. */
  events: number;
}

interface IInstallBody {
  provider: string;
  /** Server-enforced consent: mutations refuse 412 without `true`. */
  confirm?: boolean;
  /**
   * Shell-rung opt-in mirror of the CLI `--shell`/`--no-shell` pair
   * (spec provider-activity.md, Capture level rung 5): present persists
   * `activity.shellCapture` before rendering; absent respects the
   * stored choice.
   */
  shellCapture?: boolean;
}

const INSTALL_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['provider'],
  properties: {
    provider: { type: 'string', minLength: 1 },
    confirm: { type: 'boolean' },
    shellCapture: { type: 'boolean' },
  },
} as const;

const parseInstallBody = makeBodyValidator<IInstallBody>(INSTALL_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.activityBodyNotJson,
  notObject: SERVER_TEXTS.activityBodyNotObject,
  invalid: SERVER_TEXTS.activityBodyNotObject,
  mapping: {
    '/provider:required': SERVER_TEXTS.activityProviderRequired,
    '/provider:type:string': SERVER_TEXTS.activityProviderRequired,
    '/provider:minLength': SERVER_TEXTS.activityProviderRequired,
    '/confirm:type:boolean': SERVER_TEXTS.activityInstallConfirmNotBoolean,
  },
});

export function registerActivityInstallRoutes(app: Hono, deps: IRouteDeps): void {
  app.get('/api/activity/install', (c) => {
    const id = parseRequiredString(c.req.query('provider'), 'provider');
    const provider = resolveProviderOr404(deps, id);
    return c.json(buildStatusEnvelope(deps, provider));
  });

  app.post('/api/activity/install', async (c) => {
    const body = await parseInstallBody(c.req.raw);
    const provider = requireSupported(deps, body.provider);
    requireConsent(body, provider, SERVER_TEXTS.activityInstallConfirmRequired);
    try {
      if (body.shellCapture !== undefined) {
        writeConfigValue('activity.shellCapture', body.shellCapture, {
          cwd: deps.runtimeContext.cwd,
          target: 'project-local',
        });
        // Turning the rung off must not leave the persisted level
        // pointing at it (the live cell self-heals on the next
        // session-journal read).
        if (!body.shellCapture) demoteShellCaptureLevel(deps.runtimeContext.cwd);
      }
      await installActivityBridge(deps.runtimeContext.cwd, provider);
    } catch (err) {
      throw buildIoFailure(SERVER_TEXTS.activityInstallFailed, err);
    }
    return c.json(buildStatusEnvelope(deps, provider));
  });

  app.post('/api/activity/uninstall', async (c) => {
    const body = await parseInstallBody(c.req.raw);
    const provider = requireSupported(deps, body.provider);
    requireConsent(body, provider, SERVER_TEXTS.activityUninstallConfirmRequired);
    let removed: boolean;
    try {
      // The full registry decides shared-bridge retention: the bridge
      // dir stays while any OTHER hook-file provider remains wired.
      removed = uninstallActivityBridge(
        deps.runtimeContext.cwd,
        provider,
        deps.providers,
      ).removed;
    } catch (err) {
      throw buildIoFailure(SERVER_TEXTS.activityUninstallFailed, err);
    }
    return c.json({ ...buildStatusEnvelope(deps, provider), removed });
  });
}

/** Registered provider by id (activity or not); unknown id → 404. */
function resolveProviderOr404(deps: IRouteDeps, id: string): IProvider {
  const provider = deps.providers.find((p) => p.id === id);
  if (provider === undefined) {
    throw new HTTPException(404, {
      message: tx(SERVER_TEXTS.activityInstallUnknownProvider, {
        provider: sanitizeForTerminal(id),
      }),
    });
  }
  return provider;
}

/**
 * Mutation gate: the provider must exist (404) AND declare an
 * implemented install kind (400). Both spec'd shapes are implemented
 * today, so the 400 branch only fires for a future kind.
 */
function requireSupported(deps: IRouteDeps, id: string): IProvider {
  const provider = resolveProviderOr404(deps, id);
  if (!isSupported(provider)) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.activityInstallUnsupported, {
        provider: sanitizeForTerminal(id),
        kind: provider.activity?.install.kind ?? 'none',
      }),
    });
  }
  return provider;
}

/** 412 `confirm-required` unless the body carries the explicit consent flag. */
function requireConsent(
  body: IInstallBody,
  provider: IProvider,
  template: string,
): void {
  if (body.confirm === true) return;
  throw new HTTPException(412, {
    message: tx(template, { configPath: provider.activity!.install.configPath }),
  });
}

function buildIoFailure(template: string, err: unknown): HTTPException {
  return new HTTPException(400, {
    message: tx(template, {
      message: sanitizeForTerminal(formatErrorMessage(err)),
    }),
  });
}

function isSupported(provider: IProvider): boolean {
  // Both install shapes are implemented (`json-hooks` spawned bridge,
  // `plugin-file` in-process plugin); the guard stays for future kinds.
  return provider.activity !== undefined;
}

function buildStatusEnvelope(
  deps: IRouteDeps,
  provider: IProvider,
): IActivityInstallStatusEnvelope {
  if (!isSupported(provider)) {
    return {
      provider: provider.id,
      supported: false,
      installed: false,
      configPath: null,
      configWired: false,
      bridgePresent: false,
      events: 0,
    };
  }
  const install = provider.activity!.install;
  const status = activityInstallStatus(deps.runtimeContext.cwd, provider);
  // Count the events that WOULD render under the current opt-ins (the
  // engine's own filter), not the raw descriptor length: an opt-in
  // event the operator never enabled is not part of this install.
  const shellOn =
    readConfigValue<boolean>('activity.shellCapture', {
      cwd: deps.runtimeContext.cwd,
      default: false,
    }) === true;
  const renderable = (install.kind === 'json-hooks' ? (install.events ?? []) : []).filter(
    (event) => event.optIn === undefined || (event.optIn === 'shell' && shellOn),
  );
  return {
    provider: provider.id,
    supported: true,
    installed: status.installed,
    configPath: install.configPath,
    configWired: status.configWired,
    bridgePresent: status.bridgePresent,
    events: renderable.length,
  };
}
