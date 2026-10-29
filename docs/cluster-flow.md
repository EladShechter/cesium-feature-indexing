# Point clustering flow: status and known issues

This is the **active** flow in `main.ts`: 60k random points, 30k polygons and 10k lines (sized buckets, weighted towards small shapes), clustered by `supercluster` in the worker
and drawn per tile by `TileRenderer`. The disabled vector tiles flow is described in `vector-tiles-flow.md`.

## Flow

1. `main.ts` builds 60k random Point features plus 30k polygons and 10k lines (sized buckets, weighted towards small shapes) and calls `client.build(features, { minPoints, radiusPx, maxZoom })`.
2. `cluster-worker.ts` loads them into a `FeatureIndex` (see Shapes) and replies `built`.
3. `CameraHandler` computes the visible bbox and a web-mercator zoom: the zoom at which a tile is at least
   `TILE_SIZE_PX` (256) on screen. It detects camera changes per frame (view matrix and canvas size, checked on
   `scene.preUpdate`), so any camera move is picked up, by mouse or in code (`flyTo`, `zoomIn`, `setView`, the zoom
   buttons), without calling it explicitly. Refreshes are throttled to every 100 ms and skipped when bbox and zoom are unchanged.
   Sprite sizes and the cluster radius are in `map-constants.ts`.
4. `TileRenderer.requestRenderByBboxAndZoom` computes covering tiles (`computeCoveringTiles`), marks new
   ones `pending` and calls `client.tile(z, x, y)`.
5. The worker replies with `index.getTile(z, x, y)` (tile-pixel coordinates, `extent` 4096).
6. `TileRenderer` converts each feature to lon/lat and draws clusters as billboards (sprite cached by
   size/text/color in `sprite-cache.ts`) and single points as `PointPrimitive`s.
7. Clicking (`picking.ts`) logs single points, or asks the worker for a cluster's leaves.

### Tile lifecycle in `TileRenderer`

| State | Meaning |
|---|---|
| `pending` | Requested from the worker. Only a pending tile accepts a response. |
| `ready` | Drawn (possibly empty). |
| stale (`staleTiles`) | A ready tile that left the view. Kept on screen until all current tiles are ready, then removed. |

A pending tile that leaves the view loses its status. Its response is then ignored, and the tile is
requested again if it comes back into view.

## Shapes

Polygons and lines are clustered as points below a per-shape reveal zoom and drawn as real geometry from it on.
Design: [shape clustering spec](superpowers/specs/2026-10-29-shape-clustering-design.md).

- **Reveal zoom and anchor point** (`indexing/reveal.ts`): a shape's reveal zoom is the first zoom where its bbox is at
  least `REVEAL_SIZE_PX` on screen. Below it, the shape is a point at its anchor point and clusters with the others
  (cluster tags carry a points/polygons/lines breakdown).
- **`RevealSupercluster`** (`indexing/reveal-supercluster.ts`) extends `Supercluster` and adds each shape at its reveal zoom.
  It relies on supercluster internals, so `supercluster` is pinned to an exact version (8.0.1). After upgrading it, run `npm test`
  to check the subclass still works.
- **`FeatureIndex`** combines the clusters and the revealed shapes of each tile. The worker's `tile` response carries
  `features` (clusters and points) and `shapes`.
- **`ShapeLayer`** (`rendering/shape-layer.ts`) reference-counts shapes per tile, because a shape can intersect several
  tiles. It is drawn once (`EntityShapeDrawer`, Cesium entities) and removed with its last tile. Shapes follow the tile
  lifecycle: added when a tile becomes ready, removed in `removeTile`.
- **Double representation:** on a zoom change, old (stale) tiles stay until the new ones are ready, so a shape can briefly
  be seen both as geometry and inside a bubble. Once the tiles settle it is only one of them.

## Already fixed

- `client.build()` never sent its message to the worker, so the index was never built.
- A tile cancelled while pending was stuck forever in a `removed` state and never drew again.
- Features in Supercluster's tile buffer (coordinates outside `[0, extent)`) were drawn by
  neighbouring tiles too, so clusters near tile borders appeared twice. Only the owning tile draws them now.
- Empty tiles were deleted and re-requested on every camera move. They are now marked `ready`.
- Zooming or panning showed a blank map until the new tiles arrived. The old tiles now stay as stale until then.
- `computeCoveringTiles` did not clamp to the mercator latitude limit or to the tile range, and
  `CameraHandler` computed the wrong zoom for views crossing the antimeridian. Both are fixed.
- Picking sent `meta.cluster_id` (always undefined) instead of `meta.id`, so cluster clicks listed 0 items.
- **Overlapping clusters.** Three causes:
  - Supercluster measures `radius` against `extent`. With `extent: 4096`, `radius: 40` was about 2.5 screen px, so almost nothing clustered.
  - The zoom made one tile span the whole canvas.
  - The sprites were up to about 100 px wide, and up to 2× that on HiDPI screens.

  Now:
  - `radius` is given in screen px (64) and converted to extent units by the worker.
  - The zoom uses 256 px tiles and `floor`, so a tile is never smaller than 256 px on screen.
  - The sprites are at most 60 CSS px. They are drawn at the drawing-buffer pixel ratio and rendered at device
    resolution (`useBrowserRecommendedResolution: false`), so each sprite pixel maps to one screen pixel and stays sharp.

  Measured at the worst-case scale: about 0–6% of clusters touch a neighbour, compared with each cluster overlapping 3–17 others before.
  What remains comes from Supercluster placing each cluster at the weighted centre of its points, which can pull two centres
  slightly closer than the radius. Raise `radius` for more margin, or add a screen-space collision pass if zero overlap is required.
- **Every billboard had its own texture atlas entry.** A canvas passed as `image` gets a new GUID per billboard.
  Sprites are now registered with `billboard.setImage(id, canvas)`, so identical sprites share one entry.
- The base map was black, because the default Bing imagery needs a Cesium ion token. It now uses OpenStreetMap tiles.
  These are free but meant for light use, so switch to your own or a commercial tile server for anything beyond a POC.

## Known issues

### 1. The commented-out cache is not usable as written
`TileRenderer` contains two commented-out caches:

- **Rendered-features cache:** re-adds cached `Billboard` / `PointPrimitive` objects with `collection.add(billboard)`.
  - `BillboardCollection.remove()` calls `billboard._destroy()`, so the cached objects are already destroyed.
  - `add()` expects an options object, not a primitive.
  - It stores the *old* objects in `renderedFeatures` while drawing the *new* ones. A later
    `removeTile` would then remove the wrong objects and leak the drawn ones.
- **Raw tile-data cache:** saves the worker round trip.
  - That round trip is already cheap (`getTile` is sub-millisecond, and the reply is async).
  - The 5-minute staleness check is meaningless for static data.
  - The real cost on revisit is creating primitives on the main thread, which this cache does not save.

**Direction:** cache *drawn tiles*, not data. Give each tile its own `BillboardCollection` and
`PointPrimitiveCollection`, grouped in a `PrimitiveCollection`.
- A tile that leaves the view gets `show = false` (O(1), keeps its GPU buffers) and moves into an LRU.
- A tile that comes back gets `show = true`, with no worker request and no rebuild.
- When the LRU is full (e.g. 150 tiles, or a total primitive count), the oldest tile's collections are destroyed.
- A `Map` keeps insertion order, so `delete` + `set` on access makes it an LRU without sorting.

This also simplifies `removeTile`: destroying one collection replaces removing primitives one by one.
Removing one item at a time from a large shared collection is slow, because every `remove()` forces
Cesium to rebuild the whole vertex array.

### 2. A tilted camera requests too many tiles
`computeViewRectangle` on a tilted view that shows the horizon returns a huge bbox, but the zoom comes
from the view width at the equator. The result can be hundreds of tiles at a high zoom, all requested
and drawn, even though the distant ones cover only a few pixels each.

**Direction (proposed): select tiles by screen-space size (quadtree LOD), the way Cesium's own globe does.**
Replace "bbox + one zoom" with a recursive selection:

1. Start from the zoom-0 tile (or the tiles covering the data bbox at a low zoom).
2. For each tile:
   - Cull it if it is outside the camera frustum (`camera.frustum.computeCullingVolume(...)`
     against a `BoundingSphere` from the tile rectangle) or behind the horizon (`EllipsoidalOccluder`).
   - Estimate its on-screen size:
     `tileWidthMeters / distanceToCamera * (canvasHeight / (2 * tan(fovy / 2)))`.
   - If it is larger than ~256 px and `z < maxZoom`, refine into its 4 children. Otherwise select it.
3. Render the selected tiles.

Near tiles end up at a high zoom and far tiles at a low zoom. The tile count stays bounded (roughly
proportional to screen area) whatever the tilt.

- **Mixed zooms are fine for this renderer:** selected tiles never overlap, and each tile draws only the
  points it owns. A cluster centred just inside a low-zoom tile can still include a few points that a
  neighbouring high-zoom tile also draws. That is a small visual approximation at the boundaries.
- **API change:** the renderer would receive tile coordinates, so `IRenderer.requestRenderByBboxAndZoom`
  becomes something like `requestRenderTiles(tiles: TileCoord[])`. `CameraHandler` would own the selection.
  The vector tiles flow can reuse it.
- **Safety cap:** also cap the selection (e.g. at 128 tiles) by stopping refinement once the cap is reached.

**Cheaper stop-gap:** keep the current approach, but lower the zoom until `computeCoveringTiles`
returns at most N tiles. It is a few lines, but the whole view gets coarse clusters, including the
area right in front of the camera.

### 3. Main-thread costs at startup
The 100k features are generated on the main thread and copied to the worker with `postMessage`.
That is fine for a POC. With real data, load or generate it inside the worker.

### 4. Debug logging
`requestRenderByBboxAndZoom` and `cleanupOldTiles` log the full tile list and the status map on every camera
change. Remove these logs, or put them behind a flag, before measuring performance.

## Performance advice

Ordered by expected impact for this flow. Measure first, with `viewer.scene.debugShowFramesPerSecond = true`
and the Chrome Performance panel (look for long tasks while panning).

1. **One collection per tile (see Known issue 1).** Each `remove()` on the shared `BillboardCollection` /
   `PointPrimitiveCollection` sets `_createVertexArray = true`, which rebuilds the vertex buffers for *all*
   primitives on the next frame. Panning removes hundreds of primitives per move. With per-tile collections,
   removing a tile means destroying one small collection, and hiding/showing it is O(1). This is also what makes the tile cache possible.
2. **Limit unique sprites.** Every distinct `size|text|color` makes a new canvas and texture atlas entry.
   Below 1000, every count is unique, and neither the atlas nor the `cache` Map ever evicts anything.
   Options:
   - Bucket the labels ("10+", "50+", "100+", "1K+") so there are only a few dozen sprites.
   - Draw the circle as a billboard (few size/color buckets) and the number with a `LabelCollection`, whose glyph atlas is shared per character.
3. **Send typed arrays from the worker.**
   - Today each tile is a structured clone of GeoJSON-like objects, and the main thread calls
     `Cartesian3.fromDegrees` for every feature.
   - Instead, compute the ECEF positions in the worker (plain math, no Cesium needed) and post a `Float64Array`
     of positions plus `Uint32Array`s of counts and ids as *transferables*. That is zero-copy, with almost no main-thread work.
4. **Pick tiles by screen size (Known issue 2).** This keeps the tile count bounded whatever the camera tilt.
5. **Spread work across frames.** When many tile responses arrive together (a fast zoom), queue them and draw within a
   time budget per `requestAnimationFrame` (e.g. 8 ms). Update the HUD once per frame instead of once per tile.
6. **Opaque points.** Create the single-point collection with `blendOption: BlendOption.OPAQUE` (Cesium documents up
   to 2× faster rendering). Cluster sprites have transparent corners, so they need `OPAQUE_AND_TRANSLUCENT` (the default).
7. **Request tiles less often while moving.** `camera.changed` and the 100 ms throttle request tiles during a drag.
   With the cache in place, consider requesting only on `moveEnd` and showing cached or parent tiles meanwhile.
8. **Cheaper globe (optional).** If the visuals are not needed: `scene.fog.enabled = false`,
   `scene.globe.showGroundAtmosphere = false`, `scene.skyAtmosphere.show = false`. On weak GPUs,
   `viewer.resolutionScale < 1`.
9. **Load data in the worker.** Generating or fetching the features inside the worker avoids blocking the main thread and the
   100k-feature `postMessage` copy at startup.
