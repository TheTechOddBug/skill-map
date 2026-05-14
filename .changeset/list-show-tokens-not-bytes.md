---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Replace BYTES with TOKENS in the human-mode output of `sm list` and `sm show`. Tokens are the metric users actually care about for LLM budgeting; bytes were a leftover from the early file-size mental model.

**CLI changes (`@skill-map/cli`)**:

- `sm list` table swaps the `BYTES` column for `TOKENS`. The value comes from `node.tokens?.total` (cl100k_base counts already populated by the kernel during `sm scan`). Nodes scanned with `--no-tokens` render the cell as `-`.
- `sm list --sort-by bytes_total` is **removed**, renamed to `--sort-by tokens_total`. Passing the old key now fails fast with the standard "invalid sort field" error listing the allowed values. The defensive whitelist in `kernel/adapters/sqlite/storage-adapter.ts` (`SORT_BY_COLUMNS` / `SORT_BY_DEFAULT_DIRECTION`) follows the same rename.
- `sm show` no longer renders the `Bytes:` field. The `Tokens:` field is now always present (`-` when the scan ran with `--no-tokens`) instead of being conditional on token availability. Field-block doc comments updated.
- Help text and the `examples` array on `sm list` reworded ("Top 5 by total tokens").

**Untouched surfaces** (DB shape, JSON output, internal tie-breakers):

- `scan_nodes.bytes_*` columns stay in the schema, no migration.
- `node-build.ts` still computes both `bytes` and `tokens` on every scan.
- `sm list --json` and `sm show --json` keep emitting Node objects conforming to `node.schema.json`, which still carries both `bytes` and `tokens`. Only the human-mode rendering changed.
- `sm export` keeps using `bytes` as the deterministic internal tie-breaker (invisible to the user).

**Spec change (`@skill-map/spec`)**:

- `spec/cli-contract.md` (`sm show` row): "weight (bytes/tokens triple-split)" → "weight (tokens triple-split)". A conforming implementation no longer has to render the `Bytes:` field on `sm show`. Pre-1.0 breaking, treated as minor per `spec/versioning.md` § Pre-1.0.

Tests updated: `src/test/scan-readers.test.ts` swaps `sortBy: 'bytes_total'` for `'tokens_total'` and asserts `\bTokens\b` (instead of `\bBytes\b`) in the `sm show` human output.

## User-facing

**`sm list` and `sm show` now report tokens, not bytes.** The `BYTES` column on `sm list` is now `TOKENS` (cl100k_base, frontmatter + body), and `sm show` lists `Tokens:` instead of `Bytes:`. Sort with `--sort-by tokens_total`. `--json` is unchanged.
