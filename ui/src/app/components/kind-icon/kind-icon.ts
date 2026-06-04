import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import type { TNodeKind } from '../../../models/node';
import { KindRegistryService } from '../../../services/kind-registry';

/**
 * Kind icon, renders the canonical glyph for a node kind. Single source
 * of iconography for the app: graph nodes (`<sm-node-card>`) and the
 * filter toolbar (`<sm-kind-palette>`) both consume it so the visual
 * vocabulary is consistent.
 *
 * Step 14.5.d: the icon descriptor comes from the runtime
 * `KindRegistryService` (Provider-declared `ui.icon` on `IProviderKind`)
 * instead of a hardcoded `@switch` over closed kind names. The fallback
 * chain is: PrimeIcons class → SVG path → emoji → first letter of label.
 * SVG paths inherit `currentColor` so kind-tinting comes from the host.
 *
 * Per-provider resolution: when `provider` is supplied, the icon is
 * looked up under `kindRegistry.lookup(kind).providers[provider]` so a
 * Gemini-sourced agent paints with Gemini's icon while a Claude-sourced
 * agent paints with Claude's, even though both share the `agent` kind.
 * Surfaces that aggregate across providers (e.g. the kind palette
 * filter) omit `provider` and fall through to the primary's icon.
 */
type TIconVariant = 'pi' | 'svg' | 'emoji' | 'letter';

@Component({
  selector: 'sm-kind-icon',
  imports: [],
  templateUrl: './kind-icon.html',
  styleUrl: './kind-icon.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KindIcon {
  private readonly kindRegistry = inject(KindRegistryService);

  readonly kind = input.required<TNodeKind>();
  /**
   * Pixel size, drives both the font-size (pi / emoji / letter variants)
   * and the SVG width/height. The recommended scale today is 14, 16, 18,
   * 20, 24 (sm, md default, lg, xl). New callers should stay on this
   * scale; a future token enum is intentionally deferred while the size
   * range stays narrow (the SVG branch needs numeric dimensions anyway).
   */
  readonly size = input<number>(18);
  /**
   * Optional Provider id. When set and the kind's registry entry carries
   * a contribution from that Provider with its own `icon` (or `emoji`),
   * the per-Provider visual wins. When omitted, or the Provider is not
   * registered for this kind, or the Provider declared neither `icon`
   * nor `emoji`, the primary Provider's icon is used (legacy behaviour).
   */
  readonly provider = input<string | null | undefined>(null);

  /**
   * Kind dictates the visual, provider does NOT. Always returns the
   * primary-flattened entry, so every agent (Claude, OpenAI, future
   * vendors) paints with the same `pi-user` glyph, every skill with
   * `pi-bolt`, every command with the arrow, etc. The `provider`
   * input above is kept for backward compatibility (and so per-provider
   * surfaces like the legacy "claude vs gemini agent" experiment can
   * be re-introduced if the spec ever flips back), but the resolver
   * intentionally ignores it. Same principle as the node card not
   * painting a per-provider accent: provider identity surfaces via the
   * subtitle chip, not via icon / colour overrides that fight the kind
   * visual.
   */
  private readonly resolvedUi = computed(() => {
    return this.kindRegistry.lookup(this.kind());
  });

  protected readonly variant = computed<TIconVariant>(() => {
    const ui = this.resolvedUi();
    if (ui?.icon?.kind === 'pi') return 'pi';
    if (ui?.icon?.kind === 'svg') return 'svg';
    if (ui?.emoji) return 'emoji';
    return 'letter';
  });

  protected readonly piClass = computed<string>(() => {
    const icon = this.resolvedUi()?.icon;
    return icon?.kind === 'pi' ? `pi ${icon.id}` : '';
  });

  protected readonly svgPath = computed<string>(() => {
    const icon = this.resolvedUi()?.icon;
    return icon?.kind === 'svg' ? icon.path : '';
  });

  protected readonly emoji = computed<string>(() => {
    return this.resolvedUi()?.emoji ?? '';
  });

  protected readonly letter = computed<string>(() => {
    const label = this.kindRegistry.labelOf(this.kind());
    return label.charAt(0).toUpperCase();
  });
}
