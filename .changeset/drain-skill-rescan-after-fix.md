---
'@skill-map/cli': patch
---

The `sm-run-queue` drain skill now tells the agent to `sm scan -n <path>` the file it edited for a fixer job. skill-map learns about edits only from a scan, so until one ran, `sm findings` kept reporting its judgments as fresh against a body that no longer existed on disk. The agent that changed the file is the one that knows, so it owns the re-scan. Reinstall with `sm agent install`.

## User-facing

After an agent applies a fix it now re-scans that file, so results stop describing the version it just replaced. Run `sm agent install` to update your copy.
