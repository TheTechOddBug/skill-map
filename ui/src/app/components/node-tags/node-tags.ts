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
 *   - EDIT (pencil clicked, or an auto-tag proposal landing): swaps the
 *     chips for the inline string-list editor (`<sm-input-type-control>`,
 *     add / remove chips) with Save / Cancel. Save dispatches the
 *     host-supplied `setTagsActionId` via `ActionDispatchService` (the
 *     same dispatch + `.sm` write-consent handshake every inspector
 *     action uses); the store updates through the BFF's WS broadcast, so
 *     there is no manual patch here. Cancel discards the draft.
 *
 * An auto-tag run's proposal has no surface of its own: it MANIFESTS as
 * this editor opening, pre-filled and unsaved (see `autoOpenOnProposal`).
 * There is no advisory line and no extra button to dismiss.
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
  untracked,
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

/**
 * Same tags, same order. The once-per-proposal guard's comparator: two
 * `job.completed` frames carrying the identical suggestion are ONE
 * proposal, however many arrays the transport built along the way.
 */
function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, i) => tag === b[i]);
}

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

  /**
   * The tags the last auto-tag run inferred (`job.completed`'s
   * `tagsProposed`), owned by the inspector host like `autoTagState` (it
   * is the terminal state of the same job the host submitted). A
   * PROPOSAL and nothing else: the tagger writes NO tags, so this is not
   * a pending change, not a refused one, just the model's suggestion.
   *
   * It is a TRIGGER, not something rendered: a non-empty value opens the
   * ORDINARY editor pre-filled and unsaved (`autoOpenOnProposal`), so the
   * operator prunes it and saves through the same `.sm` handshake every
   * other tag edit goes through. Tags are human curation, so the human
   * stays their author.
   */
  readonly autoTagProposedTags = input<readonly string[]>([]);

  /** Emitted when the user clicks the idle auto-tag (sparkles) button. */
  readonly autoTagClick = output<void>();

  /**
   * A save went through. The host owns the proposal (it owns the job
   * that produced it), so it is told the operator settled the tags by
   * hand and can retire the offer, instead of leaving a spent suggestion
   * hanging over a row that just wrote.
   */
  readonly tagsSaved = output<void>();

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

  /**
   * The last `autoTagProposedTags` value `autoOpenOnProposal` acted on,
   * the once-per-proposal guard. Keyed on CONTENT, not on the array
   * reference: the host builds a fresh array per `job.completed` frame,
   * so a frame the socket replays after a reconnect would otherwise read
   * as a second proposal and reopen an editor the operator just closed.
   * Retiring the proposal (the host sets `[]` on save, on node change,
   * and when it submits a new run) resets the key, which is what lets a
   * LATER run reopen the editor even when it infers the same tags.
   */
  private consumedProposal: readonly string[] | null = null;

  /** Descriptor handed to the inline `<sm-input-type-control>` editor. */
  protected readonly descriptor = computed<IInputTypeDescriptor>(() => ({
    inputType: 'string-list',
    label: this.texts.editorLabel,
    suggestions: this.allTags(),
  }));

  /**
   * A tagger run's proposal, made visible the only way that does not add
   * a surface: the editor OPENS on it, pre-filled with the current tags
   * plus the suggestion, deliberately UNSAVED. This is a review, not an
   * apply, the operator removes what they disagree with and hits Save,
   * which runs the ordinary dispatch and its `.sm` consent handshake. No
   * path here writes tags.
   *
   * Three behaviours worth naming:
   *
   *   - ONCE PER PROPOSAL. The proposal input is the effect's ONLY
   *     tracked dependency (everything else is read `untracked`), so a
   *     re-render, a scan refresh that re-binds the tags, or any
   *     unrelated change detection cannot reopen an editor the operator
   *     already closed or saved. `consumedProposal` covers the case the
   *     dependency graph cannot: the same proposal arriving a second time
   *     in a new array, which is what a replayed `job.completed` frame
   *     looks like after a socket reconnect.
   *   - NEVER CLOBBERS WORK IN PROGRESS. With the editor already open the
   *     proposal merges into the live draft; a closed editor seeds from
   *     the node's current tags. Either way duplicates are skipped and
   *     existing entries keep their position.
   *   - AN EMPTY PROPOSAL IS SILENT. "The tagger looked and found
   *     nothing" opens nothing and clears no draft; it only marks itself
   *     consumed. Same for the empty default and for the host retiring a
   *     spent proposal, and that retirement is exactly what re-arms the
   *     guard for the next run.
   */
  private readonly autoOpenOnProposal = effect(() => {
    const proposed = this.autoTagProposedTags();
    if (this.consumedProposal !== null && sameTags(this.consumedProposal, proposed)) return;
    this.consumedProposal = proposed;
    if (proposed.length === 0) return;
    untracked(() => {
      const seed = this.editingSig() ? [...this.draftSig()] : [...this.tags()];
      for (const tag of proposed) {
        if (!seed.includes(tag)) seed.push(tag);
      }
      this.openEditor(seed);
    });
  });

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
    this.openEditor([...this.tags()]);
  }

  /**
   * Shared entry into edit mode, the ONE way in: the pencil and the
   * auto-tag proposal both land here, they only differ in the seed.
   */
  private openEditor(seed: string[]): void {
    this.errorSig.set(null);
    this.draftSig.set(seed);
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
   * gate) we leave edit mode and tell the host the tags were settled by
   * hand (`tagsSaved`, which retires any pending auto-tag proposal); the
   * store refreshes via the WS broadcast. On a real failure we surface
   * the error and stay in edit mode so the draft is not lost.
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
      this.tagsSaved.emit();
    } finally {
      this.inFlightSig.set(false);
    }
  }

  protected dismissError(): void {
    this.errorSig.set(null);
    this.dispatcher.dismissError();
  }
}
