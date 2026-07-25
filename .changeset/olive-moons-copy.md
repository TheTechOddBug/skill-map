---
'@skill-map/cli': patch
---

The inspector header's path chip is now click-to-copy: clicking it writes the full project-relative path to the clipboard and confirms with a check icon for a couple of seconds, mirroring the debug panel's hash cells. The clipboard write moved into a shared `ui/src/services/clipboard.ts` helper the debug panel now reuses instead of its own inline copy.

## User-facing

Click the file path in the inspector header to copy it to the clipboard, the same way the hashes in Metadata already worked. A check mark confirms the copy.
