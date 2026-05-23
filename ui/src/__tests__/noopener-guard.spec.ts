/**
 * Static guard, every `target="_blank"` anchor in the UI tree MUST
 * carry `rel="noopener noreferrer"`. Without `noopener` the new window
 * gets a usable `opener` reference back into the origin (tabnabbing,
 * `opener.location = ...`); without `noreferrer` the destination
 * receives a `Referer` header it has no business knowing.
 *
 * Audit `app-hacker` L3 (consistency follow-up). The repo has no
 * eslint rule for `react/jsx-no-target-blank` (no eslint config in
 * `ui/` at all today), so the guard lives as a unit test that scans
 * the template sources at suite time.
 *
 * Source loading uses Vite's `import.meta.glob({ eager, query: '?raw' })`,
 * which the unit-test builder (`@angular/build:unit-test`) resolves at
 * build time. Scope is `.html` files only, the glob is NOT extended to
 * `*.ts` because Angular's CLI plugin double-processes component
 * sources when they enter the build graph as raw assets and surfaces
 * stale template-typecheck errors against the synthesised second copy.
 *
 * **Inline-template `.ts` components are NOT covered here.** Today the
 * only inline template carrying `target="_blank"` is
 * `app/components/settings-modal/settings-about.ts`; future inline
 * templates that introduce external links must either be migrated to
 * a sibling `.html` file (so this guard picks them up automatically)
 * or get a hand-written assertion alongside the component's own spec.
 * The accepted trade-off is documented in `context/ui.md`.
 *
 * Test files (`__tests__/**`, `*.spec.html`) are excluded because they
 * assert against templates and may carry literal `target="_blank"`
 * matchers without rendering them.
 */

import { describe, expect, it } from 'vitest';

/**
 * Vite augments `import.meta` with `glob<T>(pattern, opts)` for build-
 * time file enumeration. The expression MUST be referenced as the
 * literal `import.meta.glob(...)` syntax: Vite statically rewrites
 * this call at transform time, so aliasing it through a local
 * variable (`const g = import.meta.glob;`) makes the transform skip
 * the call and fail at runtime.
 *
 * The Angular `tsconfig.spec.json` doesn't pull `vite/client` into its
 * `types` list (would also drag DOM-overrides that conflict with
 * `@angular/build`), so the typing is opened locally via a one-line
 * cast on the call site.
 */
type TGlobResult = Record<string, string>;
const templateSources = (import.meta as ImportMeta & {
  glob: (pattern: string, opts: { eager: true; query: '?raw'; import: 'default' }) => TGlobResult;
}).glob('../**/*.html', { eager: true, query: '?raw', import: 'default' });

interface IViolation {
  file: string;
  line: number;
  snippet: string;
}

/**
 * Collect every offending `target="_blank"` site that does not carry a
 * `rel` attribute mentioning both `noopener` and `noreferrer` within
 * the SAME tag boundary. A "tag boundary" is the substring from the
 * preceding `<` to the next `>` after the `target` occurrence.
 */
function scanSource(file: string, src: string, into: IViolation[]): void {
  const targetRe = /target\s*=\s*["']_blank["']/g;
  let m: RegExpExecArray | null;
  targetRe.lastIndex = 0;
  while ((m = targetRe.exec(src)) !== null) {
    const tagStart = src.lastIndexOf('<', m.index);
    const tagEnd = src.indexOf('>', m.index);
    if (tagStart < 0 || tagEnd < 0) continue;
    const tag = src.slice(tagStart, tagEnd + 1);
    const relMatch = /\brel\s*=\s*["']([^"']*)["']/.exec(tag);
    const rel = relMatch?.[1] ?? '';
    if (rel.includes('noopener') && rel.includes('noreferrer')) continue;
    const line = src.slice(0, m.index).split('\n').length;
    into.push({
      file,
      line,
      snippet: tag.replace(/\s+/g, ' ').trim().slice(0, 160),
    });
  }
}

describe('audit L3, target="_blank" anchors carry rel="noopener noreferrer"', () => {
  it('every external link in the UI template tree is reverse-tabnabbing safe', () => {
    const violations: IViolation[] = [];
    for (const [path, src] of Object.entries(templateSources)) {
      if (path.includes('__tests__/') || path.endsWith('.spec.html')) continue;
      scanSource(path, src, violations);
    }

    if (violations.length > 0) {
      const lines = violations.map(
        (v) => `  ${v.file}:${v.line} -> ${v.snippet}`,
      );
      throw new Error(
        `Found ${violations.length} target="_blank" anchor(s) missing rel="noopener noreferrer":\n${lines.join('\n')}`,
      );
    }
    expect(violations).toEqual([]);
  });

  it('sanity check, the glob actually picked up some templates', () => {
    // Without this guard a regression in the build pipeline that emits
    // an empty `templateSources` object would let the suite pass with
    // zero coverage. ~50 templates live under `app/` today; assert at
    // least 20 to leave room for refactors that consolidate views.
    expect(Object.keys(templateSources).length).toBeGreaterThanOrEqual(20);
  });
});
