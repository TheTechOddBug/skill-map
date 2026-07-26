import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

/**
 * WCAG-AA sweep across every shipped theme, against the static demo
 * bundle (real Chromium, real computed styles — the half of the a11y
 * audit that could not be verified headless in unit tests; ROADMAP
 * §pre-1.0, findings M5 + minors).
 *
 * Two instruments per theme:
 *
 *   1. **axe-core** with the WCAG 2.x A/AA tag set: text contrast
 *      (1.4.3), ARIA misuse, names/roles, etc.
 *   2. **A border-contrast probe** for 1.4.11 (non-text contrast),
 *      which axe does NOT automate: it samples the computed
 *      border-color of representative UI components against the
 *      background they sit on and asserts the >= 3:1 ratio the SC
 *      requires. This is exactly finding M5 (dark-theme `--sm-border`
 *      at ~1.7:1 against content backgrounds).
 *
 * Theme activation mirrors `ThemeService`: the mode + extra-theme
 * localStorage keys are seeded before first paint, so the app boots
 * straight into the theme under test.
 */

/** The six shipped looks: tri-state base (light/dark) + the extras. */
const THEMES: ReadonlyArray<{ id: string; mode: 'light' | 'dark'; extra: string | null }> = [
  { id: 'light', mode: 'light', extra: null },
  { id: 'dark', mode: 'dark', extra: null },
  { id: 'matrix', mode: 'dark', extra: 'matrix' },
  { id: 'neon', mode: 'dark', extra: 'neon' },
  { id: 'neon-green', mode: 'dark', extra: 'neon-green' },
  { id: 'neon-red', mode: 'dark', extra: 'neon-red' },
];

/**
 * Selectors probed for 1.4.11 border contrast: interactive / meaningful
 * component boundaries a user must be able to perceive. Kept small and
 * stable: the files rail table, the topbar controls, and any visible
 * text input on the workspace screen.
 */
const BORDER_PROBES = ['input', 'button', '.p-toggleswitch', '.p-select'];

for (const theme of THEMES) {
  test.describe(`theme ${theme.id}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        ({ mode, extra }) => {
          try {
            window.localStorage.setItem('sm.workspace.rail-collapsed', '0');
            window.localStorage.setItem('skill-map.ui.theme', mode);
            if (extra !== null) {
              window.localStorage.setItem('skill-map.ui.extra-theme', extra);
            } else {
              window.localStorage.removeItem('skill-map.ui.extra-theme');
            }
          } catch {
            /* localStorage unavailable before first paint; ignore. */
          }
        },
        { mode: theme.mode, extra: theme.extra },
      );
      await page.goto('');
      await page.getByTestId('files-view').waitFor({ state: 'visible' });
    });

    test(`axe WCAG-AA scan is clean`, async ({ page }) => {
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        // Vendor-internal exclusions, each with a reason:
        //  - PrimeNG dialog hosts stamp an aria-label on elements whose
        //    role prohibits naming; PrimeNG is capped at 21.1.9 by the
        //    licensing decision, so the fix cannot come from an upgrade.
        //  - Foblex's keyboard a11y layer items wrap the whole node card
        //    (buttons included) in a focusable item; its internals are
        //    not ours to restructure.
        .exclude('p-dialog')
        .exclude('p-confirmdialog')
        .exclude('[id^="f-a11y-item"]')
        .analyze();
      const summary = results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')} :: ${n.failureSummary ?? ''}`),
      }));
      expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
    });

    test(`UI component borders meet 1.4.11 (>= 3:1 against their background)`, async ({
      page,
    }) => {
      const failures = await page.evaluate((probes: string[]) => {
        /** WCAG relative luminance of an `rgb(a)` color string. */
        function luminance(color: string): number | null {
          const m = color.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
          if (!m) return null;
          if (m[4] !== undefined && Number(m[4]) === 0) return null; // fully transparent
          const chan = [Number(m[1]), Number(m[2]), Number(m[3])].map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * chan[0]! + 0.7152 * chan[1]! + 0.0722 * chan[2]!;
        }
        /** Effective (non-transparent) background walking up the tree. */
        function background(el: Element): string | null {
          let node: Element | null = el;
          while (node !== null) {
            const bg = getComputedStyle(node).backgroundColor;
            if (bg && !/rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg) && bg !== 'transparent') {
              return bg;
            }
            node = node.parentElement;
          }
          return null;
        }
        const out: string[] = [];
        for (const selector of probes) {
          for (const el of Array.from(document.querySelectorAll(selector)).slice(0, 10)) {
            const style = getComputedStyle(el);
            if (style.borderTopStyle === 'none' || parseFloat(style.borderTopWidth) === 0) {
              continue;
            }
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            const borderLum = luminance(style.borderTopColor);
            const bg = background(el);
            const bgLum = bg === null ? null : luminance(bg);
            if (borderLum === null || bgLum === null) continue;
            const ratio =
              (Math.max(borderLum, bgLum) + 0.05) / (Math.min(borderLum, bgLum) + 0.05);
            if (ratio < 3) {
              out.push(
                `${selector} -> border ${style.borderTopColor} on ${bg} = ${ratio.toFixed(2)}:1`,
              );
            }
          }
        }
        return [...new Set(out)];
      }, BORDER_PROBES as string[]);
      expect(failures, failures.join('\n')).toEqual([]);
    });
  });
}
