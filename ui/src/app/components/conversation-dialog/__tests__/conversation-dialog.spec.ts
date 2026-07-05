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

  it('appends the execution trio (duration, tools, tokens) only to turns that carry one', async () => {
    // Turn 0 completed sync with a summary; turn 1 has none (async /
    // still running), so its head stays plain.
    const thread = makeThread([
      makeRecord({
        spawnId: 't1',
        startedAt: 1_700_000_000_000,
        endedAt: 1_700_000_027_200,
        status: 'ended',
        prompt: 'ask',
        response: 'reply',
        execution: { durationMs: 27_200, toolUses: 6, tokens: 4_100 },
      }),
      makeRecord({
        spawnId: 't2',
        startedAt: 1_700_000_100_000,
        status: 'running',
        prompt: 'ask again',
      }),
    ]);
    const { fixture } = bootstrap(thread, true);
    await settled(fixture);

    const head0 = body()
      .querySelector('[data-testid="conversation-dialog-turn-0"]')
      ?.querySelector('.convo__turn-meta');
    expect(head0?.textContent).toContain('27.2s');
    expect(head0?.textContent).toContain('6 tools');
    expect(head0?.textContent).toContain('4.1k tokens');

    const head1 = body()
      .querySelector('[data-testid="conversation-dialog-turn-1"]')
      ?.querySelector('.convo__turn-meta');
    expect(head1?.textContent).toContain('running');
    expect(head1?.textContent).not.toContain('tool');
    expect(head1?.textContent).not.toContain('tokens');
  });

  it('uses the singular tool label for a one-tool run', async () => {
    const thread = makeThread([
      makeRecord({
        status: 'ended',
        prompt: 'ask',
        response: 'reply',
        execution: { durationMs: 5_000, toolUses: 1, tokens: 950 },
      }),
    ]);
    const { fixture } = bootstrap(thread, true);
    await settled(fixture);
    const head = body()
      .querySelector('[data-testid="conversation-dialog-turn-0"]')
      ?.querySelector('.convo__turn-meta');
    // 5000ms humanizes without the trailing .0; sub-1k tokens pass through.
    expect(head?.textContent).toContain('5s');
    expect(head?.textContent).toContain('1 tool');
    expect(head?.textContent).not.toContain('1 tools');
    expect(head?.textContent).toContain('950 tokens');
  });

  it('emits closed on visibleChange(false)', async () => {
    const { fixture, closed } = bootstrap(makeThread([makeRecord()]), true);
    await settled(fixture);
    (
      fixture.componentInstance as unknown as { onVisibleChange(visible: boolean): void }
    ).onVisibleChange(false);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('renders no ordinal turn labels (bubbles alone separate the turns)', async () => {
    const { fixture } = bootstrap(threeTurnThread(), true);
    await settled(fixture);
    // Turn separation is carried by the per-turn testids, not a label.
    for (let i = 0; i < 3; i++) {
      expect(body().querySelector(`[data-testid="conversation-dialog-turn-${i}"]`)).not.toBeNull();
    }
    expect(body().querySelector('.convo__turn-label')).toBeNull();
    expect(body().textContent).not.toContain('Turn 1');
  });

  it('tolerates an empty-records thread (historical edge, gate off): header + capture-off note, no turns', async () => {
    // Shape the graph view builds for a labelled edge whose pair kept
    // no records: pair naming only, no owner, records: [].
    const emptyThread: ISpawnThread = {
      key: '.claude/agents/demo-orchestrator.md>>.claude/agents/demo-worker.md',
      parentOwner: '',
      parentNodePath: '.claude/agents/demo-orchestrator.md',
      childNodePath: '.claude/agents/demo-worker.md',
      records: [],
    };
    const { fixture } = bootstrap(emptyThread, false);
    await settled(fixture);

    // Header from the pair naming (basename), WITHOUT a "0 exchanges" counter.
    expect(body().textContent).toContain('Conversation with demo-worker');
    expect(body().textContent).not.toContain('exchange');
    // Parent naming renders; the empty owner line does not.
    const meta = body().querySelector('[data-testid="conversation-dialog-meta"]');
    expect(meta?.textContent).toContain('Spawned by demo-orchestrator');
    expect(meta?.textContent).not.toContain('Owner:');
    // No turns, and the capture-off note explains the blank.
    expect(body().querySelector('[data-testid^="conversation-dialog-turn-"]')).toBeNull();
    expect(
      body().querySelector('[data-testid="conversation-dialog-capture-off"]')?.textContent,
    ).toContain('Settings > Project');
  });
});
