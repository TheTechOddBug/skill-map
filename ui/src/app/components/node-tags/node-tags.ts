/**
 * `<sm-node-tags>`, the inspector's inline tag row.
 *
 * Owns the whole tag concern for the inspected node, split in two modes:
 *
 *   - VIEW (default): renders the node's effective `annotations.tags` as
 *     clickable filter chips (clicking one emits `tagClick`, which the
 *     host forwards to the graph's tag-selection) plus a pencil
 *     affordance. The pencil is ALWAYS present, even when the node has no
 *     tags, so the first tag can be added.
 *   - EDIT (pencil clicked): swaps the chips for the inline string-list
 *     editor (`<sm-input-type-control>`, add / remove chips) with Save /
 *     Cancel. Save dispatches the host-supplied `setTagsActionId` via
 *     `ActionDispatchService` (the same dispatch + `.sm`
 *     write-consent handshake every inspector action uses); the store
 *     updates through the BFF's WS broadcast, so there is no manual patch
 *     here. Cancel discards the draft.
 *
 * This component is the reason the action no longer self-projects an
 * `inspector.action.button`: tag editing lives where the tags are shown,
 * not in a separate button. The header stays a pure read-only identity
 * block and only forwards `tagClick` upward; the write path lives here.
 *
 * The editor widget is mounted behind a `@defer` so the heavy PrimeNG
 * AutoComplete chunk (pulled in by `<sm-input-type-control>`) is
 * code-split and only loaded the first time the pencil is clicked, the
 * same pattern `<sm-node-action-button>` uses for its prompt dialog.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { effectiveUserTags } from '../../../models/node-derived';
import { ProcessingAgentReadinessService } from '../../services/processing-agent-readiness';
import { DebugSurface } from '../../slots/debug-surface.directive';
import { ActionDispatchService } from '../../../services/action-dispatch';
import { CollectionLoaderService } from '../../../services/collection-loader';
import {
  InputTypeControl,
  type IInputTypeDescriptor,
  type TInputTypeValue,
} from '../../renderers/input-type-control/input-type-control';
import { NODE_TAGS_TEXTS } from '../../../i18n/node-tags.texts';

@Component({
  selector: 'sm-node-tags',
  imports: [
    DebugSurface,ButtonModule, TooltipModule, InputTypeControl],
  templateUrl: './node-tags.html',
  styleUrl: './node-tags.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NodeTags {
  /** The node's effective `annotations.tags` (sidecar-wins, see node-derived). */
  readonly tags = input.required<readonly string[]>();
  /** Tag currently driving the map's tag-selection; highlights its chip. */
  readonly activeTag = input<string | null>(null);
  /** The node's relative path, the dispatch target for the set-tags action. */
  readonly nodePath = input.required<string>();

  /**
   * Qualified id of the Action the Save button dispatches, sourced by
   * the host from the contribution claiming the TAGS surface
   * (`spec/view-slots.md` §Re-homed surfaces). The component never
   * hardcodes an extension id: whichever plugin claims the surface owns
   * the write.
   */
  readonly setTagsActionId = input.required<string>();

  /**
   * Auto-tag affordance state (user request 2026-07-21), owned by the
   * inspector host like the header's summary machine: `hidden` (the
   * `core/ai-tagger-action` extension is unavailable), `idle` (clickable,
   * queues a run), `queued` / `running` (job in flight). There is no
   * `ready` state: the inferred tags land in the sidecar through the
   * record-side write-through and simply show up as chips.
   */
  readonly autoTagState = input<'hidden' | 'idle' | 'queued' | 'running'>('hidden');

  /** Emitted when the user clicks the idle auto-tag (sparkles) button. */
  readonly autoTagClick = output<void>();

  /**
   * Emitted when the user clicks a tag chip in VIEW mode. Carries the tag
   * string; the host forwards it to the graph's tag-selection. Edit mode
   * never emits this (its chips are remove affordances, not filters).
   */
  readonly tagClick = output<string>();

  protected readonly texts = NODE_TAGS_TEXTS;

  private readonly dispatcher = inject(ActionDispatchService);
  private readonly loader = inject(CollectionLoaderService);
  private readonly processingAgent = inject(ProcessingAgentReadinessService);

  /**
   * The shared submit gate: nothing can drain the queue right now (the
   * lens's processing skill is missing, or no agent is attached to the
   * MCP server), so the auto-tag button (whose every click enqueues a
   * job) sits disabled instead of dead-ending. Only CONFIRMED readings
   * close it (`null` = unknown fails OPEN).
   */
  protected readonly submitGateClosed = this.processingAgent.submitGateClosed;

  /**
   * The project's live tag vocabulary: every tag currently present on any
   * scanned node, deduped and sorted. Fed to the editor as typeahead
   * suggestions so the user reuses existing tags instead of creating near
   * duplicates. Because it derives from the loader's `nodes()` signal
   * (refreshed on `scan.completed`), a tag whose last occurrence is removed
   * drops out of the suggestions automatically, no separate cleanup needed.
   */
  protected readonly allTags = computed<string[]>(() => {
    const seen = new Set<string>();
    for (const node of this.loader.nodes()) {
      for (const tag of effectiveUserTags(node)) seen.add(tag);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  });

  private readonly editingSig = signal<boolean>(false);
  private readonly draftSig = signal<string[]>([]);
  private readonly inFlightSig = signal<boolean>(false);
  private readonly errorSig = signal<string | null>(null);

  protected readonly editing = this.editingSig.asReadonly();
  protected readonly draft = this.draftSig.asReadonly();
  protected readonly inFlight = this.inFlightSig.asReadonly();
  protected readonly error = this.errorSig.asReadonly();

  /**
   * Switching the inspected node reuses this component instance (the
   * inspector only re-binds the inputs), so a node change must drop any
   * open editor and its error, otherwise the previous node's editor stays
   * open over the newly selected node. Keyed on `nodePath()`, which is
   * unique per node; the draft is reseeded on the next `startEdit()`.
   */
  private readonly resetOnNodeChange = effect(() => {
    this.nodePath(); // track the active node
    this.editingSig.set(false);
    this.errorSig.set(null);
  });

  /** Descriptor handed to the inline `<sm-input-type-control>` editor. */
  protected readonly descriptor = computed<IInputTypeDescriptor>(() => ({
    inputType: 'string-list',
    label: this.texts.editorLabel,
    suggestions: this.allTags(),
  }));

  /** Pencil tooltip / aria: "Add tags" when empty, else "Edit tags". */
  protected readonly editTooltip = computed<string>(() =>
    this.tags().length === 0 ? this.texts.addTooltip : this.texts.editTooltip,
  );

  /** Auto-tag button tooltip / aria, per host-owned state (gate wins). */
  protected readonly autoTagTooltip = computed<string>(() => {
    // Name WHICH half is missing: installing the skill and starting the
    // agent are different actions for the operator.
    const reason = this.processingAgent.submitGateReason();
    if (reason === 'mcp-disconnected') return this.texts.autoTag.tooltipNoMcp;
    if (reason !== null) return this.texts.autoTag.tooltipNoAgent;
    switch (this.autoTagState()) {
      case 'queued':
        return this.texts.autoTag.tooltipQueued;
      case 'running':
        return this.texts.autoTag.tooltipRunning;
      default:
        return this.texts.autoTag.tooltipIdle;
    }
  });

  /** Busy (host-owned state) or gated (no agent to drain the queue). */
  protected readonly autoTagDisabled = computed<boolean>(() => {
    const state = this.autoTagState();
    return state === 'queued' || state === 'running' || this.submitGateClosed();
  });

  protected onAutoTagClick(): void {
    if (this.autoTagState() !== 'idle' || this.submitGateClosed()) return;
    this.autoTagClick.emit();
  }

  protected isActive(tag: string): boolean {
    return this.activeTag() === tag;
  }

  protected onChipClick(tag: string): void {
    this.tagClick.emit(tag);
  }

  /** Enter edit mode, seeding the draft with the current tags. */
  protected startEdit(): void {
    this.errorSig.set(null);
    this.draftSig.set([...this.tags()]);
    this.editingSig.set(true);
  }

  /** Leave edit mode, discarding the draft. */
  protected cancelEdit(): void {
    this.editingSig.set(false);
  }

  protected onDraftChange(next: TInputTypeValue): void {
    this.draftSig.set(
      Array.isArray(next) ? next.filter((t): t is string => typeof t === 'string') : [],
    );
  }

  /**
   * Dispatch the new tags. On success (and on a silently-declined consent
   * gate) we leave edit mode; the store refreshes via the WS broadcast. On
   * a real failure we surface the error and stay in edit mode so the draft
   * is not lost.
   */
  protected async save(): Promise<void> {
    const path = this.nodePath();
    if (!path || this.inFlightSig()) return;
    this.errorSig.set(null);
    this.inFlightSig.set(true);
    try {
      await this.dispatcher.dispatch(this.setTagsActionId(), path, { tags: this.draftSig() });
      const err = this.dispatcher.error();
      if (err) {
        this.errorSig.set(err);
        return;
      }
      this.editingSig.set(false);
    } finally {
      this.inFlightSig.set(false);
    }
  }

  protected dismissError(): void {
    this.errorSig.set(null);
    this.dispatcher.dismissError();
  }
}
