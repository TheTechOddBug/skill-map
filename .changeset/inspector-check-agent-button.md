---
"@skill-map/cli": patch
---

The inspector's AI Actions card gains a "Check Agent" chip (beside the Auto-fixer toggle) running the full-circuit probe on demand: it submits the hidden ping job and watches for a claim, the same check as Quick Start's agent row, extracted into one shared service both use. It holds the verdict five seconds, green on a claim, red on silence (the queued ping is cancelled), then re-arms. Advisory only: the verdict never disables the AI affordances.

## User-facing

When the agent connection looks lost, a "Check Agent" button next to the Auto-fixer pings the queue in place: green five seconds when an agent picks it up, red when nobody does, no more detours to Quick Start.
