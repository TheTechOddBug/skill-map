/**
 * "Files follows the map selection" preference. When enabled, selecting a
 * node on the map (which writes the shared `?path` query param) reveals the
 * same file in the files rail: highlights its row, auto-expands its ancestor
 * folders, and scrolls it into view. Off by default, so the rail behaves
 * exactly as before until the operator opts in via the rail toggle.
 *
 * A persisted preference, not a filter: it lives in its own root service
 * (both the workspace toggle and the files view read it) and is never
 * touched by `FilterStoreService.reset()`. Mirrors the `searchAffectsMap`
 * pattern (signal seeded from storage, `toggle()` flips + persists).
 */

import { Injectable, signal } from '@angular/core';

import {
  readStoredFilesFollowSelection,
  writeStoredFilesFollowSelection,
} from './files-follow-selection.storage';

@Injectable({ providedIn: 'root' })
export class FilesFollowSelectionService {
  private readonly _enabled = signal<boolean>(readStoredFilesFollowSelection());

  /** Whether selecting a node reveals it in the files rail. */
  readonly enabled = this._enabled.asReadonly();

  /** Flip the preference and persist the choice. */
  toggle(): void {
    const next = !this._enabled();
    this._enabled.set(next);
    writeStoredFilesFollowSelection(next);
  }
}
