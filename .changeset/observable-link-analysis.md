---
"@skill-map/cli": minor
"@skill-map/spec": minor
---

Observable link analysis. The link-matrix walkthrough surfaced a recurring complaint, "the inspector tells me there is an edge but not where, why, or whether it overlaps with another", and a small cluster of detection bugs that were hiding real problems and inventing fake ones. This changeset is the drain pass.

**Kernel domain shape, additive.** Three new fields on `Link` / `Node`:

- `Link.occurrences[]` (`LinkOccurrence` = `{ extractor, originalTrigger, location? }`) accumulates every syntactic site in the source body that contributed to an edge. Populated by extractors at emit time, concatenated by `dedupeLinks` across extractor merges (with `(extractor, originalTrigger, line)` dedup inside the array to defend against double-emit). Frontmatter / sidecar-derived synthetic links carry it empty.
- `Link.resolvedTarget` is the node path the post-walk `liftResolvedLinkConfidence` transform bound the link to. Equal to `target` for path-style links; differs for trigger-style links (`@foo`, `/cmd`) where `target` keeps the authored trigger and `resolvedTarget` carries the resolved node path. `null` when unresolved (broken).
- `Node.externalRefs[]` (`IExternalRef` = `{ url, line?, originalTrigger? }`) is the list of distinct http(s) URLs the body references, in extractor-order, deduped by normalised URL. Populated by `recomputeExternalRefsCount` (renamed in role from "count-only" to "count + list"); the denormalised `externalRefsCount` rides alongside and must equal the array length when both are present.

All three exported from `src/kernel/index.ts`; matching JSON-Schema additions in `spec/schemas/link.schema.json` and `spec/schemas/node.schema.json` (additive, `additionalProperties: false` preserved); `spec/index.json` regenerated.

**SQL, edited in place (greenfield rule).** `src/migrations/001_initial.sql` gains three columns: `scan_links.occurrences_json`, `scan_links.resolved_target`, `scan_nodes.external_refs_json`; one new index `ix_scan_links_resolved_target`. Matching types in `src/kernel/adapters/sqlite/schema.ts`; `linkToRow` / `rowToLink` / `nodeToRow` / `rowToNode` round-trip the new columns (round-trip tests already cover the shape).

**Two new analyzers.**

- `core/redundant-target-reference` flags `(source, resolved-target)` pairs reached via two or more syntactic surfaces, whether cross-extractor (same kind, multiple authored triggers) or cross-kind (multi-edge to one target). Walks `Link.occurrences[]` plus `Link.resolvedTarget` to detect the redundancy. Severity `warn`. Tests at `src/plugins/core/analyzers/redundant-target-reference/__tests__/redundant-target-reference.spec.ts`.
- `core/self-loop` flags links whose source is its own resolved target (a body heading like `# /deploy` inside the file that defines `/deploy`). Severity `warn`. The UI hides self-loops by default; this analyzer is the authoritative detector so the count is still visible in `sm scan` output and SARIF exports. Tests at `src/plugins/core/analyzers/self-loop/__tests__/self-loop.spec.ts`.

**Existing analyzer extended.** `core/reserved-name` now emits both target-side (the file shadowing a built-in, behaviour preserved) and source-side (one `warn` per link the lift downgraded to `RESERVED_TARGET_CONFIDENCE`). Source-side issues carry `data.target` matching the link so UIs can correlate per-row instead of bleeding "any issue on source" onto every outgoing edge.

**Extractor fixes.**

- `core/markdown-link` and `core/external-url-counter` now run their regex over `stripCodeBlocks(ctx.body)` instead of raw body, matching the guard `claude/at-directive` and `claude/slash` already had. Author-written examples like `[label](path)` or `https://example.com` inside backticks or fenced blocks stop emitting spurious `references` edges (which were feeding `core/broken-ref` false positives) and stop inflating the external-URL count. Three new test cases per extractor (inline-code, fenced, mixed).
- `claude/at-directive` and `claude/slash` extractors now track line numbers per occurrence (the `core/redundant-target-reference` analyzer needs every occurrence to know its line). Both compute `lineStarts` once per body via the new shared util `src/kernel/util/line-tracking.ts` (extracted from `markdown-link`'s previously-local helper) and attach `location: { line }` to every emit.

**BFF.** `/api/links?to=X` now matches via `target` OR `resolvedTarget`; the storage-layer companion in `getNodeBundle` does the same. Without this, a Claude `@real-agent` mention stayed invisible in the incoming list of `.claude/agents/real-agent.md` because the row's `target_path` carried the trigger, not the resolved path.

**UI overhaul, `LinkedNodesPanel`.**

- Numeric confidence value shown in the tag, was qualitative `high` / `medium` / `low`. The tier survives as the tag's tooltip and severity colour, so `0.85` and `1.00` are now visually distinguishable on the same row.
- New "Findings" section at the top of the panel, lists every issue whose `nodeIds[]` includes the focused path.
- Inline issue chip per outgoing / incoming row. Correlation rules tightened: source-side issue with `data.target` matching the link's `target` / `resolvedTarget` / current path (the original "any issue on source" fallback bled unrelated `broken-ref` findings onto every row).
- Per-row "Occurs at:" sub-list when `link.occurrences.length > 0`, shows each line + original trigger + extractor id.
- New "External references" section above Findings when `node.externalRefs` is populated, clickable URLs that open in a new tab.
- Self-loops hidden by default from outgoing + incoming via a client-side `isSelfLoop` filter. The `core/self-loop` analyzer remains the authoritative detector; the panel just respects it.
- Texts catalog (`linked-nodes-panel.texts.ts`) and CSS updated.
- `ui/src/models/api.ts` gained `ILinkOccurrenceApi`, `IExternalRefApi`, `Link.occurrences`, `Link.resolvedTarget`, `Node.externalRefs` shapes mirroring the kernel domain types.

**Plus an out-of-band AGENTS.md operating rule.** A new analyzer queues mid-execution user messages (do not abort an in-flight tool sequence to handle an interrupt unless the interrupt is an unambiguous abort verb). Lands in this commit because it surfaced during the same walkthrough.

Pre-1.0 minor on both workspaces per `spec/versioning.md` (additive shape changes, no breakage).

## User-facing

**Inspector overhaul.** Links show numeric confidence, a Findings list, per-row issue chips, and per-site "Occurs at" lines. New "External references" section. Self-loops hidden by default. Two new analyzers flag redundant multi-form references and self-loops.
