/**
 * `ProjectIgnoreService`, the owner of the "Ignore this path" gesture:
 * appending a pattern to the project-root `.skillmapignore` from the
 * files rail's file / folder rows and the inspector header, behind a
 * confirmation dialog with a persisted don't-ask-again
 * (`ui.confirmIgnore`, project-local, `spec/cli-contract.md`
 * §PATCH /api/project-ignore).
 *
 * Placement: `ui/src/services/` (domain layer): it talks to the BFF
 * through `DATA_SOURCE` only, no router / DOM dependency. Plain
 * `inject(DATA_SOURCE)` is safe here: the NG0200 boot cycle that
 * forces `LivePreferencesService` onto a lazy `Injector` runs through
 * `WsEventStreamService`, which never touches this service.
 *
 * Deliberately TELEMETRY-FREE: the service returns a disposition
 * (`TIgnoreRequestOutcome`) and the app-layer call sites plus the
 * dialog own the `ui.feature.ignore-path` emits, so the domain layer
 * never imports `app/services`.
 *
 * Write mechanics: `PATCH /api/project-ignore` is replace-list, so
 * every write is a fresh read-modify-write (a concurrent Settings-
 * editor add is never dropped) and overlapping writes serialize on a
 * promise chain (two rapid ignores would otherwise both extend the
 * same stale list and the second would drop the first). On success
 * the ROUTE restarts the watcher and its initial-batch re-scan
 * removes the node / subtree from map + list; no client-side refresh
 * is needed here.
 *
 * A pattern already present resolves as `'duplicate'`: silent
 * success, no dialog, no PATCH. The state the user asked for already
 * holds; an error would scold a no-op and a confirm would confirm
 * nothing.
 *
 * Demo mode (`SKILL_MAP_MODE === 'demo'`) reports `available() ===
 * false` (the static source rejects `setProjectIgnore` with
 * `demo-readonly`), so the buttons hide instead of failing.
 */

import { Injectable, computed, inject, signal } from '@angular/core';

import { DATA_SOURCE, DataSourceError } from './data-source/data-source.port';
import { SKILL_MAP_MODE } from './data-source/runtime-mode';

export type TIgnoreKind = 'file' | 'folder';
export type TIgnoreSource = 'files' | 'inspector';

/**
 * How a `requestIgnore` gesture resolved:
 *   - `dialog`: the confirmation dialog opened; the write happens (or
 *     not) through `resolveDecision`.
 *   - `auto`: confirmation is suppressed (`ui.confirmIgnore` false),
 *     the write was enqueued directly. Call sites emit the `auto`
 *     telemetry on this outcome.
 *   - `duplicate`: the pattern is already in `.skillmapignore`;
 *     nothing to do.
 *   - `unavailable`: demo mode, the gesture is inert.
 */
export type TIgnoreRequestOutcome = 'dialog' | 'auto' | 'duplicate' | 'unavailable';

/** What the open dialog is about; rendered in its header / body. */
export interface IIgnoreTarget {
  /** Root-relative path as clicked, no leading slash. */
  path: string;
  kind: TIgnoreKind;
  /** Which surface asked; stamped on the dialog's telemetry. */
  source: TIgnoreSource;
  /** The exact line an accept appends, shown verbatim in the dialog. */
  pattern: string;
}

/** The dialog's answer. */
export interface IIgnoreConfirmDecision {
  accepted: boolean;
  /** True when don't-ask-again was ticked; persists `ui.confirmIgnore: false`. */
  always: boolean;
}

/**
 * Root-anchored gitignore pattern for the clicked row: `/docs/notes.md`
 * for a file, `/docs/guides/` for a folder. The leading slash anchors a
 * single-segment name (`README.md` would otherwise match at any depth);
 * the trailing slash scopes a folder pattern to directories.
 */
export function toIgnorePattern(path: string, kind: TIgnoreKind): string {
  const anchored = path.startsWith('/') ? path : `/${path}`;
  if (kind === 'file') return anchored;
  return anchored.endsWith('/') ? anchored : `${anchored}/`;
}

@Injectable({ providedIn: 'root' })
export class ProjectIgnoreService {
  private readonly dataSource = inject(DATA_SOURCE);
  private readonly mode = inject(SKILL_MAP_MODE);

  /** False in demo mode: the static source cannot write, buttons hide. */
  readonly available = computed(() => this.mode !== 'demo');

  private readonly _dialogOpen = signal(false);
  /** Drives the shell-mounted `<sm-ignore-confirm-dialog>` visibility. */
  readonly dialogOpen = this._dialogOpen.asReadonly();

  private readonly _dialogTarget = signal<IIgnoreTarget | null>(null);
  /** The path the open dialog is about; `null` while closed. */
  readonly dialogTarget = this._dialogTarget.asReadonly();

  private readonly _errorText = signal<string | null>(null);
  /** Last write failure, surfaced as a closable message in the files rail. */
  readonly errorText = this._errorText.asReadonly();

  /**
   * Cached `ui.confirmIgnore`; `null` until the first gesture fetches
   * it. A fetch failure defaults to `true`: asking is the safe default.
   */
  private readonly confirmPref = signal<boolean | null>(null);

  /**
   * Write serializer: each accepted / auto write links onto the tail so
   * read-modify-write cycles never interleave (the replace-list PATCH
   * would drop the earlier append otherwise). Failures are captured
   * per-link into `errorText`, so the chain itself never rejects.
   */
  private writeChain: Promise<void> = Promise.resolve();

  /**
   * Entry point for the Ignore buttons. Opens the dialog (or writes
   * directly while suppressed) for `path`; see `TIgnoreRequestOutcome`.
   */
  async requestIgnore(
    path: string,
    kind: TIgnoreKind,
    source: TIgnoreSource,
  ): Promise<TIgnoreRequestOutcome> {
    if (!this.available()) return 'unavailable';
    this._errorText.set(null);
    const pattern = toIgnorePattern(path, kind);

    if (this.confirmPref() === null) {
      try {
        const prefs = await this.dataSource.getProjectPreferences();
        // `?? true` also tolerates an older BFF envelope without the key.
        this.confirmPref.set(prefs.ui?.confirmIgnore ?? true);
      } catch {
        this.confirmPref.set(true);
      }
    }

    try {
      const envelope = await this.dataSource.getProjectIgnore();
      if (envelope.patterns.includes(pattern)) return 'duplicate';
    } catch {
      // Unreadable list: fall through and let the write path surface
      // the real failure (or succeed against the server's own read).
    }

    const target: IIgnoreTarget = { path, kind, source, pattern };
    if (this.confirmPref() === false) {
      this.enqueueWrite(target);
      return 'auto';
    }

    this._dialogTarget.set(target);
    this._dialogOpen.set(true);
    return 'dialog';
  }

  /**
   * The dialog's answer. Structural dedupe: the decline path can fire
   * twice (explicit button, then the close-driven `visibleChange`), so
   * everything bails once the target is consumed.
   */
  resolveDecision(decision: IIgnoreConfirmDecision): void {
    const target = this._dialogTarget();
    if (!this._dialogOpen() || target === null) return;
    this._dialogOpen.set(false);
    this._dialogTarget.set(null);
    if (!decision.accepted) return;
    if (decision.always) {
      this.confirmPref.set(false);
      // Fire-and-forget: a failed suppression persist only means the
      // dialog asks again next session, benign (the tutorial-reminder
      // banner takes the same posture).
      void this.dataSource
        .setProjectPreferences({ ui: { confirmIgnore: false } })
        .catch(() => {});
    }
    this.enqueueWrite(target);
  }

  /** Clear the surfaced write failure (the message's close button). */
  clearError(): void {
    this._errorText.set(null);
  }

  private enqueueWrite(target: IIgnoreTarget): void {
    this.writeChain = this.writeChain.then(() => this.performWrite(target));
  }

  private async performWrite(target: IIgnoreTarget): Promise<void> {
    try {
      // Fresh read inside the chain link: a concurrent Settings-editor
      // add (or an earlier link's append) is folded in, never dropped.
      const envelope = await this.dataSource.getProjectIgnore();
      if (envelope.patterns.includes(target.pattern)) return;
      await this.dataSource.setProjectIgnore({
        patterns: [...envelope.patterns, target.pattern],
      });
    } catch (err) {
      this._errorText.set(formatIgnoreError(err));
    }
  }
}

/**
 * Local mirror of the settings-modal `formatErr` helper: the domain
 * layer must not import from `app/components`, and the three-branch
 * shape is too small to justify a shared module.
 */
function formatIgnoreError(err: unknown): string {
  if (err instanceof DataSourceError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
