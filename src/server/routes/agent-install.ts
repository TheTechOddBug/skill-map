/**
 * Agent-process-skill install management (`spec/cli-contract.md` §Agent
 * process skill + the HTTP API table):
 *
 *   - `GET  /api/agent/install?provider=<id>`, install-status probe
 *     (CLI counterpart: `sm agent status`). The `stale` field drives
 *     the SPA button's three states (Install / Update / Up to date).
 *   - `POST /api/agent/install`, HTTP equivalent of `sm agent install`.
 *   - `POST /api/agent/uninstall`, HTTP equivalent of
 *     `sm agent uninstall` (but consent-gated, see below).
 *
 * The SPA drives these from Settings → Project. Both mutating verbs
 * write into territory skill-map does not own (the Provider's
 * `scaffold.skillDir`, e.g. `.claude/skills`), so they carry the same
 * SERVER-ENFORCED consent gate as the activity install routes: without
 * `confirm: true` in the body the route refuses `412 confirm-required`
 * and touches NOTHING; the SPA surfaces the refusal as an explicit
 * consent dialog naming the target path and retries.
 *
 * The mechanics live in the shared engine
 * (`core/agent-skill/engine.ts`), the same code the CLI verbs drive,
 * and the Provider → destination projection is the shared
 * `toScaffoldTarget` (`core/agent-skill/targets.ts`), so the two
 * surfaces cannot drift. Providers resolve off `deps.providers`
 * (built-ins + loaded drop-ins), a superset of the CLI's built-ins-only
 * catalog; the projection applies the same experimental gate as the
 * CLI default (no `--experimental` equivalent over HTTP).
 *
 * Unlike the activity install routes, engine IO failures are NOT
 * caught here: `installAgentSkill` / `uninstallAgentSkill` throw on
 * filesystem errors and the throw funnels through the global
 * `app.onError` (500 `internal`), the shared error surface for
 * unexpected server-side failures.
 *
 * These routes are loopback-gated like every `/api/*` route.
 */

import type { Hono } from 'hono';
// eslint-disable-next-line import-x/extensions
import { HTTPException } from 'hono/http-exception';

import { sanitizeForTerminal } from '../../kernel/util/safe-text.js';
import { tx } from '../../kernel/util/tx.js';
import type { IProvider } from '../../kernel/extensions/index.js';
import {
  agentSkillStatus,
  installAgentSkill,
  uninstallAgentSkill,
} from '../../core/agent-skill/engine.js';
import {
  PROCESS_JOBS_SKILL_DIR,
  PROCESS_JOBS_SKILL_FILE,
} from '../../core/agent-skill/skill-template.js';
import { toScaffoldTarget, type IScaffoldTarget } from '../../core/agent-skill/targets.js';
import { SERVER_TEXTS } from '../i18n/server.texts.js';
import { makeBodyValidator } from '../util/parse-body.js';
import { parseRequiredString } from '../util/parse-query.js';
import type { IRouteDeps } from './deps.js';

/** Wire shape of the status probe (and the base of both mutation responses). */
export interface IAgentInstallStatusEnvelope {
  provider: string;
  /** The provider declares a `scaffold.skillDir` (and is not gated). */
  supported: boolean;
  /** Scope-relative skill territory (`null` when unsupported). */
  skillDir: string | null;
  installed: boolean;
  /** Materialised bytes differ from this CLI's canonical copy. */
  stale: boolean;
}

interface IAgentInstallBody {
  provider: string;
  /** Server-enforced consent: mutations refuse 412 without `true`. */
  confirm?: boolean;
}

const AGENT_INSTALL_BODY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['provider'],
  properties: {
    provider: { type: 'string', minLength: 1 },
    confirm: { type: 'boolean' },
  },
} as const;

const parseAgentInstallBody = makeBodyValidator<IAgentInstallBody>(AGENT_INSTALL_BODY_SCHEMA, {
  notJson: SERVER_TEXTS.agentBodyNotJson,
  notObject: SERVER_TEXTS.agentBodyNotObject,
  invalid: SERVER_TEXTS.agentBodyNotObject,
  mapping: {
    '/provider:required': SERVER_TEXTS.agentProviderRequired,
    '/provider:type:string': SERVER_TEXTS.agentProviderRequired,
    '/provider:minLength': SERVER_TEXTS.agentProviderRequired,
    '/confirm:type:boolean': SERVER_TEXTS.agentConfirmNotBoolean,
  },
});

export function registerAgentInstallRoutes(app: Hono, deps: IRouteDeps): void {
  app.get('/api/agent/install', (c) => {
    const id = parseRequiredString(c.req.query('provider'), 'provider');
    const provider = resolveProviderOr404(deps, id);
    return c.json(buildStatusEnvelope(deps, provider));
  });

  app.post('/api/agent/install', async (c) => {
    const body = await parseAgentInstallBody(c.req.raw);
    const { provider, target } = requireScaffold(deps, body.provider);
    requireConsent(body, skillFileDisplay(target), SERVER_TEXTS.agentInstallConfirmRequired);
    // Engine call shared with `sm agent install`; the lens marker drop
    // (e.g. Codex's `.codex/`) rides inside it. IO throws propagate to
    // the global error handler (500).
    const outcome = installAgentSkill(deps.runtimeContext.cwd, target.skillDir, target.marker);
    return c.json({ ...buildStatusEnvelope(deps, provider), outcome });
  });

  app.post('/api/agent/uninstall', async (c) => {
    const body = await parseAgentInstallBody(c.req.raw);
    const { provider, target } = requireScaffold(deps, body.provider);
    requireConsent(body, skillFolderDisplay(target), SERVER_TEXTS.agentUninstallConfirmRequired);
    // Idempotent: `removed: false` when nothing was installed.
    const removed = uninstallAgentSkill(deps.runtimeContext.cwd, target.skillDir);
    return c.json({ ...buildStatusEnvelope(deps, provider), removed });
  });
}

/** Registered provider by id (scaffold-capable or not); unknown id → 404. */
function resolveProviderOr404(deps: IRouteDeps, id: string): IProvider {
  const provider = deps.providers.find((p) => p.id === id);
  if (provider === undefined) {
    throw new HTTPException(404, {
      message: tx(SERVER_TEXTS.agentInstallUnknownProvider, {
        provider: sanitizeForTerminal(id),
      }),
    });
  }
  return provider;
}

/**
 * Mutation gate: the provider must exist (404) AND project to a
 * scaffold target (400), i.e. declare a `scaffold.skillDir` and pass
 * the default experimental gate, the exact refusal set of the CLI
 * verbs.
 */
function requireScaffold(
  deps: IRouteDeps,
  id: string,
): { provider: IProvider; target: IScaffoldTarget } {
  const provider = resolveProviderOr404(deps, id);
  const target = toScaffoldTarget(provider);
  if (target === null) {
    throw new HTTPException(400, {
      message: tx(SERVER_TEXTS.agentInstallNoSkillDir, {
        provider: sanitizeForTerminal(id),
      }),
    });
  }
  return { provider, target };
}

/** 412 `confirm-required` unless the body carries the explicit consent flag. */
function requireConsent(body: IAgentInstallBody, path: string, template: string): void {
  if (body.confirm === true) return;
  throw new HTTPException(412, { message: tx(template, { path }) });
}

/** Relative display form of the skill folder (`<skillDir>/sm-process-jobs/`). */
function skillFolderDisplay(target: IScaffoldTarget): string {
  return `${target.skillDir}/${PROCESS_JOBS_SKILL_DIR}/`;
}

/** Relative display form of the skill file (`<skillDir>/sm-process-jobs/SKILL.md`). */
function skillFileDisplay(target: IScaffoldTarget): string {
  return `${target.skillDir}/${PROCESS_JOBS_SKILL_DIR}/${PROCESS_JOBS_SKILL_FILE}`;
}

function buildStatusEnvelope(
  deps: IRouteDeps,
  provider: IProvider,
): IAgentInstallStatusEnvelope {
  const target = toScaffoldTarget(provider);
  if (target === null) {
    return {
      provider: provider.id,
      supported: false,
      skillDir: null,
      installed: false,
      stale: false,
    };
  }
  // Byte-exact staleness probe shared with `sm agent status`, the same
  // comparison `installAgentSkill` reports as `updated`.
  const { installed, stale } = agentSkillStatus(deps.runtimeContext.cwd, target.skillDir);
  return {
    provider: provider.id,
    supported: true,
    skillDir: target.skillDir,
    installed,
    stale,
  };
}
