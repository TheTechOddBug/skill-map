---
'@skill-map/cli': patch
---

The `sm-run-queue` drain skill no longer forbids the file edits that fixer jobs require. Its blanket "a job's only output is its report; never edit project files" rule predated the preamble v2 fixer capability and told draining agents not to do a fixer's work. It now says the rendered prompt is authoritative: most jobs produce only a report, but a fixer whose prompt directs a named-file edit as its purpose gets that edit made. Reinstall with `sm agent install`.

## User-facing

Fixed: the agent drain skill told agents never to edit files, which blocked the new fix-it jobs from doing their work. Run `sm agent install` to update your copy.
