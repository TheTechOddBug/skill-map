/**
 * Clipboard write helper shared by every click-to-copy affordance in the
 * UI (the inspector's path chip and its debug-panel hash cells today).
 *
 * The Clipboard API needs a secure context (https / localhost) and can be
 * denied by the user, so a failed write is non-actionable from the user's
 * perspective: the helper swallows the rejection and reports `false`, and
 * callers simply skip their "Copied" confirmation. Pure function, no
 * Angular deps, so it stays usable from components, services and specs
 * alike.
 */

/** Milliseconds a "Copied" confirmation stays up after a successful write. */
export const COPIED_FEEDBACK_MS = 2000;

/** Writes `value` to the clipboard. Returns `true` when the write landed. */
export async function copyToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Clipboard write blocked (insecure context / denied permission). No-op.
    return false;
  }
}
