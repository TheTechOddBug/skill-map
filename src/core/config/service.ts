/**
 * Cached layered-config view for the long-running BFF (`sm serve`).
 *
 * The CLI's verbs are short-lived: each verb calls `loadConfig()` once
 * and exits, so re-reading six layers per command costs nothing. The
 * BFF is different, every request that consults the config (the
 * sidecar-consent gate, `GET /api/config`, the project-preferences
 * route) would otherwise re-walk every settings.json on disk + re-run
 * AJV validation per request.
 *
 * `ConfigService` is a thin lazy cache around `loadConfig()`:
 *
 *   - `get()` returns the cached `ILoadedConfig` (loading on first
 *     call). Subsequent calls reuse the same object reference.
 *   - `effective()` is sugar for `this.get().effective`.
 *   - `reload()` clears the cache so the next `get()` re-reads from
 *     disk. Routes that mutate the config (PATCH project-preferences,
 *     PATCH preferences, the `confirm: true` arm of the sidecar
 *     consent gate) call this immediately after the write completes.
 *
 * Lives under `core/config/` (next to `helper.ts` / `sidecar-consent.ts`)
 * because the BFF mounts it as a Hono `var` middleware
 * (`c.var.configService`). The CLI does not need this, it calls
 * `loadConfig()` / `readConfigValue()` directly per verb.
 */

import { loadConfig, type ILoadedConfig, type IEffectiveConfig } from '../../kernel/config/loader.js';

export interface IConfigServiceOpts {
  /**
   * Forwarded to `loadConfig`. `'project'` walks every layer;
   * `'global'` skips the project layers. The BFF instantiates one
   * `ConfigService` at boot mirroring `IServerOptions.scope`.
   */
  scope: 'project' | 'global';
  cwd: string;
  homedir: string;
  /**
   * Forwarded to `loadConfig`. The BFF never enables strict so one
   * bad layer does not break the boot path; tests opt in to assert
   * the throw-vs-warn split.
   */
  strict?: boolean;
}

export class ConfigService {
  readonly #opts: IConfigServiceOpts;
  #cache: ILoadedConfig | null = null;

  constructor(opts: IConfigServiceOpts) {
    this.#opts = opts;
  }

  /**
   * Return the cached `ILoadedConfig` (loading on first call).
   * Subsequent calls return the same object reference, callers
   * MUST treat it as read-only.
   */
  get(): ILoadedConfig {
    if (this.#cache === null) {
      this.#cache = loadConfig({
        scope: this.#opts.scope,
        cwd: this.#opts.cwd,
        homedir: this.#opts.homedir,
        ...(this.#opts.strict ? { strict: true } : {}),
      });
    }
    return this.#cache;
  }

  /**
   * Sugar for `this.get().effective`, the most common consumer pattern
   * (the `sources` / `warnings` slots are only relevant to the
   * `GET /api/config` and `sm config show` paths).
   */
  effective(): IEffectiveConfig {
    return this.get().effective;
  }

  /**
   * Drop the cached `ILoadedConfig`. Next `get()` re-reads every layer
   * from disk. Called by routes after a successful `writeConfigValue`
   * (PATCH preferences / project-preferences) and by the sidecar
   * consent gate after it flips `allowEditSmFiles` to `true`.
   */
  reload(): void {
    this.#cache = null;
  }
}
