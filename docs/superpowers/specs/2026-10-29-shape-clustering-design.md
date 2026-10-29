# Shape clustering: design

**Date:** 2026-10-29
**Branch:** `feature/shape-clustering`
**Status:** draft, awaiting review

## Goal

Add polygons and polylines to the point clustering flow. When zoomed out, each shape is represented by a
point that clusters together with the regular points. When zoomed in, the real shape is drawn instead.
A shape is not simply replaced by its centroid: a large polygon must not be absorbed into a cluster bubble
while it covers a large part of the screen.

## Decisions

| Topic | Decision |
|---|---|
| When a shape is a point vs. real geometry | By **on-screen size**: each shape has its own reveal zoom (below) |
| Real data | Mostly small/simple shapes (tens of vertices). Revealed shapes are drawn whole, once each, without tiling or simplification |
| Clusters | One mixed count of points and shapes. Each cluster keeps a per-type breakdown (points / polygons / lines) |
| Index | Supercluster subclass that adds shapes at their reveal zoom (only `load()` is replaced), plus a Flatbush R-tree for revealed shapes |
| Tests | None for now (see "Risks") |

## Concepts

### Reveal zoom

For each shape:

- `s` = the larger of its bbox width and height, in web-mercator world units (0..1, the whole world = 1).
- `R = ceil(log2(REVEAL_SIZE_PX / (s * TILE_SIZE_PX)))`, clamped to `maxZoom + 1`.

At zoom `z`, a tile is shown at `TILE_SIZE_PX` to `2 * TILE_SIZE_PX` on screen (`CameraHandler` uses floor),
so from zoom `R` on, the shape is at least `REVEAL_SIZE_PX` on screen.

- `z < R`: the shape is a **point** (its anchor) and takes part in clustering.
- `z >= R`: the shape is drawn as **real geometry**, and is not a point.
- `R <= 0`: always geometry, so the shape never enters the cluster index.
- `s = 0` (degenerate shape): `R = maxZoom + 1`, so the shape is always a point.
- Regular points: `R = Infinity` (always points).

### Anchor point

The point that represents a shape while it is a point:

- **Polygon:** a point guaranteed to lie on the polygon (`@turf/point-on-feature`). A centroid can fall outside
  concave polygons.
- **LineString:** the point at half of the line's length (`@turf/along` at `length / 2`).

## Architecture

```
main thread                                   worker
-----------                                   ------
data.ts: points + polygons + lines  --build-->  shape-index.ts
                                                  - toIndexItems(): anchor, bbox, R per feature
                                                  - RevealSupercluster (anchors + points)
                                                  - Flatbush over shape bboxes
CameraHandler -> TileRenderer
  tile(z,x,y)                       --tile----->  clusters/points (z < R)  +  shapes (bbox ∩ tile, R <= z)
  TileRenderer: clusters + points  <--tile-----
  ShapeLayer: shapes (ref-counted)
```

### Worker: `src/shape-index.ts` (new)

**`toIndexItems(features)`** turns each input feature into an index item:

- Point → point feature with `properties: { kind: 'point', featureId, revealZoom: Infinity }`.
- Polygon / LineString → anchor point feature with
  `properties: { kind: 'polygon' | 'line', featureId, revealZoom: R }`. The source geometry and bbox are kept
  in a side table, keyed by `featureId`.
- Every item has `id: featureId`, so Supercluster passes the id through in tile results for non-cluster features.
- Missing or empty geometry, and Multi* geometries → skipped. The number skipped is logged once after the build.

**`RevealSupercluster extends Supercluster`** replaces only `load()`. It reproduces the library's `load()`
(about 45 lines) with one change. Just before clustering level `z` from the level `z + 1` tree, it adds
the shapes with `R === z + 1` to that tree's data and rebuilds it (`_createTree`). The tree is stored as
`trees[z + 1]`, then the library's own `_cluster(tree, z)` builds level `z`.

- Shapes with `R === maxZoom + 1` (the clamp value) go into the initial (`maxZoom + 1`) tree, together with the regular points.
- Because the shape stays in `trees[R]`, `getChildren` / `getLeaves` of a cluster at `R - 1` include it.
- The same tree means `getTile(R)` would return the shape as a single point. The worker therefore drops
  non-cluster tile features with `tags.revealZoom <= z` (Supercluster copies the item's properties into `tags`).
- All other methods (`getTile`, `getLeaves`, `getChildren`, `getClusterExpansionZoom`, map/reduce) are
  Supercluster's own.

**Per-type breakdown** uses Supercluster's `map` / `reduce` options:
`map` turns each item's `kind` into `{ points, polygons, lines }`, with 1 for its own kind and 0 for the others.
`reduce` sums the three counters, so a cluster's `points + polygons + lines === point_count`.

**Shape index:** `Flatbush` over the bboxes of shapes with `R <= maxZoom` (a shape with a larger R is
never revealed). It is queried per tile with the tile's lon/lat bbox and filtered by `R <= z`.

### Worker messages (`cluster-worker.ts`, `global.d.ts`, `cluster-worker-client.ts`)

- `build` accepts features of any geometry type (points, polygons, lines) and builds both indexes.
- `tile` response gains `shapes: Array<{ id: string; kind: 'polygon' | 'line'; coordinates: number[][][] | number[][] }>`,
  using GeoJSON lon/lat coordinates (`Polygon` rings for polygons, a `LineString` position list for lines).
  `features` (clusters/points) keeps its current form, minus revealed shapes.
- `leaves` is unchanged. Leaves are anchor/point features carrying `{ kind, featureId }`.

### Main thread: `src/rendering/shape-layer.ts` (new)

`ShapeLayer` draws revealed shapes, each exactly once, however many visible tiles reference it.

- `addTile(tileKey, shapes)`: `refCount++` per shape id. A shape is drawn on 0 → 1.
- `removeTile(tileKey)`: `refCount--` per shape id of that tile. A shape is removed on 1 → 0.
- Drawing: entities in a `CustomDataSource`, with constant graphics (no `CallbackProperty`).
  - **Polygons:** translucent fill (`SHAPE_POLYGON_FILL`) and a 1 px outline (`SHAPE_POLYGON_OUTLINE`), at height 0.
    Polygons are not clamped to ground (no terrain), so the outline works.
  - **Lines:** `PolylineGraphics`, width 2, `SHAPE_LINE_COLOR`.
  - Cesium merges static entities with the same appearance into shared primitives. The reveal rule keeps the
    number of drawn shapes bounded (every drawn shape is at least `REVEAL_SIZE_PX` on screen).
    If profiling shows a problem, moving to batched `Primitive`s is a change inside `ShapeLayer` only.
- The entity id is `shape:<featureId>`, and `properties.featureId` is used for picking.

### Main thread: `TileRenderer` changes

- Owns a `ShapeLayer`.
- When a tile becomes ready: `shapeLayer.addTile(tileKey, tile.shapes)`.
- `removeTile` (including stale tiles when they are swapped out): `shapeLayer.removeTile(tileKey)`.
- A response for a tile that is no longer pending is ignored as today, so `ShapeLayer` is never touched by late responses.
- Points and clusters are drawn as today (buffer filter, tile states, stale tiles unchanged).
- The HUD gets a "Shapes (drawn)" counter (`index.html`, `BaseRenderer.updateHUD`).

### Picking (`picking.ts`)

- Clicking a shape entity logs the original feature, looked up by `properties.featureId` in the `byId` map.
- Clicking a cluster lists its leaves, which can now include shapes (`kind` + `featureId`), also resolved via `byId`.
- `byId` is built from all features (points and shapes).

### Constants (`map-constants.ts`)

- `REVEAL_SIZE_PX = 32`: a shape is drawn as geometry once it is about the size of a small bubble.
- `SHAPE_POLYGON_FILL`, `SHAPE_POLYGON_OUTLINE`, `SHAPE_LINE_COLOR`: CSS color strings.

### POC data (`data.ts`, `main.ts`)

- About 60k points, 30k polygons and 10k lines in the existing bbox.
- Shapes are generated in size buckets (about 100 m, 1 km, 10 km and 50 km), so shapes reveal at different zooms.
  turf's `randomPolygon` / `randomLineString` take one size per call, so each bucket is one call.
- The vector tiles flow stays commented out and untouched.

### Dependencies

- `supercluster`: pinned to exactly `8.0.1` (remove the `^`), because the subclass depends on its internals.
- New: `flatbush`, `@turf/point-on-feature`, `@turf/along`, `@turf/length`, `@turf/bbox`.

## Known behaviour and limitations

- **Brief double representation on zoom change.** While the previous zoom's tiles are kept as stale, a shape that has
  just been revealed can be visible while the old bubble that included it is still on screen. This lasts until all new tiles are ready.
- **Bubble members near the reveal zoom.** At `z = R - 1`, a cluster can include a shape whose geometry is
  much larger than the bubble; that is by design (it is still under `REVEAL_SIZE_PX` on screen).
- **Out of scope:** Multi* geometries (skipped), shapes crossing the antimeridian (their naive bbox spans the world),
  per-zoom simplification and tiling of heavy geometry (not needed for small/simple shapes).

## Risks

- **Supercluster internals.** The subclass uses `_createTree`, `_cluster`, the flat data layout (stride, offsets)
  and the `trees` array. A future version can change them.
  - The exact version pin makes upgrades deliberate.
  - **Upgrade check (manual, since there are no tests for now):** compare `getTile` output of `RevealSupercluster`
    with plain `Supercluster` on points only, at a few zooms. They must be identical. This is a good first test when tests are added.
  - **Watching for releases:** `npm outdated`, GitHub "Watch → Custom → Releases" on `mapbox/supercluster`,
    or Dependabot / Renovate.

## Verification

- `tsc --noEmit` and `vite build` pass.
- Manual browser check:
  - When zoomed out, large polygons are visible next to the bubbles.
  - Zooming in, small shapes come out of their bubbles and are drawn as geometry. No shape is drawn both as a point and as geometry once tiles settle.
  - The HUD counts make sense.
  - Clicking a cluster lists shapes among its members, and clicking a shape logs its feature.
