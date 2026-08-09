/**
 * Per-incident crash-report consent state for the UI
 * (`spec/telemetry.md` §Per-incident crash-report consent).
 *
 * When the Angular `ErrorHandler` catches an unhandled runtime error, this
 * root service decides whether to open the consent dialog and, on an
 * accept, arms the Sentry client late (idempotent `initUiSentry`) and
 * captures THAT error. Send is the dialog's default action (spec rule 2:
 * flat Yes default, an explicit dismiss always wins); the answer is never
 * persisted, the next (distinct) error asks again. The persisted
 * `telemetry.errorsEnabled` toggle plays no role on this path.
 *
 * Repetition is bounded per spec: errors are deduplicated per session by a
 * `name + message + first stack line` key (a broken template expression
 * re-throws on every change-detection pass; asking once per session per
 * distinct error is the contract), and at most one dialog is open at a
 * time (an error arriving while the dialog is open is dropped; it is
 * already on the console).
 *
 * Demo mode (`SKILL_MAP_MODE === 'demo'`, the public static bundle) is
 * fully suppressed: there is no BFF to read preferences from and the
 * showcase must never interrupt with consent dialogs. Module-load
 * failures (a lazy chunk that fails to fetch, spec rule 6) never open
 * the dialog either: the crash is environmental (server gone, stale
 * cached shell), not a defect worth a report.
 */

import { Injectable, inject, signal } from '@angular/core';

import { SKILL_MAP_MODE } from '../../../services/data-source/runtime-mode';
import { scrubString } from './scrub';
import { captureUiException, initUiSentry, isUiDsnConfigured } from './sentry-init';

/** Boot-time facts a late (accept-time) `initUiSentry` needs. */
export interface ICrashConsentConfig {
  release: string | null;
  environment: 'dev' | 'prod';
  /**
   * Absolute project root (`/api/health` `cwd`): collapsed to
   * `<PROJECT>` in the dialog preview AND threaded into the SDK
   * `beforeSend`, so the project directory name never rides a report.
   * `null` (health failed) falls back to home-only scrubbing.
   */
  projectRoot: string | null;
}

/**
 * Module-load failures excluded from the consent flow
 * (`spec/telemetry.md` §Per-incident crash-report consent, rule 6): a
 * lazy chunk that fails to fetch means the serving process is gone or a
 * cached shell went stale, not a defect in the running code, so there
 * is nothing actionable to report (and typically no server behind the
 * page anyway). The three phrasings are Chrome/Edge, Firefox, and
 * Safari for the same native dynamic-import failure; matched against
 * the message so a wrapped rejection (`Uncaught (in promise): ...`)
 * is caught too.
 */
const MODULE_LOAD_FAILURE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/;

function isModuleLoadFailure(error: unknown): boolean {
  if (error instanceof Error) return MODULE_LOAD_FAILURE.test(error.message);
  return typeof error === 'string' && MODULE_LOAD_FAILURE.test(error);
}

/** Session dedupe key: enough to collapse a re-thrown CD-loop error. */
function crashKey(error: unknown): string {
  if (error instanceof Error) {
    const firstFrame = (error.stack ?? '').split('\n')[1] ?? '';
    return `${error.name}|${error.message}|${firstFrame.trim()}`;
  }
  return `thrown|${String(error)}`;
}

@Injectable({ providedIn: 'root' })
export class CrashReportConsentService {
  private readonly mode = inject(SKILL_MAP_MODE);

  /** Errors already offered this session (asked once per distinct error). */
  private readonly seen = new Set<string>();

  /** The error the open dialog is about; `null` while closed. */
  private pendingError: unknown = null;

  private readonly openSig = signal(false);
  /** Drives the dialog visibility in the app shell. */
  readonly open = this.openSig.asReadonly();

  private readonly previewSig = signal('');
  /** Scrubbed one-line summary of the pending error, for the dialog body. */
  readonly preview = this.previewSig.asReadonly();

  private release: string | null = null;
  private environment: 'dev' | 'prod' = 'prod';
  private projectRoot: string | null = null;

  /**
   * Boot wiring (app initializer): the facts a late `initUiSentry` needs.
   * Never opens anything by itself; a fetch failure simply leaves the
   * defaults (no release, prod, no project root).
   */
  configure(config: ICrashConsentConfig): void {
    this.release = config.release;
    this.environment = config.environment;
    this.projectRoot = config.projectRoot;
  }

  /** Roots handed to the scrubber; empty while the cwd never resolved. */
  private scrubRoots(): readonly string[] {
    return this.projectRoot === null ? [] : [this.projectRoot];
  }

  /**
   * Entry point for the `ErrorHandler`: maybe open the consent dialog for
   * this error. Suppressed wholesale in demo mode, while the DSN is
   * dormant, and for module-load failures (an environmental crash, not a
   * code defect); deduped per session; dropped while another dialog is
   * open.
   */
  offer(error: unknown): void {
    if (this.mode === 'demo' || !isUiDsnConfigured()) return;
    if (isModuleLoadFailure(error)) return;
    const key = crashKey(error);
    if (this.seen.has(key) || this.openSig()) return;
    this.seen.add(key);
    this.pendingError = error;
    this.previewSig.set(scrubString(summarize(error), this.scrubRoots()));
    this.openSig.set(true);
  }

  /**
   * The dialog's answer. On accept: arm the client late (idempotent, safe
   * after boot) and capture the pending error; scrubbing still runs in the
   * SDK `beforeSend`. On decline: drop it. Either way nothing is
   * persisted. Failures degrade to "not sent", never to a broken shell.
   */
  async resolve(send: boolean): Promise<void> {
    const error = this.pendingError;
    this.pendingError = null;
    this.openSig.set(false);
    if (!send || error === null) return;
    try {
      await initUiSentry({
        consentEnabled: true,
        release: this.release,
        environment: this.environment,
        projectRoot: this.projectRoot,
      });
      captureUiException(error);
    } catch {
      // Best-effort: a failed SDK load or send must never resurface.
    }
  }
}

/** Cap on the preview summary; the sent event is not truncated. */
const PREVIEW_CAP = 400;

/**
 * One-line human summary shown (scrubbed) inside the dialog. For a
 * non-`Error` rejection (e.g. an `HttpErrorResponse`), `String(error)`
 * would read `[object Object]` while the SENT event carries the fully
 * serialized object; previewing a truncated JSON projection instead
 * keeps the consent honest, the operator sees a representative slice of
 * what actually rides.
 */
function summarize(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error);
    if (typeof json === 'string') {
      return json.length > PREVIEW_CAP ? `${json.slice(0, PREVIEW_CAP)}...` : json;
    }
  } catch {
    // Circular / non-serializable: fall through to String().
  }
  return String(error);
}
