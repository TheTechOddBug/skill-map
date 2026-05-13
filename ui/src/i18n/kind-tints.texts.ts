/**
 * Developer-facing error messages for `deriveTints()` (kind-tints.ts).
 * Mirrors the catalog pattern used by `WS_TEXTS` / `UPDATE_CHECK_TEXTS`:
 * developer-only output, English-only per AGENTS.md.
 */
export const KIND_TINTS_TEXTS = {
  invalidHex: (hex: string): string =>
    `deriveTints: invalid hex color "${hex}" (expected #RRGGBB)`,
} as const;
