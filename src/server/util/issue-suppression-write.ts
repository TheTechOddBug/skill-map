/**
 * Shared gated writer for `annotations.issueSuppressions`, the
 * operator's standing dismissals of DETERMINISTIC analyzer issues keyed
 * by (analyzer, value) (`spec/cli-contract.md` §sm issues dismiss;
 * `spec/db-schema.md` §scan_issues, emission-time semantics).
 *
 * One copy consumed by BOTH in-process mutation surfaces, the BFF
 * routes (`routes/node-issue-actions.ts`) and the MCP tools
 * (`mcp/issues-tools.ts`), mirroring the per-surface `writeSuppressions`
 * the findings lifecycle carries. The write rides the same consent
 * channel: `FilesystemSidecarStore(ensureSidecarWritesAllowed)` threaded
 * with the caller's `confirm` / `always`, so a missing standing
 * `allowEditSmFiles` grant surfaces as `EConsentRequiredError` (the BFF
 * global handler maps it to `412 confirm-required`; the MCP tools
 * translate it to an `McpError`) and the team policy
 * `allowSidecarWriters: false` as `ESidecarWritersForbiddenError`.
 *
 * `deepMerge` inside `applyPatch` REPLACES arrays wholesale but MERGES
 * objects, so a patch whose `annotations` carries ONLY the
 * `issueSuppressions` key leaves the sibling `suppressions` array (the
 * findings lens) intact. Never send both keys from one edit.
 */

import { resolve } from 'node:path';

import { ensureSidecarWritesAllowed } from '../../core/config/sidecar-consent.js';
import type { StoragePort } from '../../kernel/ports/storage.js';
import {
  existingIssueSuppressions,
  readSidecarFor,
  sidecarPathFor,
} from '../../kernel/sidecar/index.js';
import { FilesystemSidecarStore } from '../../kernel/sidecar/store.js';

/**
 * Minimal dep bag: the project root every sidecar path resolves
 * against. The BFF routes pass `{ cwd: deps.runtimeContext.cwd }`, the
 * MCP tools their `IMcpWriteContext` (structurally compatible).
 */
export interface IIssueSuppressionWriteDeps {
  cwd: string;
}

/** The body / tool consent flags threaded into the gated sidecar write. */
export interface IIssueSuppressionConsent {
  confirm?: boolean | undefined;
  always?: boolean | undefined;
}

/**
 * Apply an edit over the node's `annotations.issueSuppressions` through
 * the gated channel and refresh the write-through
 * `scan_nodes.annotations_json` mirror. A brand-new (or invalid)
 * sidecar sources its required `identity` block from the live scan
 * node; `'node-gone'` reports that the node is not in the persisted
 * scan (the caller maps it to its surface's not-found shape). The two
 * consent errors propagate untouched.
 */
export async function writeIssueSuppressions(
  adapter: StoragePort,
  deps: IIssueSuppressionWriteDeps,
  nodePath: string,
  edit: (entries: Record<string, unknown>[]) => Record<string, unknown>[],
  consent: IIssueSuppressionConsent,
): Promise<'ok' | 'node-gone'> {
  const mdAbs = resolve(deps.cwd, nodePath);
  const read = readSidecarFor(mdAbs);
  const changes: Record<string, unknown> = {
    annotations: {
      issueSuppressions: edit(existingIssueSuppressions(read.parsed?.annotations)),
    },
  };
  if (read.parsed === null) {
    const bundle = await adapter.scans.findNode(nodePath);
    if (!bundle) return 'node-gone';
    changes['identity'] = {
      path: bundle.node.path,
      bodyHash: bundle.node.bodyHash,
      frontmatterHash: bundle.node.frontmatterHash,
    };
  }
  const store = new FilesystemSidecarStore(ensureSidecarWritesAllowed);
  await store.applyPatch(sidecarPathFor(mdAbs), changes, {
    confirm: consent.confirm === true,
    always: consent.always === true,
    cwd: deps.cwd,
  });
  await refreshAnnotationsMirror(adapter, deps, nodePath);
  return 'ok';
}

/**
 * Write-through: mirror the node's CURRENT live sidecar annotations to
 * `scan_nodes.annotations_json`. Also used standalone by the undismiss
 * no-match self-heal (the mirror may claim a suppression the live `.sm`
 * no longer carries; heal it BEFORE reporting not-found, same posture
 * as the findings undismiss surfaces).
 */
export async function refreshAnnotationsMirror(
  adapter: StoragePort,
  deps: IIssueSuppressionWriteDeps,
  nodePath: string,
): Promise<void> {
  const mdAbs = resolve(deps.cwd, nodePath);
  await adapter.scans.refreshAnnotations(
    nodePath,
    readSidecarFor(mdAbs).parsed?.annotations ?? null,
  );
}
