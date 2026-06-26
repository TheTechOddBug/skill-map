---
description: Scaffold a new UI component with tests and stories.
---

# Scaffold component

Generate a component and wire its tests. Background in the
[architecture notes](../../docs/architecture.md).

// turbo
1. Create the tests directory

   `mkdir -p tests/components`

// turbo
2. Generate the files

   `npm run generate:component`

3. Verify the component

   Invoke /run-tests to confirm the new component passes.

4. Optional deploy

   When scaffolding a hotfix, chain into /deploy directly.
