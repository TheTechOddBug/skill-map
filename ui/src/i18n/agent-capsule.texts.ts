/**
 * UI strings for `<sm-agent-capsule>` (the ephemeral capsule the graph
 * renders for a runtime sub-agent with no scanned node, spec
 * `provider-activity.md` §WS event: `agent.spawn`, unresolved
 * children). English-only per AGENTS.md (externalized, not
 * internationalized).
 */
export const AGENT_CAPSULE_TEXTS = {
  /** Live-run badge, shown only while more than one spawn aggregates. */
  count: (count: number): string => `×${count}`,
  /**
   * Tooltip. Names the unit exactly as the runtime reported it and
   * makes the ephemerality explicit: this is not a project file.
   */
  tooltip: (name: string, kind: string | undefined, count: number): string =>
    `Runtime sub-agent "${name}"${kind ? ` (${kind})` : ''}, not a project file. ` +
    `${count} live run${count === 1 ? '' : 's'}.`,
  a11y: (name: string, count: number): string =>
    `${name}, live runtime sub-agent, ${count} run${count === 1 ? '' : 's'}`,
} as const;
