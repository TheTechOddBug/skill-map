/**
 * UI strings for the markdown pipeline: the image placeholders emitted by
 * `MarkdownRenderer` and activated by `[smMarkdownImages]`.
 *
 * A markdown body is author-controlled, so a rendered `<img>` would fire
 * an outbound request the operator never asked for. The renderer emits a
 * placeholder naming the image and its host instead, and the request only
 * happens once the operator clicks. These strings are what that
 * placeholder says. English-only catalog (externalized texts, see
 * AGENTS.md).
 */
export const MARKDOWN_TEXTS = {
  /**
   * Label for an image whose markdown carries no alt text. Reads as a
   * noun so the accessible name below stays grammatical either way
   * ("Load Image from example.com" / "Load Diagram from example.com").
   */
  imageFallbackLabel: 'Image',
  /**
   * Native tooltip on the interactive placeholder. Names the gesture,
   * the visible chip already names the image and the host.
   */
  imageLoadTooltip: 'Load image',
  /**
   * Accessible name for the placeholder button. Leads with the action
   * (screen-reader users scan the first words of a control) and names
   * BOTH what loads and where the request would go, so the consent is
   * informed before the click.
   */
  imageLoadAriaLabel: (label: string, host: string) => `Load ${label} from ${host}`,
} as const;
