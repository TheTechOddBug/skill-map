/**
 * Confidence PENALTIES applied by the built-in score-phase detectors as
 * `delta` ops on top of the kernel's 1.0 baseline. Each detector subtracts
 * a fixed absolute amount; the fold sums every delta and clamps to [0,1].
 * Single source of truth so the detectors cannot drift.
 *
 *   - `RESERVED_PENALTY` (0.9) by `core/name-reserved` → 1.0 - 0.9 = 0.1.
 *   - `BROKEN_PENALTY`   (0.5) by `core/reference-broken` → 1.0 - 0.5 = 0.5.
 */

/**
 * Penalty subtracted from a link whose target is reserved by its Provider
 * runtime (the built-in shadows the file). The largest built-in penalty:
 * a reserved edge lands at 0.1 from the 1.0 base, well below a broken one,
 * so it reads as the subtlest, faintest trap, deliberately. Stays non-zero
 * after the clamp so the edge keeps rendering, downgraded but visible.
 */
export const RESERVED_PENALTY = 0.9;

/**
 * Penalty subtracted from a genuinely-broken link (target resolves to
 * nothing: no node path, no name-index entry). Lands at 0.5 from the 1.0
 * base, ABOVE a reserved target on purpose: a reserved target resolves to
 * a real-but-runtime-ignored file (subtler), whereas a broken target
 * merely points at nothing. Visibly demoted, while staying above reserved.
 */
export const BROKEN_PENALTY = 0.5;
