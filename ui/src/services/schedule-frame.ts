/**
 * One flush per animation frame; falls back to a macrotask outside a
 * rendering context (unit tests, SSR-ish environments). Shared by the
 * activity-domain services (`NodeActivityService`,
 * `NodeActivityStatsService`, `AgentSpawnService`) that batch signal
 * publishes to the frame rate.
 */
export function scheduleFrame(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => fn());
    return;
  }
  setTimeout(fn, 16);
}
