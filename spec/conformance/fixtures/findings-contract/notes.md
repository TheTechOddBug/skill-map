# Deployment notes

Plain markdown corpus for the `findings-contract` conformance cases.
The scan classifies this file through the universal `core/markdown`
fallback (kind `markdown`); the drop-in `finder-fixture/redundancy-probe`
finder has no precondition, so `sm jobs submit` can render and enqueue a
job over it.

## Steps

1. Build the release artifact.
2. Upload it to the staging bucket.
3. Promote after the smoke checks pass.
