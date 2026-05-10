/**
 * Provider visual identity — color + label per Provider id, used to
 * paint the provider chip in the node card subtitle row.
 *
 * Provider identity is intrinsic to a node (the scan classified it via
 * one Provider's `classify()`), not plugin-emitted, so this chip lives
 * as hardcoded card decoration rather than a view-contribution slot
 * emission. The slot system's payload schemas are counter / tag /
 * panel-shaped, none of which fit "string label + provider color"
 * cleanly.
 *
 * Today this map is static and only knows the four built-in Providers
 * (`claude`, `gemini`, `agent-skills`, `markdown`). The day a user
 * plugin contributes its own Provider, the proper fix is to add a `ui`
 * field on `IProvider` (mirroring `kinds[*].ui`), surface it via the
 * BFF, and ingest it into a registry signal the same way
 * `KindRegistryService` already does. The static dictionary here is the
 * pre-spec staging area — when a non-built-in provider id shows up at
 * runtime, the lookup falls back to a neutral gray chip.
 *
 * Unlike kind visuals (normalised across Providers so every `agent`
 * paints the same blue), Provider visuals are deliberately distinct:
 * the chip exists to tell the user at a glance which platform a node
 * came from.
 */

export interface IProviderUi {
  /** Display label rendered inside the chip. */
  label: string;
  /** Light-mode background hex. */
  color: string;
  /** Dark-mode background hex. Falls back to `color` when omitted. */
  colorDark?: string;
}

const REGISTRY: Record<string, IProviderUi> = {
  claude: {
    label: 'Claude',
    color: '#cc785c',
    colorDark: '#e89270',
  },
  gemini: {
    label: 'Gemini',
    color: '#4285f4',
    colorDark: '#669df6',
  },
  'agent-skills': {
    label: 'Open Skills',
    color: '#64748b',
    colorDark: '#94a3b8',
  },
};

/**
 * Providers whose chip stays hidden — `markdown` is the universal
 * fallback Provider, so the majority of nodes in any project carry it.
 * Painting the chip on every generic `.md` would turn into visual noise
 * and dilute the chip's purpose (telling the user at a glance when a
 * node came from a NON-default platform). The chip surfaces only for
 * the vendor-specific Providers.
 */
const HIDDEN = new Set<string>(['markdown']);

const FALLBACK: IProviderUi = {
  label: '',
  color: '#9ca3af',
  colorDark: '#6b7280',
};

/**
 * Return the visual identity for a provider id. Hidden providers (e.g.
 * the universal `markdown` fallback) return `null` so the chip does not
 * render at all. Unknown ids resolve to a neutral gray chip with the
 * raw id as label so user-plugin providers still render something
 * readable while the proper spec-level field is not yet wired through.
 */
export function providerUi(providerId: string | null | undefined): IProviderUi | null {
  if (!providerId) return null;
  if (HIDDEN.has(providerId)) return null;
  const known = REGISTRY[providerId];
  if (known) return known;
  return { ...FALLBACK, label: providerId };
}
