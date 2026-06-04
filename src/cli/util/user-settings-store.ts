/**
 * The ONLY legitimate `os.homedir()` reads in skill-map. Per
 * `spec/cli-contract.md` §Scope is always project-local, the per-user,
 * per-machine settings file lives at `~/.skill-map/settings.json` and
 * holds the small set of preferences that genuinely belong to the
 * operator (not to a project): the update-check toggle + its throttle
 * bookkeeping today, future locale / theme. The file is validated
 * against `spec/schemas/user-settings.schema.json` (AJV, draft 2020-12).
 *
 * The shape on disk is intentionally JSON (not the project DB) so:
 *
 *   1. A brand-new install with no project DB can still throttle.
 *   2. The toggle survives across projects (the user is opting out
 *      once for their machine, not per-project).
 *
 * There is intentionally NO `.local` partner: values here are already
 * per-machine, so the project / project-local split would have no
 * meaning.
 *
 * Read / write helpers degrade silently on every error: a missing
 * file, a malformed JSON payload, a schema validation failure, or an
 * EACCES on write must never crash the verb path. Validation failures
 * fall back to the defaulted envelope and are logged once to stderr so
 * the operator can fix the file if they care.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { loadSchemaValidators } from '../../kernel/adapters/schema-validators.js';
import { writeFileAtomicExclusive } from '../../kernel/util/atomic-write.js';
import { SKILL_MAP_DIR } from '../../core/paths/db-path.js';

const FILENAME = 'settings.json';
const SCHEMA_VERSION = 1 as const;

/**
 * Update-check bookkeeping sub-object. Mirrors
 * `user-settings.schema.json#/properties/updateCheck`.
 */
export interface IUserSettingsUpdateCheck {
  /** Operator opt-out toggle. Default `true` when absent. */
  enabled?: boolean;
  /** Latest version observed at the last npm-registry probe. `null` when never probed. */
  latestVersion?: string | null;
  /** Unix ms of the last registry probe. `null` when never probed. */
  checkedAt?: number | null;
  /** Unix ms of the last banner emission. `null` when never shown. */
  shownAt?: number | null;
}

/**
 * Telemetry consent sub-object. Mirrors
 * `user-settings.schema.json#/properties/telemetry`. Every surface is OFF
 * by default: a surface initialises only once its toggle is explicitly
 * `true`. See `spec/telemetry.md` §Consent contract.
 */
export interface IUserSettingsTelemetry {
  /** Operator opt-in for error reporting (Sentry). Absent or `false` means OFF. */
  errorsEnabled?: boolean;
  /** Operator opt-in for CLI usage analytics (PostHog). Absent or `false` means OFF. */
  usageCliEnabled?: boolean;
  /** Operator opt-in for UI usage analytics (PostHog). Absent or `false` means OFF. */
  usageUiEnabled?: boolean;
  /**
   * Random UUID v4 used as the PostHog `distinct_id` for the usage
   * surface, shared by CLI + UI. Minted once when any usage toggle first
   * becomes `true`; never regenerated. `null` (or absent) until then.
   */
  anonymousId?: string | null;
  /** Unix ms of the first run where the consent prompt was eligible. `null` before any. */
  firstRunAt?: number | null;
  /** Unix ms of the consent prompt. `null` when never prompted. */
  promptedAt?: number | null;
}

/**
 * Whole-file envelope. Mirrors `user-settings.schema.json`. Future
 * user-scope features (locale, theme) extend the root, not
 * `updateCheck`.
 */
export interface IUserSettings {
  schemaVersion: 1;
  updateCheck?: IUserSettingsUpdateCheck;
  telemetry?: IUserSettingsTelemetry;
}

/** Absolute path to `~/.skill-map/settings.json`. */
export function userSettingsFilePath(): string {
  return join(homedir(), SKILL_MAP_DIR, FILENAME);
}

/**
 * Default envelope returned when the file is missing, unreadable, or
 * fails validation. Callers can branch on the sub-fields they care
 * about without try / catch boilerplate.
 */
function defaultSettings(): IUserSettings {
  return { schemaVersion: SCHEMA_VERSION, updateCheck: {}, telemetry: {} };
}

/**
 * Read + AJV-validate the file. Returns a defaulted envelope on any
 * failure (missing file, JSON parse error, schema mismatch). Never
 * throws.
 */
export function readUserSettings(): IUserSettings {
  const parsed = readParsedFile();
  if (parsed === null) return defaultSettings();
  const validated = validateOrDefault(parsed);
  return backfillSubObjects(validated);
}

/**
 * Read + JSON-parse the on-disk file. Returns `null` on any failure
 * mode (missing, unreadable, malformed, non-object root). Splits the
 * filesystem branch out of `readUserSettings` so complexity stays
 * inside the budget.
 */
function readParsedFile(): Record<string, unknown> | null {
  const path = userSettingsFilePath();
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Run AJV against the parsed payload. Returns the defaulted envelope
 * when validators are unavailable (spec resolution failure inside a
 * sandbox) or when the payload is off-shape.
 */
function validateOrDefault(parsed: Record<string, unknown>): IUserSettings {
  const validators = tryLoadValidators();
  if (validators === null) return defaultSettings();
  const result = validators.validate<IUserSettings>('user-settings', parsed);
  if (!result.ok) return defaultSettings();
  return result.data;
}

/**
 * Backfill the optional sub-objects (`updateCheck: {}`, `telemetry: {}`)
 * so callers can dereference without an existence check. AJV will not
 * have added them because the schema makes each one optional.
 */
function backfillSubObjects(settings: IUserSettings): IUserSettings {
  return {
    ...settings,
    updateCheck: settings.updateCheck ?? {},
    telemetry: settings.telemetry ?? {},
  };
}

/**
 * Deep-merge `patch` into the on-disk file, creating `~/.skill-map/` if
 * absent. AJV-validates the merged payload before writing; a failed
 * validation is treated as a no-op so the on-disk file never holds an
 * off-shape value. Best-effort, swallows every write error so the
 * banner path stays non-fatal.
 *
 * Disk handling (audit H2 / L5):
 *
 *   - The parent directory `~/.skill-map/` is created with mode `0o700`
 *     so a multi-user host does not leave the per-operator preferences
 *     world-listable. Future user-scope features (locale, theme, and
 *     eventually anything that might carry a token) inherit the same
 *     posture without a follow-up audit.
 *   - The settings file itself is written via
 *     `writeFileAtomicExclusive`, the same CSPRNG-named, `O_EXCL |
 *     O_NOFOLLOW`, mode `0o600` helper the sidecar store and the
 *     project-config writer use. A pre-planted symlink at
 *     `~/.skill-map/settings.json` (or at the CSPRNG-named temp path)
 *     no longer redirects the write to an arbitrary target, and the
 *     rename is atomic so a crash mid-write never leaves a half JSON
 *     file the next read would have to discard.
 */
export function writeUserSettings(patch: Partial<IUserSettings>): void {
  const dir = join(homedir(), SKILL_MAP_DIR);
  const path = userSettingsFilePath();
  try {
    const current = readUserSettings();
    const merged = mergeSettings(current, patch);
    const validators = tryLoadValidators();
    if (validators !== null) {
      const result = validators.validate<IUserSettings>('user-settings', merged);
      if (!result.ok) return;
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileAtomicExclusive(path, JSON.stringify(merged, null, 2) + '\n');
  } catch {
    // ignore, persistence is best-effort.
  }
}

/**
 * `true` when the operator has not opted out of the update check (the
 * field is absent or `true`). The toggle lives in
 * `~/.skill-map/settings.json` under `updateCheck.enabled` and is NOT
 * part of the project config layer system; `sm config` does not
 * surface it.
 */
export function isUpdateCheckEnabled(): boolean {
  const settings = readUserSettings();
  return settings.updateCheck?.enabled !== false;
}

/**
 * `true` only when the operator has explicitly opted in to error
 * reporting (`telemetry.errorsEnabled === true`). Unlike the update
 * check, telemetry is **OFF by default**: absent or `false` both mean
 * disabled. The flag lives in `~/.skill-map/settings.json` under
 * `telemetry.errorsEnabled` and is NOT part of the project config layer
 * system; `sm config` does not surface it (see `spec/telemetry.md`).
 */
export function isErrorTelemetryEnabled(): boolean {
  const settings = readUserSettings();
  return settings.telemetry?.errorsEnabled === true;
}

/**
 * `true` only when the operator has explicitly opted in to CLI usage
 * analytics (`telemetry.usageCliEnabled === true`). OFF by default;
 * independent of `errorsEnabled` and `usageUiEnabled`. Read fresh on every
 * `sm` invocation, so a Settings-UI toggle is honoured on the next run.
 */
export function isUsageCliTelemetryEnabled(): boolean {
  const settings = readUserSettings();
  return settings.telemetry?.usageCliEnabled === true;
}

/**
 * `true` only when the operator has explicitly opted in to UI usage
 * analytics (`telemetry.usageUiEnabled === true`). OFF by default;
 * independent of the other two toggles. Surfaced to the browser through
 * `GET /api/preferences`.
 */
export function isUsageUiTelemetryEnabled(): boolean {
  const settings = readUserSettings();
  return settings.telemetry?.usageUiEnabled === true;
}

/**
 * The persisted anonymous usage `distinct_id`, or `null` when usage has
 * never been enabled. Read-only accessor; minting happens in
 * `ensureAnonymousId`. Surfaced read-only to the browser so the UI shares
 * the CLI's id.
 */
export function readAnonymousId(): string | null {
  const settings = readUserSettings();
  return settings.telemetry?.anonymousId ?? null;
}

/**
 * Return the install's anonymous usage id, minting + persisting one on
 * first call. Idempotent: once a non-empty id exists it is returned
 * unchanged (no rewrite), so re-enabling usage never rotates the id. The
 * `generate` parameter is injectable for deterministic tests. Best-effort
 * persistence (via `writeUserSettings`); the returned id is always valid
 * even if the write is swallowed.
 */
export function ensureAnonymousId(generate: () => string = () => randomUUID()): string {
  const existing = readAnonymousId();
  if (existing !== null && existing !== '') return existing;
  const id = generate();
  writeUserSettings({ telemetry: { anonymousId: id } });
  return id;
}

/**
 * `true` when the first-run consent prompt has already been shown
 * (`telemetry.promptedAt` is a number). Callers use this to decide
 * whether to surface the one-time prompt; once shown, the persisted
 * `errorsEnabled` is authoritative and the prompt is never repeated.
 */
export function hasTelemetryPromptBeenShown(): boolean {
  const settings = readUserSettings();
  return typeof settings.telemetry?.promptedAt === 'number';
}

/**
 * `true` once an eligible run has already been seen (`telemetry.firstRunAt`
 * is a number). The consent prompt is deferred to the SECOND eligible run
 * (so it does not stack on the first-run provider-lens prompt): the first
 * eligible run stamps `firstRunAt` and stays silent, the next one prompts.
 */
export function hasSeenFirstRun(): boolean {
  const settings = readUserSettings();
  return typeof settings.telemetry?.firstRunAt === 'number';
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Deep-merge for the two-level envelope. The root is shallow-merged
 * (only `schemaVersion` and `updateCheck` keys today), and
 * `updateCheck` is shallow-merged on top of the current sub-object.
 * Future top-level sub-objects (locale, theme) follow the same
 * pattern, each is shallow-merged independently.
 */
function mergeSettings(
  current: IUserSettings,
  patch: Partial<IUserSettings>,
): IUserSettings {
  const merged: IUserSettings = {
    schemaVersion: SCHEMA_VERSION,
    updateCheck: { ...(current.updateCheck ?? {}) },
    telemetry: { ...(current.telemetry ?? {}) },
  };
  if (patch.updateCheck) {
    merged.updateCheck = { ...merged.updateCheck, ...patch.updateCheck };
  }
  if (patch.telemetry) {
    merged.telemetry = { ...merged.telemetry, ...patch.telemetry };
  }
  return merged;
}

/**
 * Defensive wrapper around `loadSchemaValidators`. The kernel boot path
 * normally never fails to compile schemas, but a corrupt spec install
 * (e.g. a missing schema file) would throw. The settings store must
 * stay non-fatal, so a load failure degrades to "no validator", which
 * the callers translate to the defaulted envelope.
 */
function tryLoadValidators(): ReturnType<typeof loadSchemaValidators> | null {
  try {
    return loadSchemaValidators();
  } catch {
    return null;
  }
}
