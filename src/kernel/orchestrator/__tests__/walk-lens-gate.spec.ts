/**
 * Unit tests for the active-lens classification gate in
 * `walkAndExtract` (kernel, `src/kernel/orchestrator/walk.ts`).
 *
 * Spec § Active-lens scope for providers (architecture.md): vendor
 * providers carry `gatedByActiveLens: true` on their manifest and only
 * participate in the walk when `provider.id === activeProvider`.
 * Universal providers (`gatedByActiveLens === false`, the default) run
 * regardless of the lens. The resolver always supplies a concrete lens;
 * under the universal `markdown` lens (a project with no marker) only
 * the universal providers run and every gated vendor is filtered out.
 *
 * The test asserts which providers' `classify` got called, not the
 * resulting graph. Provider-iteration-level filter, not file-level.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { strictEqual, deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { walkAndExtract } from '../walk.js';
import { InMemoryProgressEmitter } from '../../adapters/in-memory-progress.js';
import { buildProviderFrontmatterValidator } from '../../adapters/schema-validators.js';
import type { IProvider } from '../../extensions/index.js';

let fixture: string;

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'skill-map-walk-lens-gate-'));
  const write = (rel: string, body: string): void => {
    const abs = join(fixture, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  };
  // One file under each provider's territory so we can assert that the
  // gated-off providers do NOT see them.
  write('.claude/agents/foo.md', ['---', 'name: foo', 'description: D', '---', 'B.'].join('\n'));
  write('.codex/agents/bar.md', ['---', 'name: bar', 'description: D', '---', 'B.'].join('\n'));
  write('.agents/skills/baz/SKILL.md', ['---', 'name: baz', 'description: D', '---', 'B.'].join('\n'));
  write('notes/random.md', '# random');
});

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true });
});

/**
 * Recording stub Provider. Captures every `classify` call so tests can
 * assert which Providers actually ran. `read` is uniform `.md` so all
 * stubs see the same walker output without TOML parsing setup.
 */
function recordingProvider(over: {
  id: string;
  gatedByActiveLens?: boolean;
  kindFor: (path: string) => string | null;
  calls: string[];
}): IProvider {
  return {
    id: over.id,
    pluginId: over.id,
    kind: 'provider',
    version: '1.0.0',
    description: 'recording stub',
    presentation: { label: 'Stub', color: '#000000' },
    read: { extensions: ['.md'], parser: 'frontmatter-yaml' },
    ...(over.gatedByActiveLens !== undefined
      ? { gatedByActiveLens: over.gatedByActiveLens }
      : {}),
    kinds: {
      stub: {
        schema: 'inline',
        schemaJson: { type: 'object' },
        ui: { label: 'Stub', color: '#000000' },
      },
    },
    classify(path: string): string | null {
      over.calls.push(path);
      return over.kindFor(path);
    },
  };
}

interface IRecorders {
  claude: string[];
  openai: string[];
  agentSkills: string[];
  coreMarkdown: string[];
}

function buildRegistry(rec: IRecorders): IProvider[] {
  const claude = recordingProvider({
    id: 'claude',
    gatedByActiveLens: true,
    calls: rec.claude,
    kindFor: (p) => (p.startsWith('.claude/') ? 'stub' : null),
  });
  const openai = recordingProvider({
    id: 'openai',
    gatedByActiveLens: true,
    calls: rec.openai,
    kindFor: (p) => (p.startsWith('.codex/') ? 'stub' : null),
  });
  const agentSkills = recordingProvider({
    id: 'agent-skills',
    gatedByActiveLens: false,
    calls: rec.agentSkills,
    kindFor: (p) => (p.startsWith('.agents/skills/') ? 'stub' : null),
  });
  const coreMarkdown = recordingProvider({
    id: 'markdown',
    gatedByActiveLens: false,
    calls: rec.coreMarkdown,
    kindFor: () => 'stub',
  });
  // The universal fallback runs last in iteration order (mirrors the
  // real `built-ins.ts` registration order); the orchestrator's
  // path-dedup keeps it from re-claiming vendor-classified paths.
  return [claude, openai, agentSkills, coreMarkdown];
}

interface IWalkInvocation {
  activeProvider: string | null;
  recorders: IRecorders;
}

async function runWalk(opts: IWalkInvocation): Promise<void> {
  const providers = buildRegistry(opts.recorders);
  await walkAndExtract({
    providers,
    extractors: [],
    roots: [fixture],
    emitter: new InMemoryProgressEmitter(),
    encoder: null,
    strict: false,
    enableCache: false,
    tokenizerChanged: false,
    prior: null,
    priorIndex: {
      priorNodesByPath: new Map(),
      priorLinksByOriginating: new Map(),
      priorFrontmatterIssuesByNode: new Map(),
    },
    priorExtractorRuns: undefined,
    providerFrontmatter: buildProviderFrontmatterValidator(providers),
    pluginStores: undefined,
    activeProvider: opts.activeProvider,
    // High enough that the ceiling never fires for this fixture, the
    // test exercises lens-gating, not the walk ceiling.
    scanCeiling: 100000,
    overrideScanCeiling: null,
    maxRenderNodes: 256,
    overrideMaxRenderNodes: null,
  });
}

function emptyRecorders(): IRecorders {
  return { claude: [], openai: [], agentSkills: [], coreMarkdown: [] };
}

describe('walkAndExtract / active-lens classification gate', () => {
  it("activeProvider='claude': only claude + universals run, openai is filtered out", async () => {
    const recorders = emptyRecorders();
    await runWalk({ activeProvider: 'claude', recorders });

    // Vendor gated to the current lens: ran.
    strictEqual(
      recorders.claude.length > 0,
      true,
      'claude (gated) should run when activeProvider=claude',
    );
    // Vendor gated, NOT the current lens: did NOT run.
    deepStrictEqual(recorders.openai, [], 'openai (gated) MUST NOT run under claude lens');
    // Universals: always run.
    strictEqual(
      recorders.agentSkills.length > 0,
      true,
      'agent-skills (universal) MUST always run',
    );
    strictEqual(
      recorders.coreMarkdown.length > 0,
      true,
      'core/markdown (universal) MUST always run',
    );
  });

  it("activeProvider='openai': only openai + universals run, claude is filtered out", async () => {
    const recorders = emptyRecorders();
    await runWalk({ activeProvider: 'openai', recorders });

    deepStrictEqual(recorders.claude, [], 'claude (gated) MUST NOT run under openai lens');
    strictEqual(
      recorders.openai.length > 0,
      true,
      'openai (gated) should run when activeProvider=openai',
    );
    strictEqual(
      recorders.agentSkills.length > 0,
      true,
      'agent-skills (universal) MUST always run',
    );
    strictEqual(
      recorders.coreMarkdown.length > 0,
      true,
      'core/markdown (universal) MUST always run',
    );
  });

  it("activeProvider='markdown': only universals run, vendors are filtered out", async () => {
    const recorders = emptyRecorders();
    await runWalk({ activeProvider: 'markdown', recorders });

    deepStrictEqual(recorders.claude, [], 'claude (gated) MUST NOT run under markdown lens');
    deepStrictEqual(recorders.openai, [], 'openai (gated) MUST NOT run under markdown lens');
    strictEqual(
      recorders.agentSkills.length > 0,
      true,
      'agent-skills (universal) MUST always run',
    );
    strictEqual(
      recorders.coreMarkdown.length > 0,
      true,
      'core/markdown (universal, the lens itself) MUST run',
    );
  });

  it('activeProvider=null (bare caller): behaves like the markdown lens, vendors off', async () => {
    const recorders = emptyRecorders();
    await runWalk({ activeProvider: null, recorders });

    deepStrictEqual(recorders.claude, [], 'claude (gated) MUST NOT run for a bare null caller');
    deepStrictEqual(recorders.openai, [], 'openai (gated) MUST NOT run for a bare null caller');
    strictEqual(
      recorders.agentSkills.length > 0,
      true,
      'agent-skills (universal) MUST always run',
    );
    strictEqual(
      recorders.coreMarkdown.length > 0,
      true,
      'core/markdown (universal) MUST always run',
    );
  });
});
