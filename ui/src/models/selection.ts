/**
 * Selection-view bundles shared between the graph view, which computes
 * them (see `app/views/graph-view/selection-state.ts`), and the
 * components that render them (`<sm-node-card>` mounts in the graph,
 * the files view, and prototype harnesses). They live in `models/` so
 * shared components never import from a feature view's internals.
 */

/**
 * Per-node selection state. Three booleans rolled into one record so a
 * Map lookup in the template hands the card host its full selection
 * picture in one shot (instead of N x 3 function calls per CD pass).
 */
export interface ISelectionView {
  readonly selected: boolean;
  readonly highlighted: boolean;
  readonly dimmed: boolean;
}

/**
 * Per-edge selection state. Same shape rationale as `ISelectionView`:
 * one Map lookup hands the `<f-connection>` its full picture per CD
 * pass. `opacity` folds the confidence gradient and the dim override
 * into a single value, so the template binds it directly (inline styles
 * win over the `.f-conn--dimmed` class rule, this is the source of truth).
 */
export interface IEdgeSelectionView {
  readonly highlighted: boolean;
  readonly dimmed: boolean;
  readonly opacity: number;
}
