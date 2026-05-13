/**
 * Dead-link verification controller for the inspector view (Step 14.5.b).
 *
 * Owns the three "did this path resolve?" signals (`verifiedAlive`,
 * `verifiedDead`, `verifyInFlight`) and the async `verifyDeadLink`
 * method that fires `dataSource.getNode(path)` to upgrade a heuristic
 * dead-link chip into a confirmed result. The cache resets on every
 * `path` change so the next node opens with a clean slate.
 *
 * Mirrors the `inspector-bump-controller` / `inspector-body-state`
 * pattern: a `setupX` factory returns a typed handle the component
 * holds.
 */

import { assertInInjectionContext, effect, signal, type Signal } from '@angular/core';

import type { IDataSourcePort } from '../../../services/data-source/data-source.port';

export type TLinkStatus = 'live' | 'dead-confirmed' | 'dead-heuristic';

export interface IDeadLinkControllerConfig {
  path: Signal<string | undefined>;
  pathSet: Signal<ReadonlySet<string>>;
  dataSource: IDataSourcePort;
}

export interface IDeadLinkHandle {
  /** O(1) status lookup for a path the inspector body links to. */
  linkStatus(path: string): TLinkStatus;
  /** True while the path is mid-verification. */
  isVerifying(path: string): boolean;
  /** Lazy verification round-trip. No-op on cache hits or in-flight. */
  verifyDeadLink(path: string): Promise<void>;
}

export function setupDeadLinkVerification(
  config: IDeadLinkControllerConfig,
): IDeadLinkHandle {
  // The reset effect below subscribes to `path` and resets the three
  // caches, so the helper must run in an Angular injection context.
  assertInInjectionContext(setupDeadLinkVerification);

  const { path: pathSignal, pathSet, dataSource } = config;

  const verifiedAlive = signal<ReadonlySet<string>>(new Set());
  const verifiedDead = signal<ReadonlySet<string>>(new Set());
  const verifyInFlight = signal<ReadonlySet<string>>(new Set());

  // Reset on every navigation so the next node opens with a clean
  // slate. Kept independent from the body fetch lifecycle so policy
  // changes here never reorder the body fetch.
  effect(() => {
    pathSignal();
    verifiedAlive.set(new Set());
    verifiedDead.set(new Set());
    verifyInFlight.set(new Set());
  });

  const linkStatus = (target: string): TLinkStatus => {
    if (pathSet().has(target)) return 'live';
    if (verifiedAlive().has(target)) return 'live';
    if (verifiedDead().has(target)) return 'dead-confirmed';
    return 'dead-heuristic';
  };

  const isVerifying = (target: string): boolean => verifyInFlight().has(target);

  const verifyDeadLink = async (target: string): Promise<void> => {
    if (verifiedAlive().has(target) || verifiedDead().has(target)) return;
    if (verifyInFlight().has(target)) return;
    verifyInFlight.update((s) => new Set(s).add(target));
    try {
      const detail = await dataSource.getNode(target);
      if (detail === null) {
        verifiedDead.update((s) => new Set(s).add(target));
      } else {
        verifiedAlive.update((s) => new Set(s).add(target));
      }
    } catch {
      // Network-level failure: leave the chip unverified, the user
      // can retry by hovering / re-rendering.
    } finally {
      verifyInFlight.update((s) => {
        const next = new Set(s);
        next.delete(target);
        return next;
      });
    }
  };

  return { linkStatus, isVerifying, verifyDeadLink };
}
