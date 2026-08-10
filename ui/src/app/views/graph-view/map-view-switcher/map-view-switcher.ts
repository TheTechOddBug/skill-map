/**
 * `<sm-map-view-switcher>`, the map-views control in the graph view's
 * bottom toolbar (`spec/map-views.md`): a compact trigger showing the
 * active view's name (or the neutral "Views" label) plus a dirty dot,
 * and a popover listing every committed view with per-row dead-ref
 * badges and delete, a Save / Save-as / Exit footer, and the
 * dirty-switch confirmation dialog.
 *
 * State lives in `MapViewsService` (domain layer); this component owns
 * only popover mechanics and the save-as input's two-step overwrite
 * confirmation (a slug collision flips the button into an explicit
 * overwrite wording, never a silent replace). Broken-ref counts are
 * computed against the corpus path set the graph already loads
 * (`CollectionLoaderService.liteNodes`, the same set the visibility
 * prune uses).
 *
 * Hidden entirely in demo mode (`available()`), same idiom as
 * `ProjectIgnoreService`. The files-rail provenance chip re-opens this
 * popover through `MapViewsService.requestOpenSwitcher()` (a tick
 * signal), so the rail never imports graph-view code.
 */

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CdkDrag, CdkDropList, moveItemInArray, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { Popover, PopoverModule } from 'primeng/popover';
import { TooltipModule } from 'primeng/tooltip';

import { MAP_VIEWS_TEXTS } from '../../../../i18n/map-views.texts';
import { CollectionLoaderService } from '../../../../services/collection-loader';
import { MapViewsService } from '../../../../services/map-views';
import { brokenRefCount, slugify } from '../../../../services/map-views.model';
import type { IMapViewEntryApi } from '../../../../models/api';
import type { IMapViewSwitchDecision } from '../../../../services/map-views';
import { MapViewConfirmDialog } from './map-view-confirm-dialog';

@Component({
  selector: 'sm-map-view-switcher',
  imports: [
    ButtonModule,
    CdkDrag,
    CdkDropList,
    InputTextModule,
    PopoverModule,
    TooltipModule,
    MapViewConfirmDialog,
  ],
  templateUrl: './map-view-switcher.html',
  styleUrl: './map-view-switcher.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
})
export class MapViewSwitcher {
  protected readonly mapViews = inject(MapViewsService);
  private readonly loader = inject(CollectionLoaderService);

  protected readonly texts = MAP_VIEWS_TEXTS;

  private readonly popover = viewChild<Popover>('switcherPopover');
  private readonly trigger = viewChild('switcherTrigger', { read: ElementRef });

  /** Save-as input value. */
  protected readonly saveAsName = signal('');
  /**
   * Two-step overwrite confirmation: true after a submit whose derived
   * slug collides with an existing view. The next submit overwrites;
   * any name edit re-arms.
   */
  protected readonly saveAsPendingOverwrite = signal(false);
  /** A write is in flight; the footer buttons disable. */
  protected readonly busy = signal(false);

  /**
   * Corpus path set for the dead-ref counts, the same LITE node set the
   * visibility prune keys on (corpus-wide, not the rendered branch).
   */
  private readonly corpusPaths = computed(
    () => new Set(this.loader.liteNodes().map((n) => n.path)),
  );

  protected readonly triggerLabel = computed(
    () => this.mapViews.activeView()?.view.name ?? this.texts.trigger,
  );

  protected readonly triggerAria = computed(() => {
    const active = this.mapViews.activeView();
    return active === null
      ? this.texts.triggerAriaNeutral
      : this.texts.triggerAriaActive(active.view.name);
  });

  protected readonly saveAsLabel = computed(() =>
    this.saveAsPendingOverwrite() ? this.texts.saveAsOverwrite : this.texts.saveAs,
  );

  constructor() {
    // Files-rail chip intent: open the popover anchored to the trigger.
    effect(() => {
      const tick = this.mapViews.openSwitcherTick();
      if (tick === 0) return;
      untracked(() => this.openFromIntent());
    });
    // Eager list load: the digit shortcuts below act on the view list,
    // so it cannot stay popover-lazy (a shortcut pressed before ever
    // opening the popover would hit an empty list). One small GET; the
    // demo/static source answers it with an empty envelope.
    if (this.mapViews.available()) void this.mapViews.loadViews();
  }

  /**
   * Digit shortcuts, wave-1 probe: keys 1-9 apply the Nth view of the
   * list in its IMPLICIT order (the slug-sorted list the popover
   * renders). Deliberately invisible for now; the follow-up feature
   * assigns explicit per-view numbers through a textbox on each row,
   * replacing the index mapping with the stored assignment.
   *
   * Guards, in order: feature hidden (demo), IME composition, held
   * modifiers (browser and OS chords stay untouched), key auto-repeat,
   * non-digit keys, typing surfaces (inputs, textareas, selects,
   * contenteditable), and an open dirty-switch dialog (digits must not
   * switch views underneath the pending decision). The switch itself
   * goes through `requestApply`, so the dirty gate applies exactly as
   * it does for a popover row click.
   */
  protected onDocumentKeydown(event: KeyboardEvent): void {
    if (!this.mapViews.available()) return;
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.repeat) return;
    if (event.key < '1' || event.key > '9' || event.key.length !== 1) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest('input, textarea, select, [contenteditable]') !== null
    ) {
      return;
    }
    if (this.mapViews.pendingSwitch() !== null) return;
    const entry = this.mapViews.views()[Number.parseInt(event.key, 10) - 1];
    if (entry === undefined) return;
    event.preventDefault();
    void this.mapViews.requestApply(entry.slug);
  }

  protected brokenRefs(entry: IMapViewEntryApi): number {
    return brokenRefCount(entry.view, this.corpusPaths());
  }

  protected onTriggerClick(event: Event): void {
    void this.mapViews.loadViews();
    this.popover()?.toggle(event);
  }

  private openFromIntent(): void {
    const el = this.trigger()?.nativeElement as HTMLElement | undefined;
    const popover = this.popover();
    if (el === undefined || popover === undefined) return;
    void this.mapViews.loadViews();
    popover.show(new MouseEvent('click'), el);
  }

  /**
   * Row click: guarded apply. The popover closes either way; when the
   * dirty gate answers `'dialog'` the confirmation takes over on top.
   */
  protected onApply(slug: string): void {
    this.popover()?.hide();
    void this.mapViews.requestApply(slug);
  }

  protected onExit(): void {
    this.popover()?.hide();
    void this.mapViews.requestExit();
  }

  protected onDelete(slug: string, event: Event): void {
    // The delete button nests inside the row's apply target; a delete
    // must not read as an apply.
    event.stopPropagation();
    void this.runBusy(() => this.mapViews.deleteView(slug));
  }

  protected onSave(): void {
    void this.runBusy(() => this.mapViews.saveActive());
  }

  /** Discard the divergence: restore the active view as saved. */
  protected onRevert(): void {
    this.mapViews.revert();
  }

  /**
   * Drag settled: persist the new shared sequence. The service
   * re-sorts optimistically, renumbers 1..N, and re-PUTs only the
   * views whose stored order changed.
   */
  protected onReordered(event: CdkDragDrop<unknown>): void {
    if (event.previousIndex === event.currentIndex) return;
    const slugs = this.mapViews.views().map((entry) => entry.slug);
    moveItemInArray(slugs, event.previousIndex, event.currentIndex);
    void this.runBusy(() => this.mapViews.reorder(slugs));
  }

  protected onSaveAsNameChange(value: string): void {
    this.saveAsName.set(value);
    // Any edit re-arms the overwrite confirmation: the collision the
    // pending state was about may no longer exist.
    this.saveAsPendingOverwrite.set(false);
  }

  /**
   * Save-as submit. A slug collision with an existing view requires an
   * explicit second submit while the button carries the overwrite
   * wording; a silent replace is never allowed.
   */
  protected onSaveAsSubmit(): void {
    const name = this.saveAsName().trim();
    const slug = slugify(name);
    if (name.length === 0 || slug.length === 0) return;
    const collides = this.mapViews.views().some((entry) => entry.slug === slug);
    if (collides && !this.saveAsPendingOverwrite()) {
      this.saveAsPendingOverwrite.set(true);
      return;
    }
    void this.runBusy(async () => {
      const ok = await this.mapViews.saveAs(name);
      if (ok) {
        this.saveAsName.set('');
        this.saveAsPendingOverwrite.set(false);
      }
      return ok;
    });
  }

  protected onConfirmDecision(decision: IMapViewSwitchDecision): void {
    void this.mapViews.resolveSwitch(decision);
  }

  private async runBusy(work: () => Promise<boolean>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await work();
    } finally {
      this.busy.set(false);
    }
  }
}
