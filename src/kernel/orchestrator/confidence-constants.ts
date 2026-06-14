/**
 * Confidence sentinel values shared between the built-in
 * `core/score-resolution` scorer (which applies them) and
 * `core/name-reserved` (which reads `RESERVED_TARGET_CONFIDENCE` to
 * surface the source-side finding). Single source of truth so the
 * scorer and the reader cannot drift.
 */

/**
 * Floor confidence value assigned to a link whose target is reserved
 * by its Provider runtime. Chosen low enough to be visually obvious in
 * the UI (well below the typical 0.5 / 0.8 emit floors) while staying
 * non-zero so the edge keeps rendering, downgraded but visible.
 */
export const RESERVED_TARGET_CONFIDENCE = 0.1;

/**
 * Confidence assigned to a genuinely-broken link (target resolves to
 * nothing: no node path, no name-index entry). Sits ABOVE
 * `RESERVED_TARGET_CONFIDENCE = 0.1` on purpose: a reserved target
 * resolves to a real-but-runtime-ignored file (the subtler trap, flagged
 * most faintly), whereas a broken target merely points at nothing.
 * Below the typical 0.8 / 0.85 / 0.95 emit floors so the dangling edge
 * is visibly demoted, while staying well above reserved.
 */
export const BROKEN_TARGET_CONFIDENCE = 0.5;
