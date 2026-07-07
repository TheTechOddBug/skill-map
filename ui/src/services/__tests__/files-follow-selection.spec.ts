/**
 * Coverage for `FilesFollowSelectionService`: the persisted "files follows
 * the map selection" preference behind the rail's directions-icon toggle.
 * Pins the default (OFF) and the toggle/persist contract the workspace
 * rail and the files view rely on.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import { FilesFollowSelectionService } from '../files-follow-selection';

const FILES_FOLLOW_SELECTION_KEY = 'sm.workspace.files-follow-selection';

describe('FilesFollowSelectionService', () => {
  let service: FilesFollowSelectionService;

  beforeEach(() => {
    localStorage.removeItem(FILES_FOLLOW_SELECTION_KEY);
    TestBed.configureTestingModule({});
    service = TestBed.inject(FilesFollowSelectionService);
  });

  it('defaults to false (the rail ignores the map selection)', () => {
    expect(service.enabled()).toBe(false);
  });

  it('toggle() flips the signal and persists the choice', () => {
    service.toggle();
    expect(service.enabled()).toBe(true);
    expect(localStorage.getItem(FILES_FOLLOW_SELECTION_KEY)).toBe('1');
    service.toggle();
    expect(service.enabled()).toBe(false);
    expect(localStorage.getItem(FILES_FOLLOW_SELECTION_KEY)).toBe('0');
  });

  it('seeds the signal from a persisted preference', () => {
    localStorage.setItem(FILES_FOLLOW_SELECTION_KEY, '1');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const seeded = TestBed.inject(FilesFollowSelectionService);
    expect(seeded.enabled()).toBe(true);
  });
});
