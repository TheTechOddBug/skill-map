---
"@skill-map/cli": patch
---

Move file parsers under `src/built-in-plugins/parsers/` for layout consistency with the other built-ins.

`frontmatter-yaml` and `plain` parsers — and their tests — now live at `src/built-in-plugins/parsers/{frontmatter-yaml,plain}/`. The kernel-internal parser registry in `src/kernel/scan/parsers/index.ts` imports from the new location; `getParser(id)` and `registerParser` are unchanged. No `kind: 'parser'` is exposed: parsers stay kernel-internal, the registry is still frozen, the parsers are not registered into `IBuiltInBundle.extensions`, and `src/kernel/index.ts` does not re-export any of it. Provider authors keep referencing parsers by id via `read.parser` exactly as before — pure relocation, no behaviour change, no public surface change.

`src/built-in-plugins/README.md` — adds an "Internal-only parsers" note explaining why the parsers live here but are absent from the inventory table.
