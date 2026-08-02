---
"@skill-map/cli": patch
"@skill-map/spec": patch
---

The interactive cache-rebuild prompt on DB drift (`sm scan` / `sm serve` on a version-skewed or schema-changed cache) now defaults to Yes: the suffix reads `[Y/n]`, a bare Enter rebuilds, and only an explicit `n` / `no` declines. The rebuild is safe (the cache is derived from `.sm` files) and declining dead-ends the verb, so Yes is the right default. Documented in `spec/db-schema.md` §Schema drift.

## User-facing

When skill-map warns that your local cache is from an older version, just press Enter to rebuild it, the prompt now defaults to Yes. Nothing of yours is touched; the cache is rebuilt from your files.
