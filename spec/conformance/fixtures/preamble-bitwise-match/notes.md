# Deployment notes

Plain markdown corpus for the `preamble-bitwise-match` conformance case.
The scan classifies this file through the universal `core/markdown`
fallback (kind `markdown`), which satisfies the `markdown-summarizer`
Action precondition so `sm job submit` can render and enqueue a job over
it.

## Steps

1. Build the release artifact.
2. Upload it to the staging bucket.
3. Promote after the smoke checks pass.
