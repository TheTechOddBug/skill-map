/**
 * Boot-scoped `owner -> agent node` index (see
 * `spec/provider-activity.md` §Spawn parent anchoring).
 *
 * Some runtimes report a spawn without naming its PARENT: OpenCode's
 * `task` event carries only the spawning session id, so the relation
 * arrives in the relation-only form and the client anchors it on a
 * synthetic session capsule. But the parent's identity is knowable: the
 * same session already told us which agent it is running (OpenCode's
 * `chat.message` carries the NAMED agent plus that session id), and a
 * completed spawn tells us which node its CHILD owner ran. This index
 * remembers both, so the resolver can stamp `parentNodePath` on a
 * relation-only spawn and the edge hangs off the real agent node.
 *
 * Deliberately NOT a general activity cache: it holds one path per
 * owner, no content, no counts, no history, and it is dropped when the
 * owner's execution context ends. The capsule stays the fallback for
 * owners that genuinely run no scanned node (a built-in agent with no
 * file on disk, a bare main context).
 *
 * Bounded: at most `OWNER_INDEX_CAP` owners, oldest insertion evicted
 * first. A long-lived server watching a chatty runtime cannot grow this
 * without bound, and an evicted owner costs only the anchoring (its
 * spawn falls back to the capsule), never correctness.
 */

/** Ring bound: at most this many owners are remembered. */
export const OWNER_INDEX_CAP = 500;

export class ActivityOwnerIndex {
  /** `owner -> node path it is running`, insertion-ordered for eviction. */
  readonly #byOwner = new Map<string, string>();

  /**
   * Remember that `owner` is running the unit at `nodePath`. Re-noting
   * an owner refreshes its position (delete + set), so eviction drops
   * the least recently confirmed owner rather than the oldest-seen one.
   */
  note(owner: string, nodePath: string): void {
    if (owner.length === 0 || nodePath.length === 0) return;
    this.#byOwner.delete(owner);
    this.#byOwner.set(owner, nodePath);
    while (this.#byOwner.size > OWNER_INDEX_CAP) {
      const oldest = this.#byOwner.keys().next();
      if (oldest.done === true) break;
      this.#byOwner.delete(oldest.value);
    }
  }

  /** Drop an owner whose execution context ended. */
  forget(owner: string): void {
    this.#byOwner.delete(owner);
  }

  /** The node this owner is running, when one was reported. */
  nodeFor(owner: string): string | undefined {
    return this.#byOwner.get(owner);
  }

  /** Remembered owners, for tests and diagnostics. */
  get size(): number {
    return this.#byOwner.size;
  }
}
