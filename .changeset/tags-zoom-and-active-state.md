---
"@skill-map/cli": minor
---

Tags · zoom-to-matching on click + active chip indicator + side-panel-aware fit.

Three follow-ups on the Foblex multi-select tag UX (`8577563`).

**1) Zoom + pan to the matching set**

Clicking a tag chip now also drives the canvas viewport to fit the bounding box of the matching nodes. Foblex doesn't expose a "fit subset" API (`fitToScreen` fits everything, `centerGroupOrNode` centers ONE id), so the math lives inline:

- Bounding box from the layout cache positions (top-left) plus an approximate node size (260 × 120 — width is fixed, height is the unexpanded average).
- Scale = `min(availW / bboxW, availH / bboxH)`, clamped to `[ZOOM_MIN, TAG_FIT_MAX_ZOOM]` where `TAG_FIT_MAX_ZOOM = 2`. Soft cap below `ZOOM_MAX = 4` so a single-match tag doesn't catapult one card to fill the whole screen.
- Center: bbox centroid mapped to the visible-area centroid (see (3) below for the panel-aware part).
- Animated tween: cubic ease-out over 320ms via `requestAnimationFrame`. Token-based cancellation (`viewportAnimToken`) so back-to-back tag clicks don't fight each other — the latest call wins, prior in-flight loops abort on their next frame.

The viewport snapshot taken on the FIRST tag activation (`viewportBeforeTagSelect`) is restored on toggle clear (clicking the same chip again) — the user lands back on the pan/zoom they were on before the zoom-to-matching jump. Tag-to-tag swaps don't overwrite the snapshot, so a long chain of swaps still restores the original on final clear.

**2) Active chip visual in the inspector**

The chip whose tag drives the current Foblex selection now renders in an "active" visual state: solid primary fill, white label, 2px ring. Wires through:

- `graph-view.ts` exposes `activeTagSelection` as `protected` so the template can bind it.
- `graph-view.html` passes `[activeTag]="activeTagSelection()"` to `<app-inspector-view>`.
- `inspector-view` adds the `activeTag` input and forwards it to `<sm-annotations-panel>` as `[activeTag]`.
- `annotations-panel` adds the input + `isActiveTag(t)` helper. Template appends `ann-panel__chip--active` to `[styleClass]` when matching.
- New CSS rule paints `--active`: `background: var(--p-primary-color)`, `color: var(--p-primary-color-text, white)`, ring shadow.

A tag present in both author and user sources (e.g. `angular` in `frontend-old.sm`, `reference` in `kitchen-sink.sm`) lights up BOTH chip variants because the click semantic is union by tag string. Reflects the selection truthfully — both attributions of the tag are part of what's selected.

**3) Side-panel-aware fit**

Reported visual issue: when the inspector panel is open, matching nodes could land underneath it because the fit math assumed the full canvas wrap was visible. Fixed by subtracting `clampedPanelWidth()` from the available width when `selectedNodeId() !== null`, and centring the bbox horizontally in the VISIBLE half (`visibleW / 2`) rather than the geometric centre of the wrap. Panel closed ⇒ `panelW = 0` ⇒ original behaviour.

Pre-1.0 minor bump per `spec/versioning.md` § Pre-1.0.
