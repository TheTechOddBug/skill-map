/**
 * M6, extension.error event coverage.
 *
 * The orchestrator drops links whose kind is outside the global closed
 * enum of link kinds, and issues whose severity is not one of
 * `error` / `warn` / `info`. Until M6 those drops were silent, a
 * plugin author saw their link / issue vanish from the result with no
 * pointer at the cause. The orchestrator now emits a
 * `type: 'extension.error'` event for every drop so a CLI listener (or
 * a Web UI subscriber) can surface the diagnostic.
 *
 * These tests:
 *   1. Run a tiny scan over an in-memory fixture.
 *   2. Inject a misbehaving extractor / rule.
 *   3. Capture every `ProgressEvent` via a custom emitter.
 *   4. Assert (a) the offending link / issue is absent from the result,
 *      and (b) the corresponding `extension.error` event was emitted
 *      with the expected `data.kind`.
 */

import { describe, it, before, after } from 'node:test';
import { strictEqual, ok, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createKernel, runScan } from '../../index.js';
import { builtIns, listBuiltIns } from '../../../plugins/built-ins.js';
import type {
  ProgressEmitterPort,
  ProgressEvent,
  TProgressListener,
} from '../../ports/progress-emitter.js';
import type { IExtractor } from '../../extensions/index.js';
import type { IAnalyzer } from '../../extensions/index.js';
import type { Issue, Link } from '../../types.js';

class CapturingEmitter implements ProgressEmitterPort {
  events: ProgressEvent[] = [];
  emit(event: ProgressEvent): void {
    this.events.push(event);
  }
  subscribe(_listener: TProgressListener): () => void {
    return () => {};
  }
}

let fixture: string;

before(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-extension-error-'));
  // One agent + one command, both with valid frontmatter. The body /
  // frontmatter content is irrelevant, the misbehaving extractor emits
  // its broken links unconditionally.
  const write = (rel: string, content: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  };
  write(
    '.claude/agents/architect.md',
    ['---', 'name: architect', 'description: A', '---', 'Body.'].join('\n'),
  );
  write(
    '.claude/commands/deploy.md',
    ['---', 'name: deploy', 'description: D', '---', 'Body.'].join('\n'),
  );
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('orchestrator, extension.error events', () => {
  // The per-extractor `emitsLinkKinds` allowlist was retired with the
  // structure-as-truth refactor; the GLOBAL closed enum of link kinds
  // (`invokes` / `references` / `mentions` / `points`, mirroring
  // `spec/schemas/link.schema.json`) is the contract now, per
  // `spec/architecture.md` §`ctx.emitLink`. Same drop + diagnose
  // behaviour, one rung up: a kind nobody declares anywhere.
  it('extractor emitting a kind outside the global enum → link dropped + extension.error', async () => {
    const buggyExtractor: IExtractor = {
      kind: 'extractor',
      id: 'bad-kind-extractor',
      pluginId: 'test',
      version: '1.0.0',
      description: 'test',
      scope: 'body',
      extract: (ctx): void => {
        ctx.emitLink({
          // Off-contract: 'teleports' is in no enum, anywhere. The cast
          // is deliberate, the static type forbids the value the runtime
          // guard exists to catch.
          kind: 'teleports' as unknown as Link['kind'],
          source: '.claude/agents/architect.md',
          target: '.claude/commands/deploy.md',
          confidence: 0.3,
          sources: [],
        } satisfies Link);
      },
    };

    const emitter = new CapturingEmitter();
    const kernel = createKernel();
    const baseline = builtIns();
    const result = await runScan(kernel, {
      roots: [fixture],
      emitter,
      extensions: {
        providers: baseline.providers,
        extractors: [buggyExtractor],
        analyzers: [],
      },
    });

    // Result links have no entry from the buggy extractor.
    const fromBuggy = result.links.filter(
      (l) => (l.kind as string) === 'teleports',
    );
    strictEqual(fromBuggy.length, 0, 'off-enum link must be dropped');

    // The extractor runs once PER node walked (2 nodes in the fixture);
    // each invocation emits one off-enum link → one `extension.error`
    // event per dropped link.
    const extErrors = emitter.events.filter((e) => e.type === 'extension.error');
    strictEqual(extErrors.length, 2, 'one extension.error per dropped link');
    const data = extErrors[0]!.data as Record<string, unknown>;
    strictEqual(data['kind'], 'link-kind-not-declared');
    // Spec § A.6, `extensionId` is the qualified id `<pluginId>/<id>`.
    strictEqual(data['extensionId'], 'test/bad-kind-extractor');
    strictEqual(data['linkKind'], 'teleports');
    // The rejected-against set is the GLOBAL enum, not a per-extractor
    // list; pinning it here is what would catch a silent widening of
    // `KNOWN_LINK_KINDS` (e.g. someone adding a kind to the orchestrator
    // without adding it to `link.schema.json`).
    deepStrictEqual(data['declaredKinds'], ['invokes', 'references', 'mentions', 'points']);
    // The dropped link is echoed back so the author can locate it.
    deepStrictEqual(data['link'], {
      source: '.claude/agents/architect.md',
      target: '.claude/commands/deploy.md',
      kind: 'teleports',
    });
    ok(typeof data['message'] === 'string');
    ok(
      (data['message'] as string).includes('test/bad-kind-extractor'),
      'message names the extractor with its qualified id',
    );
    ok(
      (data['message'] as string).includes('teleports'),
      'message names the off-enum kind that was dropped',
    );
  });

  it('rule emitting an issue with invalid severity → issue dropped + extension.error', async () => {
    // Rule emits an issue with severity 'fatal' which is NOT one of
    // 'error' | 'warn' | 'info'. Must be dropped + diagnosed.
    const buggyRule: IAnalyzer = {
      kind: 'analyzer',
      id: 'bad-severity-rule',
      pluginId: 'test',
      version: '1.0.0',
      description: 'test',
      evaluate: () =>
        [
          {
            analyzerId: 'bad-severity-rule',
            // Exercising the runtime guard with a value the static type
            // forbids; the double cast is deliberate (a @ts-expect-error
            // no longer anchors here since `evaluate` became optional on
            // the contract, union targets report at the property site).
            severity: 'fatal' as unknown as Issue['severity'],
            nodeIds: ['.claude/agents/architect.md'],
            message: 'should not appear',
          } satisfies Issue,
        ],
    };

    const emitter = new CapturingEmitter();
    const kernel = createKernel();
    const baseline = builtIns();
    const result = await runScan(kernel, {
      roots: [fixture],
      emitter,
      extensions: {
        providers: baseline.providers,
        extractors: [],
        analyzers: [buggyRule],
      },
    });

    const fromBuggy = result.issues.filter((i) => i.analyzerId === 'bad-severity-rule');
    strictEqual(fromBuggy.length, 0, 'off-contract issue must be dropped');

    const extErrors = emitter.events.filter((e) => e.type === 'extension.error');
    strictEqual(extErrors.length, 1, 'one extension.error per dropped issue');
    const data = extErrors[0]!.data as Record<string, unknown>;
    strictEqual(data['kind'], 'issue-invalid-severity');
    // Spec § A.6, `extensionId` is the qualified id `<pluginId>/<id>`.
    strictEqual(data['extensionId'], 'test/bad-severity-rule');
    strictEqual(data['severity'], 'fatal');
    ok(
      (data['message'] as string).includes('test/bad-severity-rule'),
      'message names the rule with its qualified id',
    );
  });

  it('well-behaved extensions emit no extension.error', async () => {
    // Sanity check: a clean run with no off-contract emissions must
    // produce zero extension.error events. Catches a future regression
    // where the orchestrator starts complaining about valid emissions.
    //
    // Manifests are registered before the scan so the run has the shape
    // a real boot has: guards that consult the kernel REGISTRY (rather
    // than the runtime `IScanExtensions` set) see a fully populated one,
    // and a false positive here would be a registry gap, not a genuine
    // off-contract emission.
    const emitter = new CapturingEmitter();
    const kernel = createKernel();
    for (const manifest of listBuiltIns()) kernel.registry.register(manifest);
    await runScan(kernel, {
      roots: [fixture],
      emitter,
      extensions: builtIns(),
    });
    const extErrors = emitter.events.filter((e) => e.type === 'extension.error');
    strictEqual(extErrors.length, 0);
  });

  // DELETED: `analyzer with unresolved recommendedActions → extension.error
  // per missing id`. `Analyzer.recommendedActions` was retired with the
  // structure-as-truth refactor and the edge now points the other way,
  // the Action declares `precondition.analyzerIds` (Modelo B), so the
  // orchestrator has nothing analyzer-side left to resolve and emits no
  // `recommended-action-missing` event. The surviving contract, matching
  // findings to the fixer that declares their finder, is covered in
  // `cli/commands/__tests__/fixer-batch-builtin.spec.ts` (§`analyzerIds`
  // selection) and `cli/commands/__tests__/ai-reference-action-builtin.spec.ts`.
  // Do not re-add here. NOTE: the dangling-`analyzerIds` DIAGNOSTIC that
  // `kernel/extensions/action.ts` promises ("warn via
  // `recommended-action-missing` in `sm plugins doctor`") lives in
  // `plugins/doctor.ts` as a non-blocking warning, NOT in the
  // orchestrator, and is covered by `cli/commands/plugins/__tests__/
  // plugins-cli.spec.ts` (§`recommended-action-missing`).
});
