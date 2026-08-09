# Deployment notes

Plain markdown corpus for the skill-actions conformance case. The scan
classifies this file through the universal `core/markdown` fallback
(kind `markdown`); the skill-actions catalog offers every installed skill
on every node, so this single node is enough to observe the `skills`
bucket on `GET /api/nodes/:pathB64/prob-extensions`.

## Steps

1. Build the release artifact.
2. Upload it to the staging bucket.
3. Promote after the smoke checks pass.
