/**
 * Step 11.x — runtime view-contribution catalog types.
 *
 * Lives in its own module (rather than `kernel/index.ts`) so consumers
 * deep inside the kernel — `IAnalyzerContext`, the BFF route factories,
 * future Action contexts — can depend on the catalog shape without
 * dragging the whole kernel barrel and risking a cycle.
 *
 * Mirrors `annotation-catalog.ts` for the annotation contribution side
 * (Step 9.6.6). The two systems share the "plugin contributes data,
 * kernel exposes catalog, UI renders" pattern but never overlap in
 * storage or routing — see `architecture.md` §View contribution system
 * for the comparison table.
 *
 * **Closed catalog by design.** Both `TSlotName` and `TInputTypeName`
 * mirror the closed enums in `spec/schemas/view-slots.schema.json`
 * and `spec/schemas/input-types.schema.json`. Adding a member is a
 * coordinated kernel + spec + UI + scaffolder change. The closed-enum
 * shape lets TypeScript surface unknown slots at author time
 * (in plugin authors' editors when their plugin imports `@skill-map/cli`)
 * AND lets the runtime exhaustively dispatch slot → renderer in the
 * UI without `default:` fallbacks.
 */

/**
 * Closed enum of view slot names. Mirror of
 * `spec/schemas/view-slots.schema.json#/$defs/SlotName`.
 *
 * Plugins pick one of these by name in their extension manifest's
 * `viewContributions[<contributionId>].slot` field. The kernel
 * validates each pick at load time (`invalid-manifest` on miss); the
 * slot fixes both the renderer and the payload shape.
 */
export type TSlotName =
  | 'card.title.right'
  | 'card.subtitle.left'
  | 'card.footer.left'
  | 'card.footer.right'
  | 'graph.node.alert'
  | 'inspector.header.badge.counter'
  | 'inspector.header.badge.tag'
  | 'inspector.body.panel.breakdown'
  | 'inspector.body.panel.records'
  | 'inspector.body.panel.tree'
  | 'inspector.body.panel.key-values'
  | 'inspector.body.panel.link-list'
  | 'inspector.body.panel.markdown'
  | 'topbar.nav.start';

/**
 * Closed enum of input-type names for plugin settings. Mirror of
 * `spec/schemas/input-types.schema.json#/$defs/InputTypeName`.
 *
 * Plugins pick one of these by name in their plugin manifest's
 * `settings[<settingId>].type` field. The kernel exposes the resolved
 * value via `ctx.settings.<settingId>` typed per the input-type's
 * value-type promise.
 */
export type TInputTypeName =
  | 'string-list'
  | 'single-string'
  | 'boolean-flag'
  | 'integer'
  | 'enum-pick'
  | 'enum-multipick'
  | 'path-glob'
  | 'regex'
  | 'secret'
  | 'key-value-list';

/** Closed severity palette aligned with PrimeNG `<p-tag>` / `<p-message>`. */
export type TSeverity = 'info' | 'warn' | 'success' | 'danger';

/**
 * Manifest-side declaration of a single view contribution. The plugin
 * author writes one of these per Record key in
 * `IExtensionBase.viewContributions[<contributionId>]`.
 *
 * Mirror of `view-slots.schema.json#/$defs/IViewContribution`.
 */
export interface IViewContribution {
  /**
   * Required. Closed-catalog slot name. Unknown name rejects the
   * extension as `invalid-manifest` at load. The slot fixes both the
   * renderer and the payload shape; there is no separate "contract"
   * abstraction.
   */
  slot: TSlotName;
  /**
   * Optional human-readable label. English-only per `AGENTS.md`
   * (`Externalized texts, not internationalized`).
   */
  label?: string;
  /** Optional hover tooltip. English-only. */
  tooltip?: string;
  /**
   * Optional emoji codepoint OR PrimeIcons class id (without the
   * `pi-` prefix). The UI discriminates: matches Unicode
   * `\p{Extended_Pictographic}` → emoji text, otherwise → PrimeIcon.
   * Required for counter slots and `card.title.right` (enforced by
   * the manifest-side conditional in `view-slots.schema.json`).
   */
  icon?: string;
  /**
   * Optional empty placeholder text shown when the payload is empty
   * AND `emitWhenEmpty` is true. Falls back to a UI-supplied generic
   * 'No data.' string. English-only.
   */
  emptyText?: string;
  /**
   * When false (default), the kernel drops emissions whose payload is
   * structurally empty so the slot stays silent. When true, the
   * renderer surfaces an empty placeholder. Per-slot definition of
   * "empty" lives in the slot's payload schema.
   */
  emitWhenEmpty?: boolean;
  /**
   * Optional ordering hint (default 100). Slots configured with
   * `order: 'priority'` sort contributions ASC by this value, with
   * alphabetical tie-break by qualified id. The plugin uses this to
   * suggest where its contribution belongs relative to others sharing
   * the same slot — the slot has the final say.
   */
  priority?: number;
}

/**
 * Single row of the runtime view-contribution catalog surfaced by
 * `kernel.getRegisteredViewContributions()`. One row per
 * `(pluginId × extensionId × contributionId)` tuple. Composed at boot
 * by `loadPluginRuntime` from every loaded extension's
 * `viewContributions` map.
 *
 * The qualified id is `<pluginId>/<extensionId>/<contributionId>` —
 * matches the qualified id pattern used elsewhere in the kernel
 * (`<pluginId>/<extensionId>` for extensions; this adds the third
 * segment for per-contribution identity).
 */
export interface IRegisteredViewContribution {
  pluginId: string;
  extensionId: string;
  contributionId: string;
  slot: TSlotName;
  /** Optional manifest-declared label (English-only). */
  label?: string;
  tooltip?: string;
  icon?: string;
  emptyText?: string;
  emitWhenEmpty: boolean;
  /** Manifest-declared ordering hint (default 100). See `IViewContribution.priority`. */
  priority?: number;
}

/**
 * Common fields on every setting declaration. The discriminated union
 * `ISettingDeclaration` extends one of these per `type` value.
 */
interface ISettingCommon {
  /** Required. Short human-readable label. English-only. */
  label: string;
  /** Optional helper text shown below the control. English-only. */
  description?: string;
}

export interface ISetting_StringList extends ISettingCommon {
  type: 'string-list';
  default?: string[];
  min?: number;
  max?: number;
  itemMaxLength?: number;
}

export interface ISetting_SingleString extends ISettingCommon {
  type: 'single-string';
  default?: string;
  minLength?: number;
  maxLength?: number;
  /** Optional ECMAScript regex pattern (no flags). */
  pattern?: string;
}

export interface ISetting_BooleanFlag extends ISettingCommon {
  type: 'boolean-flag';
  default?: boolean;
}

export interface ISetting_Integer extends ISettingCommon {
  type: 'integer';
  default?: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface ISetting_EnumOption {
  value: string;
  label: string;
}

export interface ISetting_EnumPick extends ISettingCommon {
  type: 'enum-pick';
  options: ISetting_EnumOption[];
  default?: string;
}

export interface ISetting_EnumMultipick extends ISettingCommon {
  type: 'enum-multipick';
  options: ISetting_EnumOption[];
  default?: string[];
  min?: number;
  max?: number;
}

export interface ISetting_PathGlob extends ISettingCommon {
  type: 'path-glob';
  default?: string;
  /** When true, accepts string[]; when false (default), single string. */
  multiple?: boolean;
}

export interface ISetting_Regex extends ISettingCommon {
  type: 'regex';
  default?: string;
  /** Subset of `gimsuy`. Default `''`. */
  flags?: string;
}

export interface ISetting_Secret extends ISettingCommon {
  type: 'secret';
  /**
   * Optional uppercase-ASCII identifier. When set in the process
   * environment, that value wins over any stored value (lets CI
   * inject without writing to disk).
   */
  envVar?: string;
}

export interface ISetting_KeyValueListEntry {
  key: string;
  value: string;
}

export interface ISetting_KeyValueList extends ISettingCommon {
  type: 'key-value-list';
  keyLabel?: string;
  valueLabel?: string;
  default?: ISetting_KeyValueListEntry[];
  min?: number;
  max?: number;
}

/**
 * Discriminated union of every setting declaration shape. The plugin
 * author NEVER writes JSON Schema for settings — they pick one of
 * these `type` values and supply per-type parameters.
 *
 * Mirror of `input-types.schema.json#/$defs/ISettingDeclaration`.
 */
export type ISettingDeclaration =
  | ISetting_StringList
  | ISetting_SingleString
  | ISetting_BooleanFlag
  | ISetting_Integer
  | ISetting_EnumPick
  | ISetting_EnumMultipick
  | ISetting_PathGlob
  | ISetting_Regex
  | ISetting_Secret
  | ISetting_KeyValueList;

/**
 * Runtime value type for a setting, derived from its declaration. The
 * kernel exposes settings to extractors as `Record<string, TSettingValue>`
 * via `ctx.settings.<settingId>`; consumers that want narrow typing
 * narrow at the call site by reading `manifest.settings[id].type`.
 */
export type TSettingValue =
  | string
  | string[]
  | boolean
  | number
  | ISetting_KeyValueListEntry[];
