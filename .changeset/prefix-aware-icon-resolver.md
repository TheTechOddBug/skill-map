---
"@skill-map/spec": minor
"@skill-map/cli": minor
---

Tighten the manifest `icon` grammar on `viewContributions[].icon` from "single emoji-or-PrimeIcons-bare-name" to a prefix-discriminated string with four explicit shapes. Greenfield migration: no compat shim, no `catalogCompat` bump, bare names now fail at manifest load.

**Spec (`@skill-map/spec`) — `view-slots.schema.json#/$defs/IconString`**

The `IconString` `$def` gains a `pattern` enforcing the new grammar and an updated `description`:

```
^(?:pi pi-[a-z0-9-]+|pi-[a-z0-9-]+|fa-(?:solid|regular|brands) fa-[a-z0-9-]+|fa-[a-z0-9-]+|[^a-zA-Z].*)$
```

Four valid shapes:

1. **Emoji** — any value starting with a non-ASCII-letter codepoint (`'🔍'`, `'@'`) renders as text.
2. **PrimeIcons** — `'pi-foo'` or `'pi pi-foo'` (both accepted) → `<i class="pi pi-foo">`.
3. **FontAwesome explicit family** — `'fa-solid fa-foo'` / `'fa-regular fa-foo'` / `'fa-brands fa-foo'` → pass-through.
4. **FontAwesome shorthand** — `'fa-foo'` → defaults to `<i class="fa-solid fa-foo">`.

Bare class names without a `pi-` / `fa-` prefix (`'star-fill'`, `'search'`, `'arrow-down'`) are **rejected at manifest load with `invalid-manifest`**. Prose contract in `spec/view-slots.md` §Icon string and `spec/plugin-author-guide.md` (icon row of the field reference table + new "Icon string forms" subsection) updated to match. `spec/index.json` regenerated.

**Greenfield path — no shim, no version flag**

Per `AGENTS.md` `Greenfield = no schema versioning`: no released external plugin uses the bare-name shape (the built-ins are the only consumers and ship in the same repo), so we tighten the contract in place. No `catalogCompat` bump on the catalog, no migration step registered in `sm plugins upgrade`. The bare-name rejection is documented inline in `IconString.description`.

**Kernel (`@skill-map/cli`) — built-in migration**

Every built-in extractor / analyzer that declared a bare-name icon is rewritten to `pi-foo` so it passes the new pattern at load:

- `src/built-in-plugins/extractors/stability/index.ts` — `bolt`/`ban` → `pi-bolt`/`pi-ban`
- `src/built-in-plugins/extractors/tools-count/index.ts` — `wrench` → `pi-wrench`
- `src/built-in-plugins/extractors/slash/index.ts` — `arrow-down` → `pi-arrow-down`
- `src/built-in-plugins/extractors/at-directive/index.ts` — `arrow-down` → `pi-arrow-down`
- `src/built-in-plugins/extractors/markdown-link/index.ts` — `arrow-down` → `pi-arrow-down`
- `src/built-in-plugins/extractors/external-url-counter/index.ts` — `link` → `pi-link`
- `src/built-in-plugins/analyzers/broken-ref/index.ts` — `times-circle` ×3 → `pi-times-circle` (manifest `alert` + `chip` + runtime payload)
- `src/built-in-plugins/analyzers/unknown-field/index.ts` — `info-circle` ×3 → `pi-info-circle` (same shape)
- `src/built-in-plugins/analyzers/annotation-stale/index.ts` — `clock` → `pi-clock`

Sibling test assertions updated in lock-step (`stability.test.ts`, `tools-count.test.ts`, `broken-ref.test.ts`, `unknown-field.test.ts`, `annotation-stale.test.ts`).

**UI — resolver + rename**

The shared icon component is renamed and the inline resolver pulled out into a pure function:

- `ui/src/app/slots/icon-glyph.ts` → DELETED.
- `ui/src/app/slots/icon.ts` — new file: exports `resolveIcon(raw: string | undefined): TResolvedIcon | null` (pure, no Angular deps) and the `Icon` component (`selector: 'sm-icon'`). The resolver routes on the same prefix grammar the AJV pattern enforces (emoji / `pi-foo` / `pi pi-foo` / `fa-{family} fa-foo` / `fa-foo`); unknown shapes return `null`, which renders nothing and emits a `console.warn` naming the offending value (covers runtime corruption from a legacy persisted row or a hand-edited sidecar that bypassed the load-time AJV gate). Template emits `<span>` for emoji and `<i class="<resolved cls>">` for `pi` / `fa`; the same 1px `transform: translateY` nudge from the previous `IconGlyph` survives unchanged.
- `ui/src/app/slots/icon.spec.ts` — new spec, 21 vitest tests over the branch matrix: empty / nullish input, emoji (single + ZWJ + ASCII punctuation), PrimeIcons shorthand + full class, FontAwesome explicit family (solid / regular / brands), FontAwesome shorthand, and rejected inputs (bare names, family-only, missing space, uppercase prefix, trim semantics). Pure function tested directly — no TestBed, because the existing TestBed setup is broken upstream of this work.
- `ui/src/app/renderers/{node-counter,node-icon,node-alert,scope-stat}/*.ts` — import + selector update: `IconGlyph` → `Icon`, `<sm-icon-glyph>` → `<sm-icon>`. No template logic changed.

**Why one commit**

The spec, built-ins, and UI changes form one contract change. Splitting puts the spec ahead of the built-ins (AJV would reject every built-in manifest at load) or the UI ahead of the spec (UI would resolve shapes the spec hasn't sanctioned yet). Single commit keeps the tree green at every hash.

**Verification**

- `npm test` in `src/` → 1333/1333 pass (every built-in test asserts the new `pi-foo` shape).
- `npx vitest run src/app/slots/icon.spec.ts` in `ui/` → 21/21 pass.
- `npx tsc --noEmit -p tsconfig.app.json` in `ui/` → exit 0 (renamed selector + import wired through every renderer).
- `npm run validate --workspace=@skill-map/spec` → spec OK, integrity OK.

## User-facing

**Plugin manifest icons are now prefix-discriminated.** Use `pi-foo` (PrimeIcons), `fa-solid fa-foo` / `fa-regular fa-foo` / `fa-brands fa-foo` (FontAwesome), `fa-foo` shorthand (defaults to solid), or any emoji. Bare names like `"search"` are rejected at load.
