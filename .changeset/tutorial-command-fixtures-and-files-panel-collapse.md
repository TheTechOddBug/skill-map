---
"@skill-map/cli": patch
---

The workspace files-panel collapse button now shows a left chevron instead of an `✕`, so it no longer reads as a clear-search control sitting next to the search box. The bundled `sm-tutorial` skill drops the slashed `# /publish` / `# /init` headers from its command fixtures (the slash token produced a spurious self-loop link the tester saw before it was explained) and adds a third-terminal heads-up to the maintenance part, where the live server and one-off `sm` commands run side by side.

## User-facing

The files panel's collapse button is now a chevron instead of an `✕`, so it clearly hides the panel rather than clearing the search. The built-in tutorial fixes a stray self-link in its command examples and reminds you to open a third terminal during the maintenance part.
