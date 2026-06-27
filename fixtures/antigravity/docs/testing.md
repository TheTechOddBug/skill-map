---
name: Testing guide
description: How to test changes before any deploy or release.
---

# Testing guide

Run the unit suite and the smoke checks before shipping. A change is not
done until both are green. The `run-tests` skill wraps this guide so every
workflow can invoke it the same way.
