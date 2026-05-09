---
"@skill-map/cli": patch
---

Document `.sm` sidecar files in user-facing READMEs and the interactive
tutorial. Adds a "Sidecar `.sm` files (don't be alarmed when they appear)"
section to `README.md` and `README.es.md` (between Quick start and the
Interactive tutorial), a terser one-paragraph summary in `src/README.md`
(which ships in the `@skill-map/cli` npm tarball), and replaces the
buried sidecar paragraph in `sm-tutorial` Step 3 with a short
heads-up blockquote. The content explains what `.sm` files are, why they
sit beside the `.md` instead of inside its frontmatter, that `sm scan` /
`sm watch` / the live UI never create them (only `sm bump` and
`sm sidecar annotate` do), and that they belong in git. No behavioural
change — purely documentation surfacing of an existing architectural
decision (Step 9.6, Decision #125).
