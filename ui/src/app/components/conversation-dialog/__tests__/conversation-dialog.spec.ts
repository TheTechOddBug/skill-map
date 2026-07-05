import { afterEach, describe, expect, it, vi } from 'vitest';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';

import { ConversationDialog } from '../conversation-dialog';
import { groupSpawnThreads, type ISpawnThread } from '../spawn-thread';
import { MarkdownRenderer } from '../../../../services/markdown-renderer';
import type { IActivitySpawnRecordApi } from '../../../../models/api';

/**
 * `<sm-conversation-dialog>`: header composition (child name +
 * exchange counter), the chronological chat-bubble thread rendered
 * through the markdown pipeline, the per-turn async-gap note, the
 * capture-off note, and the close output. The dialog renders with
 * `appendTo="body"`, so content assertions go through `document.body`.
 */

class FakeMarkdownRenderer extends MarkdownRenderer {
  constructor(private readonly sanitizerRef: DomSanitizer) {
    super();
  }

  override async render(src: string): Promise<SafeHtml> {
    return this.sanitizerRef.bypassSecurityTrustHtml(`<div data-fake-md>${src}</div>`);
  }
}

function makeRecord(overrides: Partial<IActivitySpawnRecordApi> = {}): IActivitySpawnRecordApi {
  return {
    spawnId: 'toolu_01',
    parentOwner: 'main:6cfe5636',
    childKind: 'agent',
    childName: 'demo-worker',
    childNodePath: '.claude/agents/demo-worker.md',
    startedAt: 1_700_000_000_000,
    status: 'running',
    ...overrides,
  };
}

/** Builds the thread the same way both host views do. */
function makeThread(records: IActivitySpawnRecordApi[]): ISpawnThread {
  return groupSpawnThreads(records)[0]!;
}

interface IHarness {
  fixture: ComponentFixture<ConversationDialog>;
  closed: ReturnType<typeof vi.fn>;
}

function bootstrap(thread: ISpawnThread | null, captureEnabled: boolean): IHarness {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideNoopAnimations(),
      {
        provide: MarkdownRenderer,
        useFactory: (): MarkdownRenderer => new FakeMarkdownRenderer(TestBed.inject(DomSanitizer)),
      },
    ],
  });
  const fixture = TestBed.createComponent(ConversationDialog);
  const closed = vi.fn();
  fixture.componentInstance.closed.subscribe(closed);
  fixture.componentRef.setInput('thread', thread);
  fixture.componentRef.setInput('captureEnabled', captureEnabled);
  fixture.componentRef.setInput('open', true);
  fixture.detectChanges();
  return { fixture, closed };
}

async function settled(fixture: ComponentFixture<ConversationDialog>): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  fixture.detectChanges();
}

function body(): HTMLElement {
  return document.body;
}

/** The 3-turn demo-orchestrator <-> demo-worker exchange, in order. */
function threeTurnThread(overrides: Partial<IActivitySpawnRecordApi>[] = []): ISpawnThread {
  return makeThread([
    makeRecord({
      spawnId: 't1',
      startedAt: 1_700_000_000_000,
      status: 'ended',
      prompt: 'first ask',
      response: 'first reply',
      ...overrides[0],
    }),
    makeRecord({
      spawnId: 't2',
      startedAt: 1_700_000_100_000,
      status: 'ended',
      prompt: 'second ask',
      response: 'second reply',
      ...overrides[1],
    }),
    makeRecord({
      spawnId: 't3',
      startedAt: 1_700_000_200_000,
      status: 'ended',
      prompt: 'third ask',
      response: 'third reply',
      ...overrides[2],
    }),
  ]);
}

describe('ConversationDialog', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    // p-dialog appends to <body>; drop any orphaned panel between tests.
    document.body.querySelectorAll('[data-testid="conversation-dialog"]').forEach((el) => el.remove());
  });

  it('composes the header from the child name plus the exchange counter', async () => {
    const { fixture } = bootstrap(threeTurnThread(), true);
    await settled(fixture);
    expect(body().textContent).toContain('Conversation with demo-worker');
    expect(body().textContent).toContain('3 exchanges');
    const meta = body().querySelector('[data-testid="conversation-dialog-meta"]');
    expect(meta?.textContent).toContain('Spawned by the main session');
    expect(meta?.textContent).toContain('main:6cfe5636');
  });

  it('uses the singular exchange counter for a one-turn thread', async () => {
    const { fixture } = bootstrap(makeThread([makeRecord()]), true);
    await settled(fixture);
    expect(body().textContent).toContain('1 exchange');
    expect(body().textContent).not.toContain('exchanges');
  });

  it('renders a 3-turn thread chronologically as prompt/response bubbles', async () => {
    const { fixture } = bootstrap(threeTurnThread(), true);
    await settled(fixture);
    await settled(fixture);

    for (let i = 0; i < 3; i++) {
      expect(body().querySelector(`[data-testid="conversation-dialog-turn-${i}"]`)).not.toBeNull();
    }
    const prompt0 = body().querySelector('[data-testid="conversation-dialog-prompt-0"]');
    expect(prompt0?.innerHTML).toContain('data-fake-md');
    expect(prompt0?.textContent).toContain('first ask');
    expect(
      body().querySelector('[data-testid="conversation-dialog-response-0"]')?.textContent,
    ).toContain('first reply');
    expect(
      body().querySelector('[data-testid="conversation-dialog-prompt-2"]')?.textContent,
    ).toContain('third ask');
    expect(
      body().querySelector('[data-testid="conversation-dialog-response-2"]')?.textContent,
    ).toContain('third reply');

    // Document order IS the turn order: prompt, response, prompt, ...
    const bubbles = Array.from(body().querySelectorAll('.convo__bubble')).map(
      (el) => el.textContent?.trim(),
    );
    expect(bubbles).toEqual([
      'first ask',
      'first reply',
      'second ask',
      'second reply',
      'third ask',
      'third reply',
    ]);
    expect(body().querySelector('[data-testid^="conversation-dialog-async-note-"]')).toBeNull();
  });

  it('shows the per-turn no-reply note only on the turn missing its response', async () => {
    const thread = threeTurnThread([{}, {}, { status: 'running', response: undefined }]);
    const { fixture } = bootstrap(thread, true);
    await settled(fixture);
    expect(body().querySelector('[data-testid="conversation-dialog-async-note-0"]')).toBeNull();
    expect(body().querySelector('[data-testid="conversation-dialog-async-note-1"]')).toBeNull();
    const note = body().querySelector('[data-testid="conversation-dialog-async-note-2"]');
    expect(note?.textContent).toContain('No reply yet');
  });

  it('shows the capture-off note (and no async note) when the gate is off', async () => {
    const { fixture } = bootstrap(makeThread([makeRecord()]), false);
    await settled(fixture);
    expect(
      body().querySelector('[data-testid="conversation-dialog-capture-off"]')?.textContent,
    ).toContain('Settings > Project');
    expect(body().querySelector('[data-testid^="conversation-dialog-async-note-"]')).toBeNull();
  });

  it('emits closed on visibleChange(false)', async () => {
    const { fixture, closed } = bootstrap(makeThread([makeRecord()]), true);
    await settled(fixture);
    (
      fixture.componentInstance as unknown as { onVisibleChange(visible: boolean): void }
    ).onVisibleChange(false);
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
