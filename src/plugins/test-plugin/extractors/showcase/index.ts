/**
 * `test-plugin/showcase`, the settings SHOWCASE extension: one
 * declaration per input-type in the closed catalog
 * (`spec/schemas/input-types.schema.json`), so every control can be
 * exercised end to end, the Settings form widget, the CLI write forms
 * (`sm plugins config test-plugin/showcase <id> <value>`), the kernel
 * resolver's per-type validation, and the storage routing (the `secret`
 * lands in `settings.local.json`; everything else in the committed
 * layer).
 *
 * Ships `defaultEnabled: false` (the deliberate-opt-in override, spec
 * `base.schema.json#/properties/defaultEnabled`): DISABLED by default
 * without the `experimental` maturity badge, since there is nothing
 * immature about it, it is just not meant to run unless the operator is
 * here to poke at the controls. Enable with
 * `sm plugins enable test-plugin/showcase` to surface its section in
 * Settings. The extractor body is a deliberate no-op: the DECLARATIONS
 * are the product, nothing is ever emitted into the graph.
 *
 * A companion spec asserts the settings block covers EVERY catalog
 * member, so adding a 13th input-type fails the suite until the
 * showcase (and therefore the operator-visible test surface) learns it.
 */

import type { IBuiltInManifest, IExtractor } from '../../../../kernel/extensions/index.js';
import type { TSettingDeclaration } from '../../../../kernel/types/view-catalog.js';
import { TEST_PLUGIN_PLUGIN_ID } from '../../../ids.js';

const settings = {
  'sample-string': {
    type: 'single-string',
    label: 'Sample string',
    description: 'Single text input with a length cap.',
    default: 'hello',
    maxLength: 64,
  },
  'sample-string-list': {
    type: 'string-list',
    label: 'Sample string list',
    description: 'Free-form tags; each item capped at 32 characters.',
    default: ['alpha', 'beta'],
    itemMaxLength: 32,
  },
  'sample-flag': {
    type: 'boolean-flag',
    label: 'Sample flag',
    description: 'Plain on/off toggle.',
    default: true,
  },
  'sample-integer': {
    type: 'integer',
    label: 'Sample integer',
    description: 'Whole number between 0 and 10.',
    default: 3,
    min: 0,
    max: 10,
    step: 1,
  },
  'sample-number': {
    type: 'number',
    label: 'Sample number',
    description: 'Decimal between 0 and 1.',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.05,
  },
  'sample-pick': {
    type: 'enum-pick',
    label: 'Sample pick',
    description: 'Exactly one of a closed set.',
    options: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
    default: 'medium',
  },
  'sample-multipick': {
    type: 'enum-multipick',
    label: 'Sample multipick',
    description: 'Zero or more of a closed set.',
    options: [
      { value: 'red', label: 'Red' },
      { value: 'green', label: 'Green' },
      { value: 'blue', label: 'Blue' },
    ],
    default: ['red'],
  },
  'sample-globs': {
    type: 'path-glob',
    label: 'Sample globs',
    description: 'Gitignore-style patterns; multiple entries render as chips.',
    multiple: true,
  },
  'sample-regex': {
    type: 'regex',
    label: 'Sample regex',
    description: 'ECMAScript pattern body, compiled with the i flag.',
    default: '^draft-',
    flags: 'i',
  },
  'sample-secret': {
    type: 'secret',
    label: 'Sample secret',
    description:
      'Stored project-local only, redacted everywhere; TEST_PLUGIN_TOKEN overrides it from the environment.',
    envVar: 'TEST_PLUGIN_TOKEN',
  },
  'sample-pairs': {
    type: 'key-value-list',
    label: 'Sample pairs',
    description: 'Editable string-to-string mapping.',
    keyLabel: 'Header',
    valueLabel: 'Value',
    default: [{ key: 'x-demo', value: 'on' }],
  },
  'sample-matches': {
    type: 'match-list',
    label: 'Sample matches',
    description: 'Mixed ignore list: exact values, regexes, and globs.',
    default: [{ type: 'literal', value: 'ignore-me.md' }],
  },
} satisfies Record<string, TSettingDeclaration>;

export const showcaseExtractor: IBuiltInManifest<IExtractor> = {
  id: 'showcase',
  pluginId: TEST_PLUGIN_PLUGIN_ID,
  kind: 'extractor',
  description:
    'Declares one setting per input-type in the closed catalog so every control can be exercised. Emits nothing into the graph. Example: enable it, open Settings, and every widget (chips, sliders, match rows) renders with live validation.',
  scope: 'body',
  defaultEnabled: false,
  settings,

  extract(): void {
    // Deliberate no-op: the declarations above are the product. The
    // resolver still validates and delivers `ctx.settings` when enabled,
    // which is exactly what the operator is here to poke at.
  },
};

export default showcaseExtractor;
