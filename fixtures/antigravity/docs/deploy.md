---
name: Deploy guide
description: How a deploy runs and how to roll back.
---

# Deploy guide

The deploy workflow installs, tests, builds, and tags in one pass with
`// turbo-all` so every step auto-runs. To roll back, re-run the previous
tag's artifact and revert the changelog entry.
