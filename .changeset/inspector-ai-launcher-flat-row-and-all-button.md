---
"@skill-map/cli": patch
---

The inspector's AI-actions launcher drops the Finders / Standalone group labels and their wrappers, rendering every finder and standalone action in one flat button row (finders first, then standalone). A new ALL button leads the row and queues every analysis on the current node in one click, each in its current mode (Detect, Fix, or Detect+fix per the Automatic toggle), skipping entries already running.

## User-facing

**One-click run everything.** The inspector's analysis launcher loses its group labels and lines every button up in a single row. A new ALL button on the left runs every analysis on the selected node at once, each in its current mode.
