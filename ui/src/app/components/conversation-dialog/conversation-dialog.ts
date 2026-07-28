/**
 * `<sm-conversation-dialog>`, viewer for one inter-agent conversation
 * THREAD (`spec/provider-activity.md` §Conversation capture): every
 * turn of a parent-child pair, grouped by `groupSpawnThreads`, rendered
 * chronologically as chat bubbles (parent prompt right / tinted, child
 * response left).
 *
 * Presentational, mirroring `<sm-sidecar-consent-dialog>`: driven by
 * the `open` input, fed an already-built `thread` (the inspector
 * groups the rows of its Activity detail; the graph view builds the
 * thread from `getSpawnRecord` + `getNodeActivity` on spawn-edge
 * click), and reports closure through the `closed` output. It owns no
 * fetch logic.
 *
 * Content: every `prompt` / `response` message renders through
 * `MarkdownRenderer.render()` into `[innerHTML]` (trusted local
 * content, markdown-it `html: false` + DOMPurify, same posture as the
 * inspector Body section), guarded by a supersession token so a newer
 * thread swap drops any in-flight render. Two explanatory notes cover
 * the metadata-only shapes: capture gate off, and a turn whose
 * response is still missing (the child is running; its final report
 * attaches from its stop event).
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
import type { SafeHtml } from '@angular/platform-browser';
import { DialogModule } from 'primeng/dialog';

import { CONVERSATION_DIALOG_TEXTS } from '../../../i18n/conversation-dialog.texts';
import type { IActivitySpawnRecordApi } from '../../../models/api';
import { compactNumber } from '../../../models/node-derived';
import { MarkdownRenderer } from '../../../services/markdown-renderer';
import { pathBasenameForLink } from '../../../services/path-basename';
import type { ISpawnThread } from './spawn-thread';

@Component({
  selector: 'sm-conversation-dialog',
  imports: [DialogModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p-dialog
      [visible]="open()"
      (visibleChange)="onVisibleChange($event)"
      [modal]="true"
      [closable]="true"
      [draggable]="false"
      [resizable]="false"
      [dismissableMask]="true"
      appendTo="body"
      [header]="headerText()"
      [style]="{ width: '44rem' }"
      contentStyleClass="convo__scroll"
      [attr.aria-label]="texts.ariaLabel"
      data-testid="conversation-dialog"
    >
      @if (thread(); as t) {
        <div class="convo__meta" data-testid="conversation-dialog-meta">
          <span class="convo__meta-line">{{ parentLine() }}</span>
          <!-- An empty-records thread (historical edge click with the
               capture gate off) carries pair naming but no owner; the
               owner line only renders when there is one to show. -->
          @if (t.parentOwner) {
            <span class="convo__meta-line convo__meta-line--dim">
              {{ texts.ownerPrefix }} <code>{{ t.parentOwner }}</code>
              @if (childOwner(); as owner) {
                · {{ texts.childOwnerPrefix }} <code>{{ owner }}</code>
              }
            </span>
          }
        </div>

        @if (!captureEnabled()) {
          <p class="convo__note" data-testid="conversation-dialog-capture-off">
            {{ texts.captureOffNote }}
          </p>
        } @else if (t.records.length === 0) {
          <!-- Capture is ON but nothing is retained for this pair yet
               (server restart dropped the ring, or the pair has not
               spawned since the gate flipped): name the blank instead
               of an empty dialog body. -->
          <p class="convo__note" data-testid="conversation-dialog-empty-thread">
            {{ texts.emptyThreadNote }}
          </p>
        }

        <div class="convo__thread">
          @for (r of t.records; track r.spawnId; let i = $index) {
            <div class="convo__turn" [attr.data-testid]="'conversation-dialog-turn-' + i">
              <!-- No ordinal label: the bubbles already separate turns
                   visually, so the head is just the status + times. -->
              <!-- The optional execution trio (duration · tools · tokens)
                   rides the same right-aligned meta line; sync-only, a
                   turn without a summary keeps the plain head. Every
                   timestamp is gated on a finite number: a record that
                   arrives without one must not render "Invalid Date". -->
              <div class="convo__turn-head">
                <span class="convo__turn-meta">
                  {{ r.status }}@if (hasTime(r.startedAt)) {&nbsp;· {{ formatTime(r.startedAt) }}}@if (hasTime(r.endedAt)) {&nbsp;- {{ formatTime(r.endedAt) }}}@if (turnExecutionSummary(r); as summary) {&nbsp;· {{ summary }}}
                </span>
              </div>
              @if (r.prompt) {
                <!-- SafeHtml from MarkdownRenderer.render(): markdown-it
                     with html:false + DOMPurify, same two sanitization
                     lines as the inspector body. -->
                <div
                  class="convo__bubble convo__bubble--parent"
                  [attr.data-testid]="'conversation-dialog-prompt-' + i"
                  [attr.aria-label]="texts.promptLabel"
                  [innerHTML]="htmlFor(r.spawnId, 'prompt')"
                ></div>
              }
              @if (r.response) {
                <div
                  class="convo__bubble convo__bubble--child"
                  [attr.data-testid]="'conversation-dialog-response-' + i"
                  [attr.aria-label]="texts.responseLabel"
                  [innerHTML]="htmlFor(r.spawnId, 'response')"
                ></div>
              } @else if (captureEnabled() && r.prompt) {
                <p
                  class="convo__note convo__note--turn"
                  [attr.data-testid]="'conversation-dialog-async-note-' + i"
                >
                  {{ texts.asyncGapNote }}
                </p>
              }
            </div>
          }
        </div>
      }
    </p-dialog>
  `,
  styles: [
    `
      .convo__meta { display: flex; flex-direction: column; gap: 0.2rem;
        margin: 0 0 0.9rem; }
      .convo__meta-line { font-size: var(--sm-fs-md); color: var(--p-text-color); }
      .convo__meta-line--dim { font-size: var(--sm-fs-sm);
        color: var(--p-text-muted-color); }
      .convo__meta-line code { font-family: var(--sm-font-mono);
        font-size: var(--sm-fs-xs); }
      .convo__thread { display: flex; flex-direction: column; gap: 0.9rem; }
      .convo__turn { display: flex; flex-direction: column; gap: 0.35rem; }
      .convo__turn-head { display: flex; justify-content: flex-end;
        align-items: baseline; gap: 0.5rem; }
      .convo__turn-meta { font-size: var(--sm-fs-xs);
        color: var(--p-text-muted-color); }
      .convo__bubble { max-width: 88%; padding: 0.6rem 0.75rem;
        border: 1px solid var(--sm-border);
        border-radius: var(--sm-radius-sm);
        font-size: var(--sm-fs-md); line-height: 1.5; overflow-wrap: anywhere; }
      /* Parent (the asker) sits right with a subtle primary tint; the
         child's reply sits left on the plain page surface. Bare theme
         tokens only, so every theme retints the pair automatically. */
      .convo__bubble--parent { align-self: flex-end;
        background: color-mix(in srgb, var(--p-primary-color) 8%, var(--sm-bg-page)); }
      .convo__bubble--child { align-self: flex-start;
        background: var(--sm-bg-page); }
      .convo__note { margin: 0.75rem 0 0; font-size: var(--sm-fs-sm);
        font-style: italic; color: var(--p-text-muted-color); }
      .convo__note--turn { margin: 0; align-self: flex-end;
        text-align: right; }
    `,
  ],
})
export class ConversationDialog {
  protected readonly texts = CONVERSATION_DIALOG_TEXTS;

  /** Drives the dialog visibility. Owned by the host view. */
  readonly open = input<boolean>(false);
  /** The already-built conversation thread; `null` renders an empty shell. */
  readonly thread = input<ISpawnThread | null>(null);
  /** Capture gate state, drives the metadata-only note. */
  readonly captureEnabled = input<boolean>(false);

  /** Fired when the user closes the dialog (X / mask / escape). */
  readonly closed = output<void>();

  private readonly markdown = inject(MarkdownRenderer);

  /** Rendered markdown per message, keyed `<spawnId>:<prompt|response>`. */
  protected readonly messageHtml = signal<ReadonlyMap<string, SafeHtml>>(new Map());

  /** Supersession token: a thread swap mid-render drops the stale HTML. */
  private renderToken = 0;

  constructor() {
    effect(() => {
      const thread = this.thread();
      const token = ++this.renderToken;
      this.messageHtml.set(new Map());
      if (!thread) return;
      for (const record of thread.records) {
        if (record.prompt) void this.renderInto(record.spawnId, 'prompt', record.prompt, token);
        if (record.response) {
          void this.renderInto(record.spawnId, 'response', record.response, token);
        }
      }
    });
  }

  protected readonly headerText = computed(() => {
    const t = this.thread();
    if (!t) return this.texts.header(this.texts.unknownChild);
    const last = t.records[t.records.length - 1];
    const child =
      t.childName ??
      (t.childNodePath !== undefined ? pathBasenameForLink(t.childNodePath) : undefined) ??
      last?.childKind ??
      this.texts.unknownChild;
    // Empty-records thread (historical edge click, nothing retained):
    // the pair naming alone is the header, a "0 exchanges" counter
    // would shout the absence the capture-off note already explains.
    if (t.records.length === 0) return this.texts.header(child);
    return `${this.texts.header(child)} · ${this.texts.exchangeCount(t.records.length)}`;
  });

  protected readonly parentLine = computed(() => {
    const t = this.thread();
    if (!t) return '';
    return t.parentNodePath !== undefined
      ? this.texts.spawnedByNode(pathBasenameForLink(t.parentNodePath))
      : this.texts.spawnedBySession;
  });

  /** Latest known child owner across the turns (newer turns win). */
  protected readonly childOwner = computed<string | undefined>(() => {
    const t = this.thread();
    if (!t) return undefined;
    for (let i = t.records.length - 1; i >= 0; i--) {
      const owner = t.records[i]!.childOwner;
      if (owner !== undefined) return owner;
    }
    return undefined;
  });

  protected htmlFor(spawnId: string, slot: 'prompt' | 'response'): SafeHtml | null {
    return this.messageHtml().get(`${spawnId}:${slot}`) ?? null;
  }

  /**
   * A timestamp renders only when it is a real finite epoch: records
   * can arrive without one (metadata-only shapes, defensive against a
   * lax server), and `new Date(undefined)` prints "Invalid Date".
   */
  protected hasTime(ms: number | undefined): boolean {
    return typeof ms === 'number' && Number.isFinite(ms);
  }

  protected formatTime(ms: number | undefined): string {
    return this.hasTime(ms) ? new Date(ms as number).toLocaleTimeString() : '';
  }

  /**
   * Joined execution-summary segments for one turn head: duration
   * (humanized seconds), tool uses, tokens (compacted). Empty string
   * when the record carries no `execution` block (async runs, records
   * that never completed), which skips the whole segment in the head.
   */
  protected turnExecutionSummary(r: IActivitySpawnRecordApi): string {
    const exec = r.execution;
    if (!exec) return '';
    const parts: string[] = [];
    if (exec.durationMs !== undefined) parts.push(this.texts.executionDuration(exec.durationMs));
    if (exec.toolUses !== undefined) parts.push(this.texts.executionTools(exec.toolUses));
    if (exec.tokens !== undefined) {
      parts.push(this.texts.executionTokens(compactNumber(exec.tokens)));
    }
    return parts.join(' · ');
  }

  private async renderInto(
    spawnId: string,
    slot: 'prompt' | 'response',
    src: string,
    token: number,
  ): Promise<void> {
    try {
      const html = await this.markdown.render(src);
      if (token !== this.renderToken) return;
      const next = new Map(this.messageHtml());
      next.set(`${spawnId}:${slot}`, html);
      this.messageHtml.set(next);
    } catch {
      // Render failure leaves the bubble empty rather than crashing the
      // dialog; the turn head still identifies the exchange.
    }
  }

  /** X / mask / escape resolve as a close; only the false edge matters. */
  protected onVisibleChange(visible: boolean): void {
    if (!visible) this.closed.emit();
  }
}
