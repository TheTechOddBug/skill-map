---
name: acme-toolkit
description: "Root project memory for the acme-toolkit demo. New contributors start here: it imports the architecture overview and names the agent that gates frontend changes."
---

# acme-toolkit

Project memory for the acme-toolkit demo. Read this file first, then follow the import below into the deeper docs.

## Start here

@ARCHITECTURE.md is the one-page tour: which agents own what, which skills back the review pipeline, and how the `/deploy` command threads through both.

## Frontend changes

Anything touching the Angular surface goes through @frontend-specialist before it ships. It owns the design-system token checks and defers diff-level rule enforcement to the review pipeline.
