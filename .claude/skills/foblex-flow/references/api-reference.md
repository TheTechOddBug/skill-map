# Foblex Flow

> Angular-native node-based UI library for building node editors, workflow builders, and interactive graph interfaces.

Curated API reference for `@foblex/flow`, the graph visualization layer used by the [`ui/`](../ui/) workspace. This file is maintained because upstream documentation is sparse. See [`AGENTS.md`](../AGENTS.md) §Operating rules (Code quality, "No hacks, read the official docs first") for when to consult this file. The graph-view component that consumes this API lives at [`ui/src/app/views/graph-view/`](../ui/src/app/views/graph-view/).

Foblex Flow is an Angular-first library that provides rendering, connectors, interactions, selection, zoom, and connection drawing for graph-based UIs. Your application owns the graph state — Foblex Flow handles the visual layer and user interactions.

- Version: 19.1.2 (installed; migrated from 18.6.1)
- Angular compatibility: 17.3+
- License: MIT
- Documentation: https://flow.foblex.com
- Repository: https://github.com/Foblex/f-flow
- NPM: https://www.npmjs.com/package/@foblex/flow

## Installation

```bash
ng add @foblex/flow
```

For Nx workspaces:

```bash
nx g @foblex/flow:add
```

Manual installation:

```bash
npm install @foblex/flow @foblex/platform@^1.0.4 @foblex/mediator@^1.1.3 @foblex/2d@^1.2.2 @foblex/utils@^1.1.1
```

Include the default theme in angular.json:

```json
"styles": [
  "src/styles.scss",
  "node_modules/@foblex/flow/styles/default.scss"
]
```

**Monorepo / npm workspaces note**: if `@foblex/flow` hoists to a parent `node_modules/` (as in this repo), the Angular workspace can't resolve the literal `node_modules/...` path, and the package's `exports` field blocks the package-resolution form (`@foblex/flow/styles/default.scss`). Use a relative filesystem path that bypasses exports:

```json
"styles": [
  "../node_modules/@foblex/flow/styles/default.scss",
  "src/styles.css"
]
```

## Core Mental Model

- The library does NOT own your graph state.
- Your app owns nodes, groups, connections, ids, validation, and persistence.
- Angular templates render the current state.
- User actions emit events from fDraggable or model outputs.
- Your app updates state, Angular rerenders.
- Connections are connector-to-connector (fSourceId → fTargetId, matching fConnectorId values), not generic node-to-node edges.
- Do NOT assume React Flow style APIs such as [nodes], [edges], setNodes(), addEdge().
- v19 unified the connector model: one `[fConnector]` directive (role via `fConnectorType`) replaces the legacy `fNodeInput` / `fNodeOutput` / `fNodeOutlet` directives, and connector ids live in ONE registry (no separate input/output namespaces). Legacy directives and legacy `f-connection` input names remain functional but deprecated.

## Minimal Working Example

```html
<f-flow fDraggable>
  <f-canvas>
    <f-connection fSourceId="node1" fTargetId="node2"></f-connection>

    <div fNode fDragHandle [fNodePosition]="{ x: 24, y: 24 }"
         fConnector fConnectorType="source" fConnectorId="node1">
      Source Node
    </div>

    <div fNode fDragHandle [fNodePosition]="{ x: 244, y: 24 }"
         fConnector fConnectorType="target" fConnectorId="node2">
      Target Node
    </div>
  </f-canvas>
</f-flow>
```

```typescript
import { Component } from '@angular/core';
import { FFlowModule } from '@foblex/flow';

@Component({
  selector: 'app-my-flow',
  standalone: true,
  imports: [FFlowModule],
  templateUrl: './my-flow.component.html',
})
export class MyFlowComponent {}
```

## API Reference

### f-flow (FFlowComponent)

Root container required for every diagram. Bootstraps runtime and provides integration point for all extensions.

Selector: `f-flow`

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| fFlowId | InputSignal\<string\> | f-flow-{id} | Unique flow identifier |

#### Outputs

| Output | Type | Description |
|--------|------|-------------|
| fNodesRendered | OutputEmitterRef\<string\> | Emits when render cycle finishes nodes/groups |
| fFullRendered | OutputEmitterRef\<string\> | Emits after full render including connections |
| fLoaded | OutputEmitterRef\<string\> | Deprecated alias for fFullRendered |

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| redraw | redraw(): void | Force redraw of nodes and connections |
| reset | reset(): void | Resets internal state; re-emits on next render |
| getNodesBoundingBox | getNodesBoundingBox(): IRect \| null | Returns bounding box of all nodes/groups |
| getSelection | getSelection(): ICurrentSelection | Returns selected node/group/connection ids |
| getPositionInFlow | getPositionInFlow(position: IPoint): IRect | Converts viewport point to flow coordinates |
| getState | getState(): IFFlowState | Exports full flow state |
| selectAll | selectAll(): void | Selects all items |
| select | select(nodesAndGroups: string[], connections: string[], isSelectedChanged?: boolean): void | Selects specific items |
| clearSelection | clearSelection(): void | Clears all selection |

#### CSS Classes

`.f-component`, `.f-flow`

---

### f-canvas (FCanvasComponent)

Viewport layer that applies pan and zoom transforms. All diagram content must be inside f-canvas.

Selector: `f-canvas`

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| position | InputSignal\<IPoint\> | { x: 0, y: 0 } | Canvas pan position |
| scale | InputSignal\<number\> | 1 | Canvas zoom scale |
| debounceTime | InputSignal\<number\> | 0 | Debounce ms for fCanvasChange |

#### Outputs

| Output | Type | Description |
|--------|------|-------------|
| fCanvasChange | OutputEmitterRef\<FCanvasChangeEvent\> | Emits on position or scale change |

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| redraw | redraw(): void | Force immediate redraw |
| getPosition | getPosition(): IPoint | Get current pan position |
| setPosition | **Removed in 18.6** (now internal `_setPosition`) | Was: set pan position. Drive the `[position]` input signal instead (see SKILL.md "Persisted viewport"). |
| getScale | getScale(): number | Get current zoom scale |
| setScale | setScale(scale: number, toPosition?: IPoint): void | Set zoom with optional pivot point |
| resetScale | resetScale(): void | Reset zoom to 1 |
| resetScaleAndCenter | resetScaleAndCenter(animated?: boolean): void | Reset zoom and center content |
| fitToScreen | fitToScreen(padding?: IPoint, animated?: boolean): void | Fit all content in viewport |
| centerGroupOrNode | centerGroupOrNode(id: string, animated?: boolean): void | Center on a specific item |

#### CSS Classes

`.f-canvas`, `.f-connections-container`, `.f-canvas-dragging`

---

### fNode (FNodeDirective)

Turns an HTML element into a draggable, selectable node. Apply as an attribute directive.

Selector: `[fNode]`

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| fNodeId | InputSignal\<string\> | f-node-{id} | Unique node identifier |
| fNodeParentId | InputSignal\<string \| null\> | null | Parent group/node id for hierarchy |
| fNodePosition | ModelSignal\<IPoint\> | { x: 0, y: 0 } | Node position in flow coordinates |
| fNodeSize | InputSignal\<ISize \| undefined\> | undefined | Optional fixed size override |
| fNodeRotate | ModelSignal\<number\> | 0 | Rotation angle in degrees |
| fConnectOnNode | InputSignal\<boolean\> | true | Allow connection drop on node body |
| fMinimapClass | InputSignal\<string \| string[]\> | '' | Extra CSS classes for minimap representation |
| fNodeDraggingDisabled | InputSignal\<boolean\> | false | Disable node dragging |
| fNodeSelectionDisabled | InputSignal\<boolean\> | false | Disable node selection |
| fIncludePadding | InputSignal\<boolean\> | true | Include CSS padding in bounds calculation |
| fAutoExpandOnChildHit | InputSignal\<boolean\> | false | Auto-expand parent when child dragged inside |
| fAutoSizeToFitChildren | InputSignal\<boolean\> | false | Auto-resize to fit all child nodes |

#### Outputs

| Output | Type | Description |
|--------|------|-------------|
| fNodePositionChange | OutputEmitterRef\<IPoint\> | Emits when position is finalized after drag |
| fNodeRotateChange | OutputEmitterRef\<number\> | Emits when rotation is finalized |
| fNodeSizeChange | OutputEmitterRef\<IRect\> | Emits when size is finalized after resize |

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| refresh | refresh(): void | Force geometry recalculation |

#### CSS Classes

`.f-node`, `.f-selected`, `.f-node-dragging-disabled`, `.f-node-selection-disabled`

---

### fGroup (FGroupDirective)

Container element for organizing nodes. Behaves like a node with position, size, rotation, selection, and drag.

Selector: `[fGroup]`

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| fGroupId | string | f-group-{id} | Unique group identifier |
| fGroupParentId | string \| null | null | Parent group/node id |
| fGroupPosition | IPoint | { x: 0, y: 0 } | Group position (model binding) |
| fGroupSize | ISize | undefined | Container size |
| fGroupRotate | number | 0 | Rotation degrees (model binding) |
| fConnectOnNode | boolean | true | Allow connection drop on group |
| fMinimapClass | string \| string[] | '' | CSS classes for minimap |
| fGroupDraggingDisabled | boolean | false | Disable group dragging |
| fGroupSelectionDisabled | boolean | false | Disable group selection |
| fIncludePadding | boolean | true | Include padding in bounds |
| fAutoExpandOnChildHit | boolean | false | Auto-expand on child drag |
| fAutoSizeToFitChildren | boolean | false | Auto-resize to fit children |

#### Outputs

| Output | Type | Description |
|--------|------|-------------|
| fGroupPositionChange | OutputEmitterRef\<IPoint\> | Position finalized |
| fGroupRotateChange | OutputEmitterRef\<number\> | Rotation finalized |
| fGroupSizeChange | OutputEmitterRef\<IRect\> | Size finalized |

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| refresh | refresh(): void | Force geometry recalculation |

#### CSS Classes

`.f-group`, `.f-selected`, `.f-group-dragging-disabled`, `.f-group-selection-disabled`

---

### fConnector (FConnectorDirective), the v19 unified connector

Marks an element as a connector. Replaces the legacy `fNodeInput` / `fNodeOutput` / `fNodeOutlet` directives with a single directive whose role is chosen by `fConnectorType`. A connector has exactly ONE id, registered in one flow-wide registry (no separate input/output namespaces); `<f-connection>` references it via `fSourceId` / `fTargetId`. Must live inside a `[fNode]` / `[fGroup]`; the same-element pattern (directive on the node host itself) is what skill-map uses.

Selector: `[fConnector]`

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| fConnectorId | InputSignal\<string\> | generated | Unique connector id (one registry for all roles) |
| fConnectorType | InputSignal\<FConnectorType\> | 'source-target' | Role: 'source' \| 'target' \| 'source-target' \| 'outlet' |
| fConnectorConnectableSide | EFConnectableSide | AUTO | Preferred dock side (auto/top/right/bottom/left/calculate variants) |
| fConnectorMultiple | InputSignal\<boolean\> | true | Allow multiple connections. NOTE: legacy outputs defaulted to single (`fOutputMultiple: false`) |
| fConnectorDisabled | InputSignal\<boolean\> | false | Disable this connector for new connections |
| fConnectorSelfConnectable | boolean | true | Allow a connection to start and end on the same node |
| fConnectorCategory | InputSignal\<string \| undefined\> | undefined | Category matched by source connection limits |
| fCanBeConnectedTo | InputSignal\<string[]\> | [] | Allow-list of target connector ids or categories (replaces legacy `fCanBeConnectedInputs`) |
| fConnectionFromOutlet | InputSignal\<boolean\> | false | Outlet-only: draw the preview from the outlet rect (the emitted `sourceId` is still the resolved real source connector) |

`fConnectorType` semantics: `source` can start a connection and be used as `fSourceId`; `target` can accept one and be used as `fTargetId`; `source-target` (default) makes one id serve both roles; `outlet` is a shared start surface that delegates to the node's real source connectors.

#### CSS Classes

`.f-component`, `.f-connector`, role classes `.f-connector-source` / `.f-connector-target` / `.f-connector-source-target` / `.f-connector-outlet`, state classes `.f-connector-multiple`, `.f-connector-disabled`, `.f-connector-connectable`. Host also carries `data-f-connector-id` and `data-f-connector-type` attributes.

---

### fNodeOutput (FNodeOutputDirective)

**Deprecated since v19, still functional.** Use `[fConnector]` with `fConnectorType="source"`.

Marks an element as an output connector — the source endpoint for connections.

Selector: `[fNodeOutput]`

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| fOutputId | InputSignal\<string\> | f-node-output-{id} | Unique connector id |
| fOutputMultiple | boolean | false | Allow multiple outgoing connections |
| fOutputDisabled | boolean | false | Disable this connector |
| fOutputConnectableSide | EFConnectableSide | AUTO | Preferred dock side (auto/top/right/bottom/left) |
| isSelfConnectable | boolean | true | Allow same-node connection |
| fCanBeConnectedInputs | string[] | [] | Allow-list of target input ids or categories |

#### CSS Classes

`.f-node-output`, `.f-node-output-multiple`, `.f-node-output-disabled`, `.f-node-output-self-connectable`, `.f-node-output-connected`, `.f-node-output-not-connectable`

---

### fNodeInput (FNodeInputDirective)

**Deprecated since v19, still functional.** Use `[fConnector]` with `fConnectorType="target"`.

Marks an element as an input connector — the target endpoint for connections.

Selector: `[fNodeInput]`

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| fInputId | InputSignal\<string\> | f-node-input-{id} | Unique connector id |
| fInputCategory | InputSignal\<string \| undefined\> | undefined | Optional category for connection rules |
| fInputMultiple | InputSignal\<boolean\> | true | Allow multiple incoming connections |
| fInputDisabled | InputSignal\<boolean\> | false | Disable this connector |
| fInputConnectableSide | EFConnectableSide | AUTO | Preferred dock side |

#### CSS Classes

`.f-node-input`, `.f-node-input-multiple`, `.f-node-input-disabled`, `.f-node-input-connected`, `.f-node-input-not-connectable`

---

### fNodeOutlet (FNodeOutletDirective)

**Deprecated since v19, still functional.** Use `[fConnector]` with `fConnectorType="outlet"`.

Single shared start-connection point for nodes with multiple outputs.

Selector: `[fNodeOutlet]`

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| fOutletId | string | f-node-outlet-{id} | Unique outlet id |
| fOutletDisabled | boolean | false | Disable interactions |
| isConnectionFromOutlet | boolean | false | Draw line from outlet edge |
| fCanBeConnectedInputs | string[] | [] | Allow-list of targets |

#### CSS Classes

`.f-node-outlet`, `.f-node-outlet-disabled`

---

### f-connection (FConnectionComponent)

Renders an SVG connection edge between a source output and a target input.

Selector: `f-connection`

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| fConnectionId | InputSignal\<string\> | f-connection-{id} | Unique connection id |
| fSourceId | InputSignal\<string\> | required | Source connector id (a registered `fConnectorId`) |
| fTargetId | InputSignal\<string\> | required | Target connector id (a registered `fConnectorId`) |
| fSourceSide | InputSignal\<EFConnectionConnectableSide\> | DEFAULT | Side the connection leaves the source connector from |
| fTargetSide | InputSignal\<EFConnectionConnectableSide\> | DEFAULT | Side the connection enters the target connector from |
| fOutputId | InputSignal\<string\> | — | Deprecated since v19, still functional. Use `fSourceId` |
| fInputId | InputSignal\<string\> | — | Deprecated since v19, still functional. Use `fTargetId` |
| fOutputSide | InputSignal\<EFConnectionConnectableSide\> | — | Deprecated since v19, still functional. Use `fSourceSide` |
| fInputSide | InputSignal\<EFConnectionConnectableSide\> | — | Deprecated since v19, still functional. Use `fTargetSide` |
| fReassignDisabled | InputSignal\<boolean\> | false | Disable drag-to-reassign |
| fSelectionDisabled | InputSignal\<boolean\> | false | Disable selection |
| fBehavior | InputSignal\<EFConnectionBehavior\> | FIXED | Connection behavior (FIXED or FLOATING) |
| fType | InputSignal\<EFConnectionType \| string\> | STRAIGHT | Visual type (STRAIGHT, BEZIER, SEGMENT) |
| fOffset | InputSignal\<number\> | 12 | Min straight length before curve |
| fRadius | InputSignal\<number\> | 8 | Radius for rounded corners |
| fReassignableStart | InputSignal\<boolean\> | false | Enable start-end reassignment |

#### Content Projection

- `f-connection-gradient` — Projected gradient for stroke colors
- `f-connection-waypoints` — Editable intermediate points
- `f-connection-marker-arrow` / `f-connection-marker-circle` — SVG markers

#### CSS Classes

`.f-connection`, `.f-selected`, `.f-connection-selection-disabled`, `.f-connection-reassign-disabled`, `.f-connection-path`, `.f-connection-selection`, `.f-connection-drag-handle`, `.f-connection-content`

---

### f-connection-for-create (FConnectionForCreateComponent)

Preview line shown during drag-to-create interaction.

Selector: `f-connection-for-create`

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| fRadius | number | 8 | Corner radius |
| fOffset | number | 12 | Distance from connector |
| fBehavior | EFConnectionBehavior | FIXED | Connection behavior |
| fType | EFConnectionType | STRAIGHT | Visual type |
| fInputSide | EFConnectionConnectableSide | DEFAULT | Input side hint |
| fOutputSide | EFConnectionConnectableSide | DEFAULT | Output side hint |

---

### f-snap-connection (FSnapConnectionComponent)

Temporary snap helper shown during connection create/reassign when near a valid target.

Selector: `f-snap-connection`

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| fSnapThreshold | number | 20 | Snap activation distance in pixels |
| fRadius | number | 8 | Corner radius |
| fOffset | number | 12 | Distance from connector |
| fBehavior | EFConnectionBehavior | FIXED | Connection behavior |
| fType | EFConnectionType | STRAIGHT | Visual type |

---

### f-connection-waypoints (FConnectionWaypoints)

Adds editable intermediate bend points to a connection path.

Selector: `f-connection-waypoints`

Must be projected inside `f-connection`.

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| radius | number | 4 | Waypoint circle radius |
| waypoints | IPoint[] | [] | Two-way binding for waypoint positions |
| visibility | boolean | true | Toggle waypoint visibility |

#### Outputs

| Output | Type | Description |
|--------|------|-------------|
| waypointsChange | EventEmitter\<IPoint[]\> | Two-way binding output |

#### CSS Classes

`.f-connection-waypoints`, `.f-candidate`, `.f-waypoint`

---

### Connection Markers

Built-in SVG markers for connection endpoints.

Components: `f-connection-marker-arrow`, `f-connection-marker-circle`

Custom marker directive: `svg[fMarker]`

#### Inputs (all markers)

| Input | Type | Description |
|-------|------|-------------|
| type | EFMarkerType \| string | Marker position: START, END, SELECTED_START, SELECTED_END, START_ALL_STATES, END_ALL_STATES |

Custom SVG markers also accept: `width`, `height`, `refX`, `refY`, `orient`, `markerUnits`

---

### fDraggable (FDraggableDirective)

Enables all pointer interactions: node drag, canvas pan, connection create/reassign, selection, external item drop.

Selector: `f-flow[fDraggable]`

Must be placed on the `f-flow` element.

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| fDraggableDisabled | boolean | false | Disable all interactions |
| fMultiSelectTrigger | FEventTrigger | Ctrl/Cmd key | Predicate for multi-select |
| fReassignConnectionTrigger | FEventTrigger | always | Predicate for connection reassign |
| fCreateConnectionTrigger | FEventTrigger | always | Predicate for connection create |
| fConnectionWaypointsTrigger | FEventTrigger | always | Predicate for waypoint manipulation |
| fMoveControlPointTrigger | FEventTrigger | always | Predicate for bezier control points |
| fNodeResizeTrigger | FEventTrigger | always | Predicate for node resize |
| fNodeRotateTrigger | FEventTrigger | always | Predicate for node rotation |
| fNodeMoveTrigger | FEventTrigger | always | Predicate for node drag |
| fCanvasMoveTrigger | FEventTrigger | always | Predicate for canvas pan |
| fExternalItemTrigger | FEventTrigger | always | Predicate for external item drag |
| fEmitOnNodeIntersect | boolean | false | Emit intersection events |
| vCellSize | number | 1 | Vertical grid snap size |
| hCellSize | number | 1 | Horizontal grid snap size |
| fCellSizeWhileDragging | boolean | false | Apply grid snap during drag |

#### Outputs

| Output | Type | Description |
|--------|------|-------------|
| fSelectionChange | EventEmitter\<FSelectionChangeEvent\> | Selection changed |
| fDeleteSelected | EventEmitter\<FDeleteSelectedEvent\> | v19: removal of the current selection requested (keyboard layer Delete/Backspace); the library never mutates the graph, your app removes the items |
| fCreateNode | EventEmitter\<FCreateNodeEvent\> | External item dropped to create node |
| fMoveNodes | EventEmitter\<FMoveNodesEvent\> | Nodes moved (drag ended) |
| fCreateConnection | EventEmitter\<FCreateConnectionEvent\> | New connection created |
| fReassignConnection | EventEmitter\<FReassignConnectionEvent\> | Connection endpoint reassigned |
| fConnectionWaypointsChanged | OutputEmitterRef\<FConnectionWaypointsChangedEvent\> | Waypoints modified |
| fDropToGroup | EventEmitter\<FDropToGroupEvent\> | Node dropped into group |
| fDragStarted | EventEmitter\<FDragStartedEvent\> | Any drag interaction started |
| fDragEnded | EventEmitter\<void\> | Any drag interaction ended |
| fNodeConnectionsIntersection | OutputEmitterRef\<FNodeConnectionsIntersectionEvent\> | Node-connection intersection detected |

#### CSS Classes (applied during interactions)

`.f-dragging`, `.f-connections-dragging`, `.f-connector-connectable`

---

### fDragHandle (FDragHandleDirective)

Marks an element as the only valid drag-start surface for its parent node.

Selector: `[fDragHandle]`

No inputs or outputs.

CSS Class: `.f-drag-handle`

---

### fResizeHandle (FResizeHandleDirective)

Marks an element as a resize handle for its parent node or group.

Selector: `[fResizeHandle]`

#### Inputs

| Input | Type | Description |
|-------|------|-------------|
| fResizeHandleType | EFResizeHandleType | Required. Which side/corner: LEFT, LEFT_TOP, TOP, RIGHT_TOP, RIGHT, RIGHT_BOTTOM, BOTTOM, LEFT_BOTTOM |

CSS Class: `.f-resize-handle`, `.f-resize-handle-{type}`

---

### fRotateHandle (FRotateHandleDirective)

Marks an element as a rotation handle for its parent node or group.

Selector: `[fRotateHandle]`

No inputs or outputs.

CSS Class: `.f-rotate-handle`

---

### fZoom (FZoomDirective)

Adds wheel, double-click, and pinch-to-zoom capabilities to the canvas.

Selector: `f-canvas[fZoom]`

Must be placed on the `f-canvas` element.

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| fZoom | boolean | false | Enable zoom |
| fWheelTrigger | FEventTrigger | always | Predicate for wheel zoom |
| fDblClickTrigger | FEventTrigger | always | Predicate for double-click zoom |
| fZoomMinimum | number | 0.1 | Minimum zoom scale |
| fZoomMaximum | number | 4 | Maximum zoom scale |
| fZoomStep | number | 0.1 | Wheel zoom step |
| fZoomDblClickStep | number | 0.5 | Double-click zoom step |

#### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| zoomIn | zoomIn(position?: IPoint): void | Zoom in |
| zoomOut | zoomOut(position?: IPoint): void | Zoom out |
| setZoom | setZoom(position: IPoint, step: number, direction: EFZoomDirection, animated: boolean): void | Set zoom programmatically |
| reset | reset(): void | Reset zoom |
| getZoomValue | getZoomValue(): number | Get current zoom level |

CSS Class: `.f-zoom`

---

### f-minimap (FMinimapComponent)

Compact overview of the entire flow with drag-based viewport navigation.

Selector: `f-minimap`

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| fMinSize | number | 1000 | Minimum size of minimap coordinate system |

#### CSS Classes

`.f-minimap`, `.f-minimap-view`, `.f-minimap-node`, `.f-minimap-group`, `.f-selected`

---

### f-background (FBackgroundComponent)

Renders an SVG background layer with configurable patterns that transform with the canvas.

Selector: `f-background`

#### Sub-components

**f-circle-pattern:**

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| id | string | f-pattern-{id} | Pattern id |
| color | string | rgba(0,0,0,0.1) | Circle color |
| radius | number | 20 | Circle spacing |

**f-rect-pattern:**

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| id | string | f-pattern-{id} | Pattern id |
| vColor | string | transparent | Vertical line color |
| hColor | string | transparent | Horizontal line color |
| vSize | number | 20 | Vertical spacing |
| hSize | number | 20 | Horizontal spacing |

CSS Class: `.f-background`

---

### f-selection-area (FSelectionArea)

Rectangle-based multi-select plugin. Draw a selection rectangle to select multiple items.

Selector: `f-selection-area`

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| fTrigger | FEventTrigger | Shift key | Predicate for activation |

Selection results emit via `fSelectionChange` on `fDraggable`.

CSS Class: `.f-selection-area`

---

### fExternalItem (FExternalItem\<TData\>)

Drag items from outside the canvas to create new nodes.

Selector: `[fExternalItem]`

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| fExternalItemId | string | f-external-item-{id} | Unique item id |
| fData | TData | undefined | Data payload delivered on drop |
| fDisabled | boolean | false | Disable dragging |
| fPreview | TemplateRef\<unknown\> | undefined | Custom drag preview template |
| fPreviewMatchSize | boolean | true | Match preview size to source |
| fPlaceholder | TemplateRef\<unknown\> | undefined | Custom placeholder template |

Drop events emit via `fCreateNode` on `fDraggable`.

#### CSS Classes

`.f-external-item`, `.f-external-item-disabled`, `.f-external-item-preview`, `.f-external-item-placeholder`

---

### f-auto-pan (FAutoPanComponent)

Edge-based viewport scrolling during drag operations.

Selector: `f-auto-pan`

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| fEdgeThreshold | number | 20 | Activation zone width in pixels |
| fSpeed | number | 8 | Max per-frame delta in pixels |
| fAcceleration | boolean | false | Scale speed based on proximity to edge |

CSS Class: `.f-auto-pan`

---

### f-magnetic-lines (FMagneticLines)

Displays alignment guide lines during node drag.

Selector: `f-magnetic-lines`

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| threshold | number | 10 | Snap distance in pixels |

#### CSS Classes

`.f-magnetic-lines`, `.f-line`

---

### f-magnetic-rects (FMagneticRects)

Snap-to-grid rectangle guides during node drag.

Selector: `f-magnetic-rects`

---

### f-line-alignment (FLineAlignmentComponent)

**Deprecated.** Use `f-magnetic-lines` instead. Upstream announced removal for v19.0.0, but it still ships (and works) in 19.1.2; treat it as borrowed time.

Selector: `f-line-alignment`

#### Inputs

| Input | Type | Default | Description |
|-------|------|---------|-------------|
| fAlignThreshold | number | 10 | Snap distance |

---

## Event System

Foblex Flow uses a final-result event model — events emit when an action completes, not per-frame.

### Event Reference

| Event | Source | Type | Description |
|-------|--------|------|-------------|
| fNodesRendered | f-flow | OutputEmitterRef\<string\> | Nodes/groups rendered |
| fFullRendered | f-flow | OutputEmitterRef\<string\> | Full render complete including connections |
| fCanvasChange | f-canvas | OutputEmitterRef\<FCanvasChangeEvent\> | Canvas position or scale changed |
| fNodePositionChange | fNode | OutputEmitterRef\<IPoint\> | Node position finalized |
| fNodeSizeChange | fNode | OutputEmitterRef\<IRect\> | Node size finalized |
| fNodeRotateChange | fNode | OutputEmitterRef\<number\> | Node rotation finalized |
| fGroupPositionChange | fGroup | OutputEmitterRef\<IPoint\> | Group position finalized |
| fGroupSizeChange | fGroup | OutputEmitterRef\<IRect\> | Group size finalized |
| fGroupRotateChange | fGroup | OutputEmitterRef\<number\> | Group rotation finalized |
| fSelectionChange | fDraggable | EventEmitter\<FSelectionChangeEvent\> | Selection changed |
| fMoveNodes | fDraggable | EventEmitter\<FMoveNodesEvent\> | Nodes moved |
| fCreateConnection | fDraggable | EventEmitter\<FCreateConnectionEvent\> | Connection created |
| fReassignConnection | fDraggable | EventEmitter\<FReassignConnectionEvent\> | Connection reassigned |
| fConnectionWaypointsChanged | fDraggable | OutputEmitterRef\<FConnectionWaypointsChangedEvent\> | Waypoints modified |
| fCreateNode | fDraggable | EventEmitter\<FCreateNodeEvent\> | External item dropped |
| fDropToGroup | fDraggable | EventEmitter\<FDropToGroupEvent\> | Node dropped into group |
| fDragStarted | fDraggable | EventEmitter\<FDragStartedEvent\> | Drag started |
| fDragEnded | fDraggable | EventEmitter\<void\> | Drag ended |

### Event Property Naming

In FCreateConnectionEvent, prefer `sourceId`, `targetId`, `dropPosition` over legacy aliases `fOutputId`, `fInputId`, `fDropPosition`.

In FReassignConnectionEvent, prefer `connectionId`, `endpoint`, `previousSourceId`, `nextSourceId`, `previousTargetId`, `nextTargetId`, `dropPosition`.

### Trigger Functions

Control when behaviors activate with `FEventTrigger = (event: MouseEvent | TouchEvent | WheelEvent) => boolean`.

```typescript
// Only create connections on Shift+click
[fCreateConnectionTrigger]="(e) => e.shiftKey"

// Disable canvas pan on right-click
[fCanvasMoveTrigger]="(e) => e.button !== 2"
```

---

## Flow-Level Features (provideFFlow, v19)

`provideFFlow(...features)` composes flow-level features in the host component's `providers` array. Also accepts an optional leading `IFFlowConfig` object: `provideFFlow(config, ...features)`. Available features: `withA11y(...)` (accessibility / keyboard layer), `withControlScheme(...)` (alternative pointer/wheel gesture schemes, e.g. `F_SCROLL_PAN_CONTROL_SCHEME`), `withConnectionFlow(...)` (alternative connection-creation gestures, e.g. click-to-connect), `withFCanvas(...)`, `withFlowState(...)`, `withReflowOnResize(...)`. Registering a feature twice replaces the earlier configuration (last-wins provider semantics).

### withA11y(config?: IFA11yConfig)

Two layers:

- **Semantic layer** (roles, `aria-roledescription`, accessible names, live-region announcements): ALWAYS on in v19, with or without `withA11y`.
- **Keyboard layer** (arrow-key spatial navigation, grab-and-move, keyboard connect, delete, select-all, zoom keys): strictly opt-in, activates only when `withA11y(...)` is installed.

```typescript
@Component({
  providers: [
    provideFFlow(
      withA11y({
        keys: { connect: [], deleteSelected: [] }, // unbind actions (read-only graph)
      }),
    ),
  ],
})
```

#### IFA11yConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| keyboard | boolean | true (once installed) | Master switch for the keyboard layer |
| moveStep | number | 10 | Canvas units per arrow key while a node is grabbed |
| coarseMoveStep | number | 50 | Step for Shift+arrow movement |
| messages | Partial\<IFA11yMessages\> | English catalog | Overrides for every spoken/attached string |
| keys | IFA11yKeys | see below | Per-action key binding overrides |

#### IFA11yKeys

`KeyboardEvent.key` values per action; single characters match case-insensitively; an **empty array disables the action**. Arrows, Enter, and Escape are structural and stay fixed.

| Action | Default | Description |
|--------|---------|-------------|
| grab | `[' ']` (Space) | Grab/drop the selection for arrow-key movement |
| connect | `['c']` | Start a keyboard connection from the selected node |
| deleteSelected | `['Delete', 'Backspace']` | Emit `fDeleteSelected` for the current selection |
| selectAll | `['a']` | Select all (requires Ctrl/Cmd) |
| zoomIn | `['+', '=']` | Zoom in |
| zoomOut | `['-', '_']` | Zoom out |
| zoomReset | `['0']` | Reset zoom |

Related exports: `F_DEFAULT_A11Y_KEYS`, `F_DEFAULT_A11Y_MESSAGES`, `F_DEFAULT_A11Y_CONFIG`, `F_A11Y_CONFIG` (injection token holding the resolved config), `mergeA11yConfig`.

---

## Connection Rules

Restrict which inputs can accept connections from specific outputs.

On the unified `[fConnector]` directive use `fCanBeConnectedTo` (ids or categories of target connectors). The legacy `fCanBeConnectedInputs` below applies to the deprecated output/outlet directives and still works.

```html
<!-- Only connects to inputs with id "db-input" or category "database" -->
<div fNodeOutput fOutputId="query-output"
     [fCanBeConnectedInputs]="['db-input', 'database']">
</div>

<!-- Categorized input -->
<div fNodeInput fInputId="my-db-input" fInputCategory="database"></div>
```

During drag-to-connect, valid targets get `.f-connector-connectable` and invalid ones are blocked. Always validate again at persistence time.

---

## Types and Interfaces

```typescript
interface IPoint {
  x: number;
  y: number;
}

interface ISize {
  width: number;
  height: number;
}

interface IRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ITransformModel {
  position: IPoint;
  scale: number;
}

interface IFFlowState {
  nodes: IFNodeState[];
  groups: IFGroupState[];
  connections: IFConnectionState[];
}

interface ICurrentSelection {
  nodes: string[];
  connections: string[];
}

interface FCanvasChangeEvent {
  transform: ITransformModel;
  position: IPoint;
  scale: number;
}

class FSelectionChangeEvent {
  readonly nodeIds: string[];
  readonly groupIds: string[];
  readonly connectionIds: string[];
  /** Deprecated aliases, still functional: fNodeIds, fGroupIds, fConnectionIds */
  get fNodeIds(): string[];
  get fGroupIds(): string[];
  get fConnectionIds(): string[];
}

class FDeleteSelectedEvent {
  readonly nodeIds: string[];
  readonly groupIds: string[];
  readonly connectionIds: string[];
}

interface FDragStartedEvent {
  kind: string;
  data?: any;
}

type FEventTrigger = (event: MouseEvent | TouchEvent | WheelEvent) => boolean;
```

### Enums

```typescript
enum EFConnectionBehavior {
  FIXED = 'fixed',
  FLOATING = 'floating'
}

enum EFConnectionType {
  STRAIGHT = 'straight',
  BEZIER = 'bezier',
  SEGMENT = 'segment',
  ADAPTIVE_CURVE = 'adaptive-curve'
}

// Connector-level sides (fConnectorConnectableSide and the legacy
// per-direction side inputs).
enum EFConnectableSide {
  LEFT = 'left',
  TOP = 'top',
  RIGHT = 'right',
  BOTTOM = 'bottom',
  CALCULATE = 'calculate',
  CALCULATE_HORIZONTAL = 'calculate_horizontal',
  CALCULATE_VERTICAL = 'calculate_vertical',
  AUTO = 'auto'
}

// Connection-level sides (fSourceSide / fTargetSide on <f-connection>,
// and the side hints on f-connection-for-create). This is the enum
// skill-map uses; connector-level sides stay unset in this repo.
enum EFConnectionConnectableSide {
  DEFAULT = 'default',
  TOP = 'top',
  BOTTOM = 'bottom',
  LEFT = 'left',
  RIGHT = 'right',
  CALCULATE = 'calculate',
  CALCULATE_HORIZONTAL = 'calculate_horizontal',
  CALCULATE_VERTICAL = 'calculate_vertical'
}

// Role of a unified [fConnector].
type FConnectorType = 'source' | 'target' | 'source-target' | 'outlet';

enum EFResizeHandleType {
  LEFT,
  LEFT_TOP,
  TOP,
  RIGHT_TOP,
  RIGHT,
  RIGHT_BOTTOM,
  BOTTOM,
  LEFT_BOTTOM
}

enum EFZoomDirection {
  ZOOM_IN = 0,
  ZOOM_OUT = 1
}

enum EFMarkerType {
  START = 'f-connection-marker-start',
  END = 'f-connection-marker-end',
  SELECTED_START = 'f-connection-marker-selected-start',
  SELECTED_END = 'f-connection-marker-selected-end',
  START_ALL_STATES = 'f-connection-marker-start-all-states',
  END_ALL_STATES = 'f-connection-marker-end-all-states'
}
```

---

## Styling

### ⚠ Never animate or override `transform` on `[fNode]` or `.f-canvas`

Foblex applies `transform: translate(x, y)` inline on every node element (driven by `fNodePosition`) and on `.f-canvas` (driven by zoom/pan). Any app-level CSS that touches those transforms fights the library and causes lag, jumps, or broken positioning. Concretely, do NOT write:

- `transition: transform ...` on a node class — interpolates every position update over the transition duration; connection paths recalculate mid-animation → visible connector lag on zoom/pan/drag.
- `:hover { transform: ... }` on a node class — overwrites Foblex's position translate, so hovered nodes snap to origin.
- Any rule setting `transform` or `transition: transform` on `.f-canvas` — zoom stutter.
- `will-change: transform` on `[fNode]` — the library already hints the browser; adding it here does nothing useful and can burn GPU memory.

For visual affordances (hover, focus, selection) use `background`, `border`, `border-color`, `border-radius`, `box-shadow`, `color`, `padding`. These are safe to animate. If you feel the urge to animate a position, you are duplicating Foblex's responsibility — stop and use the library's API (`centerGroupOrNode(id, animated)`, `setScale(scale, pivot)`, etc.) instead.

### ⚠ Use theme tokens for connection styling, not stroke overrides

The default theme consumes CSS custom properties for connection rendering:

| Token | Default | Effect |
|-------|---------|--------|
| `--ff-connection-color` | `var(--ff-color-connection)` | `.f-connection-path` stroke |
| `--ff-connection-width` | `2px` | `.f-connection-path` stroke-width |
| `--ff-marker-color` | `var(--ff-connection-color)` | color of marker shapes (via `currentColor`) |
| `--ff-connection-hit-width` | — | invisible hit area for hover |
| `--ff-snap-connection-color` | — | stroke for `f-snap-connection` |
| `--ff-connection-selected-color` | — | stroke when `.f-selected` |

To style edges per kind, put a class on `<f-connection>` and override the token — no `::ng-deep` needed (custom properties cascade through Angular's emulated encapsulation):

```css
.my-kind-edge {
  --ff-connection-color: #f59e0b;
  --ff-connection-width: 2.5px;
  --ff-marker-color: #f59e0b;
}
```

Only reach for direct SVG overrides (`::ng-deep` on `.f-connection-path`) for properties that have no token — e.g. `stroke-dasharray`. When you do, put the rule in the view's component CSS (not the global stylesheet) and scope it under a wrapper class you own, so the bypass stays bounded to that view:

```css
/* view-component.css */
.my-canvas-wrap ::ng-deep .f-connection-path {
  stroke-dasharray: 4 3;
}
```

Globals are for rules that are genuinely app-wide. View-specific Foblex overrides do not belong there.

### ⚠ Use `<f-connection-marker-arrow>`, not hand-rolled `<svg><marker>`

Foblex ships two built-in marker components that project inside `<f-connection>`:

```html
<f-connection [fSourceId]="..." [fTargetId]="...">
  <f-connection-marker-arrow type="end" />
</f-connection>
```

`type` accepts `start`, `end`, `selected-start`, `selected-end`, `start-all-states`, `end-all-states` (see `EFMarkerType`). Colors come from `--ff-marker-color` (itself defaulting to `--ff-connection-color`). Selection and snap states swap the color automatically.

Do NOT declare `<svg><defs><marker id="arrow-end">...</marker></defs></svg>` yourself and then write `marker-end: url(#arrow-end)` in `.f-connection-path`. That recipe looks functional but duplicates the library, breaks selection/snap styling, and forces `::ng-deep` overrides that stop following theme changes.

### Default Theme

Include the complete default theme:

```scss
@use '@foblex/flow/styles/default';
```

Or import selectively:

```scss
@use '@foblex/flow/styles' as flow-theme;

@include flow-theme.theme-tokens();
@include flow-theme.flow-canvas();
@include flow-theme.node-group();
@include flow-theme.connector();
@include flow-theme.connection-all();
@include flow-theme.plugins();
```

### Available SCSS Mixins

**Theme entrypoints:**
- `theme-tokens()` — All CSS custom property layers
- `theme-all($scoped: true)` — Main stack (flow-canvas, node-group, connector, connection-all, external-item-all, plugins)

**Core:**
- `flow($scoped)`, `canvas($scoped)`, `flow-canvas($scoped)`

**Node/Group:**
- `node($scoped, $selectorless)`, `group($scoped, $selectorless)`, `grouping($scoped)`
- `drag-handle($scoped)`, `resize-handle($scoped)`, `rotate-handle($scoped)`, `node-group($scoped)`

**Connectors:**
- `connector-sockets($scoped, $selectorless)`, `connector-outlet($scoped)`, `connector($scoped)`

**Connections:**
- `connection($scoped)`, `connection-markers($scoped)`, `connection-waypoints($scoped)`
- `connection-drag-handles($scoped)`, `connection-drag-handles-visible($scoped)`, `connection-all($scoped)`

**External Items:**
- `external-item($scoped)`, `external-item-preview($scoped)`, `external-item-placeholder($scoped)`, `external-item-all($scoped)`

**Plugins:**
- `background($scoped)`, `selection-area($scoped)`, `minimap($scoped)`
- `magnetic-lines($scoped)`, `magnetic-rects($scoped)`, `plugins($scoped)`

### $scoped Parameter

- `true` (default) — Styles self-scoped to `f-flow` context
- `false` — Raw selectors for use with Angular `::ng-deep`

### CSS Token Families

Override `--ff-*` CSS custom properties to customize appearance. Token families:

`flow`, `canvas`, `node`, `group`, `grouping`, `handle`, `connector`, `outlet`, `connection`, `marker`, `waypoint`, `background`, `selection-area`, `minimap`, `magnetic`, `external-item`

### Runtime CSS Classes Reference

**State classes:**
- `.f-selected` — Selected nodes, groups, connections
- `.f-dragging` — Active drag on items and flow host
- `.f-connections-dragging` — Connection create/reassign in progress
- `.f-connector-connectable` — Valid connection target during drag
- `.f-node-output-connected`, `.f-node-input-connected` — Connected connectors
- `.f-grouping-drop-active`, `.f-grouping-over-boundary` — Drop-to-group state

**Disabled classes:**
- `.f-node-dragging-disabled`, `.f-node-selection-disabled`
- `.f-group-dragging-disabled`, `.f-group-selection-disabled`
- `.f-connection-reassign-disabled`, `.f-connection-selection-disabled`
- `.f-node-input-disabled`, `.f-node-output-disabled`, `.f-node-outlet-disabled`

---

## Advanced Features

### Virtual Rendering (fVirtualFor)

Progressive rendering for large diagrams. Renders nodes in chunks using a frame-budget strategy.

```html
<f-flow fDraggable>
  <f-canvas>
    <div *fVirtualFor="let node of nodes" fNode [fNodePosition]="node.position">
      {{ node.label }}
    </div>
  </f-canvas>
</f-flow>
```

### Caching (fCache)

Performance optimization that caches node and connector geometry to avoid redundant recalculations.

```html
<f-flow fDraggable [fCache]="true">
  <f-canvas>
    <!-- nodes and connections -->
  </f-canvas>
</f-flow>
```

### Layout Engine Integration

Abstract layout engine with Dagre and ELK adapters for automatic node positioning.

```typescript
import { provideFLayout } from '@foblex/flow';
import { FDagreLayoutEngine } from '@foblex/layout-dagre';

@Component({
  providers: [provideFLayout(FDagreLayoutEngine)],
})
export class MyFlowComponent {
  private layout = inject(F_LAYOUT);

  async autoLayout() {
    await this.layout.relayout();
  }
}
```

Optional packages: `@foblex/layout-dagre`, `@foblex/layout-elk`

### Layout Engine API

| Method | Signature | Description |
|--------|-----------|-------------|
| setMode | setMode(mode: EFLayoutMode): void | MANUAL or AUTO layout triggering |
| relayout | relayout(flowId?: string): Promise\<void\> | Execute layout calculation |
| setWriteback | setWriteback(handler): void | Custom position writeback handler |
| setInteractiveOptions | setInteractiveOptions(options): void | Update layout options |

---

## Complete Example: Flow Editor with Connections

```typescript
import { Component, signal } from '@angular/core';
import { FFlowModule, FCreateConnectionEvent, FSelectionChangeEvent } from '@foblex/flow';

interface INode {
  id: string;
  position: { x: number; y: number };
  label: string;
}

interface IConnection {
  id: string;
  sourceId: string;
  targetId: string;
}

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [FFlowModule],
  template: `
    <f-flow fDraggable
            (fCreateConnection)="onCreateConnection($event)"
            (fSelectionChange)="onSelectionChange($event)">
      <f-canvas [fZoom]="true">
        <f-background>
          <f-circle-pattern></f-circle-pattern>
        </f-background>

        @for (connection of connections(); track connection.id) {
          <f-connection
            [fConnectionId]="connection.id"
            [fSourceId]="connection.sourceId"
            [fTargetId]="connection.targetId"
            fType="segment">
          </f-connection>
        }

        <f-connection-for-create fType="segment"></f-connection-for-create>

        @for (node of nodes(); track node.id) {
          <div fNode fDragHandle
               fConnector fConnectorType="source-target"
               [fNodeId]="node.id"
               [fConnectorId]="node.id"
               [fNodePosition]="node.position"
               (fNodePositionChange)="onNodePositionChange(node.id, $event)">
            {{ node.label }}
          </div>
        }

        <f-minimap></f-minimap>
        <f-selection-area></f-selection-area>
      </f-canvas>
    </f-flow>
  `,
})
export class EditorComponent {
  nodes = signal<INode[]>([
    { id: 'node-1', position: { x: 50, y: 100 }, label: 'Start' },
    { id: 'node-2', position: { x: 350, y: 100 }, label: 'Process' },
    { id: 'node-3', position: { x: 650, y: 100 }, label: 'End' },
  ]);

  connections = signal<IConnection[]>([
    { id: 'conn-1', sourceId: 'node-1', targetId: 'node-2' },
  ]);

  onCreateConnection(event: FCreateConnectionEvent): void {
    this.connections.update((conns) => [
      ...conns,
      {
        id: `conn-${Date.now()}`,
        sourceId: event.sourceId,
        targetId: event.targetId,
      },
    ]);
  }

  onSelectionChange(event: FSelectionChangeEvent): void {
    console.log('Selected:', event.nodeIds, event.connectionIds);
  }

  onNodePositionChange(nodeId: string, position: { x: number; y: number }): void {
    this.nodes.update((nodes) =>
      nodes.map((n) => (n.id === nodeId ? { ...n, position } : n))
    );
  }
}
```

---

## Example: External Item (Drag from Palette)

```html
<!-- Palette outside the canvas -->
<div fExternalItem [fData]="{ type: 'action' }">
  <span>Action Node</span>
</div>

<!-- In your flow -->
<f-flow fDraggable (fCreateNode)="onCreateNode($event)">
  <f-canvas>
    <!-- existing nodes... -->
  </f-canvas>
</f-flow>
```

```typescript
onCreateNode(event: FCreateNodeEvent): void {
  const newNode = {
    id: `node-${Date.now()}`,
    position: event.dropPosition,
    label: event.fData.type,
  };
  this.nodes.update((nodes) => [...nodes, newNode]);
}
```

---

## Example: Node Groups

```html
<f-flow fDraggable (fDropToGroup)="onDropToGroup($event)">
  <f-canvas>
    <!-- Group container -->
    <div fGroup fDragHandle
         [fGroupId]="'group-1'"
         [fGroupPosition]="{ x: 20, y: 20 }"
         [fAutoSizeToFitChildren]="true">
      Group Title
    </div>

    <!-- Child node inside group -->
    <div fNode fDragHandle
         [fNodeId]="'child-1'"
         [fNodeParentId]="'group-1'"
         [fNodePosition]="{ x: 40, y: 60 }">
      Child Node
    </div>
  </f-canvas>
</f-flow>
```

---

## Example: Resize and Rotate

```html
<div fNode [fNodePosition]="{ x: 100, y: 100 }">
  <div fDragHandle>Drag here</div>
  <div fResizeHandle [fResizeHandleType]="EFResizeHandleType.RIGHT_BOTTOM" class="resize-corner"></div>
  <div fRotateHandle class="rotate-handle"></div>
  Node Content
</div>
```

---

## Angular Version Compatibility

| @foblex/flow | Angular    |
|-------------|------------|
| 19.x        | 17.3+ (peer dep floor; this repo runs it on Angular 21) |
| 18.x        | 17.3 – 21  |
| 17.x        | 17.3 – 19  |
| 16.x        | 16.x       |
| 12.x        | 12.x – 15  |

---

## Peer Dependencies

```json
{
  "@angular/common": ">=17.3.0",
  "@angular/core": ">=17.3.0",
  "@foblex/platform": "^1.0.4",
  "@foblex/mediator": "^1.1.3",
  "@foblex/2d": "^1.2.2",
  "@foblex/utils": "^1.1.1"
}
```

---

## Module Import

For standalone components (recommended):

```typescript
import { FFlowModule } from '@foblex/flow';

@Component({
  standalone: true,
  imports: [FFlowModule],
})
```

For module-based apps:

```typescript
import { FFlowModule } from '@foblex/flow';

@NgModule({
  imports: [FFlowModule],
})
```

---

## Reference Applications

- **Schema Designer** — Database table relationship editor
- **Call Center** — Call flow management system
- **UML Diagram** — UML diagram builder with entities
- **Tournament Bracket** — Specialized bracket visualization
- **AI Low-Code Platform** — Flagship demo for AI workflow building

Source code in `apps/example-apps/` directory.
