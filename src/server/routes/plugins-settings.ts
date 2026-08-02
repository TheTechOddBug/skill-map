/**
 * Per-extension settings projection + write helpers for the plugins
 * route (`routes/plugins.ts`).
 *
 * Read side: given a loaded extension's manifest (the built-in manifest
 * object or a discovered extension's `instance`) and the merged config,
 * project the declared `settings[]` (manifest order, each carrying its
 * `id`) and the resolved `settingValues` map. A `secret`-typed setting's
 * real value is NEVER emitted; instead its id is listed in
 * `secretSettingsSet` when a stored value exists, so the SPA can render
 * "set" vs "empty" without leaking the token.
 *
 * Write side: validate a bulk-PATCH `settings` patch against the
 * extension's declarations (every settingId declared, every value
 * passing its per-type rules via the kernel resolver) BEFORE any write;
 * then persist each value through `core/config/helper:writeConfigValue`
 * with `target: 'project-local'` for `secret`-typed settings and
 * `'project'` for everything else. The dot key is
 * `plugins.<pluginId>.extensions.<extId>.settings.<settingId>`.
 *
 * The kernel resolver (`core/config/plugin-settings`) is the single
 * source of truth for both the effective values and the per-type
 * validation; this module never re-implements either. Values arrive
 * already JSON-typed from the client (the UI posts real JSON), so there
 * is no shell-string coercion here, unlike the CLI's `sm plugins config`
 * verb. Type validation still runs against the manifest.
 */

import {
  resolveExtensionSettings,
  type ISettingsManifestRef,
  type TSettingsEnv,
} from '../../core/config/plugin-settings.js';
import { writeConfigValue } from '../../core/config/helper.js';
import { isProjectLocalOnlyKey, type IEffectiveConfig } from '../../kernel/config/loader.js';
import type { TSettingDeclaration } from '../../kernel/types/view-catalog.js';

/**
 * Wire shape for one declared setting on the `GET /api/plugins`
 * extension projection. The full manifest declaration (discriminated by
 * `type`, carrying its per-type params) plus the `id` (the settingId
 * key). The UI renders the control from `type` + params and labels it
 * from `label` / `description`.
 */
export type ISettingDeclarationApi = TSettingDeclaration & { id: string };

/**
 * Settings projection for one extension on the read side. All three
 * fields are optional and omitted entirely when empty so the wire shape
 * stays lean for the (common) no-settings extension.
 */
export interface IExtensionSettingsProjection {
  /** Declared settings in manifest order, each = declaration + `id`. */
  settings?: ISettingDeclarationApi[];
  /**
   * Resolved effective values keyed by settingId. Secret values are
   * NEVER present here (see `secretSettingsSet`).
   */
  settingValues?: Record<string, unknown>;
  /**
   * settingIds of `secret`-typed settings that currently hold a stored
   * value (in `settings.json` / `settings.local.json`). Lets the UI show
   * "set" vs "empty" without the value ever crossing the wire. Listed
   * only when a value exists; omitted when no secret is set.
   */
  secretSettingsSet?: string[];
}

/**
 * Read the declared `settings` map off a manifest-like object (a
 * built-in manifest, or a discovered extension's `instance`). Loosely
 * typed: the discovered side stamps `instance` as `unknown`, so we
 * shape-check before reading. Returns `undefined` when the object is not
 * an object or declares no settings.
 */
export function readManifestSettings(
  manifestLike: unknown,
): Record<string, TSettingDeclaration> | undefined {
  if (manifestLike === null || typeof manifestLike !== 'object') return undefined;
  const settings = (manifestLike as { settings?: unknown }).settings;
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    return settings as Record<string, TSettingDeclaration>;
  }
  return undefined;
}

/**
 * Project the `settings` / `settingValues` / `secretSettingsSet` triple
 * for one extension. Returns an empty object (all fields absent) when
 * the extension declares no settings, so the caller can spread it
 * unconditionally onto the row.
 *
 * `pluginId` / `extId` are the owning plugin id and the extension's leaf
 * id; `declarations` is the manifest-declared settings map; `config` is
 * the merged effective config (from `configService.effective()`); `env`
 * is the server's environment snapshot (`IServerOptions.settingsEnv`).
 */
export function projectExtensionSettings(
  pluginId: string,
  extId: string,
  declarations: Record<string, TSettingDeclaration> | undefined,
  config: { plugins?: IEffectiveConfig['plugins'] },
  env: TSettingsEnv,
): IExtensionSettingsProjection {
  if (!declarations || Object.keys(declarations).length === 0) return {};

  // Declarations in MANIFEST ORDER, each carrying its settingId as `id`.
  const settings: ISettingDeclarationApi[] = Object.entries(declarations).map(
    ([id, declaration]) => ({ ...declaration, id }),
  );

  // Effective values via the kernel resolver (swallow warnings, a bad
  // operator value degrades to the default the same as at scan time).
  // The env snapshot rides along so a secret provided via `envVar` shows
  // as "Set" in the UI (`secretSettingsSet`), same as at scan time.
  const ref: ISettingsManifestRef = { pluginId, id: extId, settings: declarations };
  const resolved = resolveExtensionSettings(
    ref,
    config,
    () => {
      /* swallow resolver warnings; the projection shows the fallback */
    },
    env,
  );

  // Split secret-typed values out: never emit the real value, instead
  // record the id in `secretSettingsSet` when a value resolved.
  const settingValues: Record<string, unknown> = {};
  const secretSet: string[] = [];
  for (const [id, declaration] of Object.entries(declarations)) {
    if (declaration.type === 'secret') {
      if (Object.prototype.hasOwnProperty.call(resolved, id)) secretSet.push(id);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(resolved, id)) {
      settingValues[id] = resolved[id];
    }
  }

  return {
    settings,
    settingValues,
    ...(secretSet.length > 0 ? { secretSettingsSet: secretSet } : {}),
  };
}

/**
 * Validation failure for one settings value in a bulk-PATCH change.
 * Carries the offending settingId and a human reason; the route maps it
 * into the `BulkValidationError` envelope (`details.id` = the change id).
 */
export interface ISettingsValidationFailure {
  settingId: string;
  reason: string;
}

/**
 * Validate a `settings` patch for one extension against its manifest
 * declarations. Returns `null` when every entry is a declared setting
 * AND its value passes the per-type rules; otherwise the first failure.
 *
 * The per-type check reuses the kernel resolver with a throwing-sink
 * pattern: feed the candidate value as the only override for that
 * setting and observe whether the resolver warns (an invalid value
 * degrades to default + warns; a valid one passes silently). This is
 * the exact mechanism the CLI's `sm plugins config` write path uses, so
 * the BFF and CLI accept identical value sets.
 */
export function validateSettingsPatch(
  pluginId: string,
  extId: string,
  declarations: Record<string, TSettingDeclaration> | undefined,
  patch: Record<string, unknown>,
): ISettingsValidationFailure | null {
  for (const [settingId, value] of Object.entries(patch)) {
    const declaration = declarations?.[settingId];
    if (!declaration) {
      return {
        settingId,
        reason: `extension "${pluginId}/${extId}" declares no setting "${settingId}"`,
      };
    }
    let invalidReason: string | null = null;
    resolveExtensionSettings(
      { pluginId, id: extId, settings: { [settingId]: declaration } },
      { plugins: { [pluginId]: { extensions: { [extId]: { settings: { [settingId]: value } } } } } },
      (message) => {
        invalidReason = message;
      },
    );
    if (invalidReason !== null) {
      return { settingId, reason: invalidReason };
    }
  }
  return null;
}

/**
 * Persist one extension's validated `settings` patch. Each value lands
 * via `writeConfigValue` under
 * `plugins.<pluginId>.extensions.<extId>.settings.<settingId>`, routed
 * to `project-local` (gitignored `settings.local.json`) for `secret`-
 * typed settings and `project` (committed `settings.json`) otherwise.
 *
 * Assumes the patch already passed `validateSettingsPatch` (every
 * settingId is declared, every value type-checks). `writeConfigValue`
 * AJV-revalidates the merged file on every write, so a slip still fails
 * loudly rather than corrupting the config.
 */
export function persistSettingsPatch(
  pluginId: string,
  extId: string,
  declarations: Record<string, TSettingDeclaration> | undefined,
  patch: Record<string, unknown>,
  cwd: string,
): void {
  for (const [settingId, value] of Object.entries(patch)) {
    const declaration = declarations?.[settingId];
    const dotKey = `plugins.${pluginId}.extensions.${extId}.settings.${settingId}`;
    // Secrets and `PROJECT_LOCAL_ONLY_KEYS` members (the github base-URL
    // overrides) both live in the gitignored local layer; the committed
    // layer would be refused by `writeConfigValue`.
    const target: 'project' | 'project-local' =
      declaration?.type === 'secret' || isProjectLocalOnlyKey(dotKey)
        ? 'project-local'
        : 'project';
    writeConfigValue(dotKey, value, { target, cwd });
  }
}
