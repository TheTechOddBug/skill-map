/**
 * Canonical accent color per extension kind. Mirrors the palette the
 * marketing site uses in `web/index.html` § "ecosystem" (the Plugin
 * Ecosystem orbital diagram), so the Settings list and the docs site
 * speak the same visual language.
 *
 * The closed set of kinds is fixed by the spec (`IExtensionBase.kind`
 * enum: provider / extractor / rule / action / formatter / hook).
 * Adding a seventh kind is a major spec change; we re-evaluate this
 * map at the same time.
 *
 * Usage from a template:
 *
 *   <span
 *     class="kind-tag"
 *     [style.--kind-color]="kindTint(kind)"
 *   >{{ kind }}</span>
 *
 * Then in CSS, lean on `color-mix` against `var(--kind-color)` so the
 * tag stays legible on both light and dark themes without us shipping
 * two parallel palettes.
 */

export type TExtensionKindForTint =
  | 'provider'
  | 'extractor'
  | 'analyzer'
  | 'action'
  | 'formatter'
  | 'hook';

export const EXTENSION_KIND_TINTS: Record<TExtensionKindForTint, string> = {
  provider: '#7C3AED',  // violet-600, the entry-point kind, deepest of the violets
  extractor: '#A78BFA', // violet-400, sibling of provider, lighter (data flows in)
  analyzer: '#5FD17C',  // green, pass / fail diagnostics
  action: '#00C853',    // bright green, emphasizes the act-on side of analyzers
  formatter: '#5BC0EB', // sky blue, output rendering, neutral information
  hook: '#FFB627',      // amber, lifecycle / event-driven, warm warning hue
};

/**
 * Resolve a kind string to its tint. Unknown kinds (e.g. a plugin
 * declared a kind the spec does not yet model) fall back to the
 * neutral text muted color so the tag still renders without color
 * collisions. Lower-cases the input so callers can pass an extension
 * manifest's `kind` verbatim.
 */
export function kindTint(kind: string): string {
  const key = kind.toLowerCase() as TExtensionKindForTint;
  return EXTENSION_KIND_TINTS[key] ?? 'currentColor';
}
