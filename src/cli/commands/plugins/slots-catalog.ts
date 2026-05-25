/**
 * Closed catalogs surfaced by `sm plugins slots list` and reused as
 * the source of truth for scaffolder hints in `sm plugins create`.
 * Kept in its own module so changing the catalog text doesn't touch
 * either verb's file (and so the catalog stays grep-able as a single
 * place when adding / removing a slot or input-type).
 */

export const VIEW_SLOTS_CATALOG = [
  { id: 'card.title.right', summary: 'Small icon marker next to the card title (language flag, platform glyph).' },
  { id: 'card.subtitle.left', summary: 'Single non-negative integer in the card subtitle row.' },
  { id: 'card.footer.left', summary: 'Counter chip in the left footer of the card.' },
  { id: 'card.footer.right', summary: 'Counter chip in the right footer of the card.' },
  { id: 'graph.node.alert', summary: 'Reserved corner badge on the graph node, special-case signals only. No core analyzer emits here; routine "this node has a problem" findings belong in `card.footer.right`.' },
  { id: 'inspector.header.badge.counter', summary: 'Counter chip in the inspector header badge cluster.' },
  { id: 'inspector.header.badge.tag', summary: 'Qualitative tag chip in the inspector header badge cluster.' },
  { id: 'inspector.body.panel.breakdown', summary: 'Top-N labeled values rendered as a bar chart in the inspector body.' },
  { id: 'inspector.body.panel.records', summary: 'Tabular data (rows × columns ≤ 50 × 6) in the inspector body.' },
  { id: 'inspector.body.panel.tree', summary: 'Recursive label/children hierarchy (depth ≤ 6, total ≤ 200) in the inspector body.' },
  { id: 'inspector.body.panel.key-values', summary: 'Flat key/value pairs (≤ 50) in the inspector body.' },
  { id: 'inspector.body.panel.link-list', summary: 'Clickable scope-relative paths (≤ 100) in the inspector body.' },
  { id: 'inspector.body.panel.markdown', summary: 'Sanitized markdown text (≤ 4096 chars) in the inspector body.' },
  { id: 'topbar.nav.start', summary: 'Scope-wide indicator chip at the start of the topbar nav (before the view-switcher links).' },
] as const;

export const INPUT_TYPES_CATALOG = [
  { id: 'string-list', summary: 'Array of free-form strings.' },
  { id: 'single-string', summary: 'Single text input.' },
  { id: 'boolean-flag', summary: 'On/off toggle.' },
  { id: 'integer', summary: 'Integer with optional bounds.' },
  { id: 'enum-pick', summary: 'Pick one from a closed set.' },
  { id: 'enum-multipick', summary: 'Pick zero or more from a closed set.' },
  { id: 'path-glob', summary: 'Glob pattern (single or multiple).' },
  { id: 'regex', summary: 'ECMAScript regex pattern body.' },
  { id: 'secret', summary: 'Sensitive string (encrypted at rest).' },
  { id: 'key-value-list', summary: 'Editable mapping of strings to strings.' },
] as const;
