/**
 * The synthetic submit target for NODELESS jobs (`spec/job-lifecycle.md`
 * §Submit · Nodeless submit).
 *
 * A probabilistic Action that declares `probNodeless: true` asks nothing
 * about project content, so it has no node to aim at. Rather than picking
 * an arbitrary file and telling the model to ignore it (which is what the
 * liveness probe used to do, importing every failure mode of that file:
 * deleted since the last scan, drifted, or simply absent in an empty
 * corpus), the submit runs against a synthetic target that exists only in
 * memory.
 *
 * The target is NOT a node: nothing materialises it in `scan_nodes`, it
 * never reaches the graph, and no walker will ever produce it. The only
 * place it surfaces is `state_jobs.node_id`, which consumers already have
 * to tolerate pointing at no node (a real node can be deleted between
 * submit and record).
 *
 * The `sm://` scheme is reserved for skill-map's own internals, sibling of
 * the `mcp://` scheme virtual MCP nodes use. Both share the property that
 * matters here: a real filesystem path can never contain `://`, so a
 * synthetic id can never collide with one.
 */

import type { Node } from '../types.js';

/** Scheme reserved for skill-map's own synthetic ids. */
const SYNTHETIC_SCHEME = 'sm://';

/**
 * Body of every nodeless job. Constant on purpose: it feeds the hashes
 * below, so the resulting `contentHash` depends only on the extension, its
 * version and its prompt template. One active job per nodeless extension
 * then falls straight out of the duplicate check, which for a probe is
 * exactly right (a second request adopts the first instead of piling up).
 * Never rendered: `renderJobContent` emits no `<user-content>` block for a
 * nodeless job.
 */
const SYNTHETIC_BODY_HASH = 'nodeless';

/** The reserved node id a nodeless job for `qualifiedExtensionId` carries. */
export function nodelessTargetId(qualifiedExtensionId: string): string {
  return `${SYNTHETIC_SCHEME}${qualifiedExtensionId}`;
}

/** True for an id minted by `nodelessTargetId` (any nodeless extension). */
export function isNodelessTargetId(nodeId: string): boolean {
  return nodeId.startsWith(SYNTHETIC_SCHEME);
}

/**
 * The in-memory `Node` a nodeless submit runs against. Shaped like a node
 * so the shared submit machinery (content hash, duplicate check, row
 * insert) needs no special case beyond skipping the on-disk read; every
 * count is zero and the hashes are constant because there is no file.
 */
export function nodelessTarget(qualifiedExtensionId: string): Node {
  return {
    path: nodelessTargetId(qualifiedExtensionId),
    kind: 'system',
    provider: 'core',
    bodyHash: SYNTHETIC_BODY_HASH,
    frontmatterHash: SYNTHETIC_BODY_HASH,
    bytes: { total: 0, frontmatter: 0, body: 0 },
    linksOutCount: 0,
    linksInCount: 0,
    externalRefsCount: 0,
    virtual: true,
  };
}
