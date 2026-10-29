# Shape Clustering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polygons and polylines join the point clustering flow. Each shape is a clusterable point below its reveal zoom and is drawn as real geometry from its reveal zoom on.

**Architecture:** In the worker, `FeatureIndex` turns features into index items (an anchor point and a reveal zoom per shape). It feeds them to `RevealSupercluster`, a Supercluster subclass that replaces only `load()` and adds each shape at its reveal level. A Flatbush R-tree over the shape bboxes returns the revealed shapes per tile. On the main thread, `TileRenderer` keeps drawing clusters and points, and hands each tile's shapes to a reference-counted `ShapeLayer`, which draws each shape once through a `ShapeDrawer` (Cesium entities).

**Tech Stack:** TypeScript, Vite 5, Cesium 1.133, supercluster 8.0.1 (pinned), flatbush, turf 7, Vitest 2.

**Spec:** `docs/superpowers/specs/2026-10-29-shape-clustering-design.md`

## Global Constraints

- `supercluster` pinned to exactly `"8.0.1"` in `package.json` (no `^`).
- New dependencies: `flatbush@^4.4.0`, `@turf/point-on-feature@^7.1.0`, `@turf/along@^7.1.0`, `@turf/length@^7.1.0`, `@turf/bbox@^7.1.0`. Dev: `vitest@^2.1.9`, `@turf/boolean-point-in-polygon@^7.1.0`.
- `REVEAL_SIZE_PX = 32`. `SHAPE_POLYGON_FILL = "rgba(255, 140, 0, 0.35)"`, `SHAPE_POLYGON_OUTLINE = "#ff8c00"`, `SHAPE_LINE_COLOR = "#1e88e5"` (all in `src/map-constants.ts`).
- Reveal zoom: `R = ceil(log2(REVEAL_SIZE_PX / (s * TILE_SIZE_PX)))`. `s` is the larger bbox side in web-mercator world units (0..1). R is clamped to `maxZoom + 1`, and `s = 0` gives `maxZoom + 1`. Shapes with `R <= 0` never enter the cluster index.
- Worker-side code (`src/indexing/**`, `src/map-constants.ts`, `src/cluster-worker.ts`) must not import Cesium.
- Tests: Vitest, `src/**/*.test.ts`, names `<method> given <use case>`, `// given` / `// when` / `// then` comments in every test (given may be empty), data from `src/test-utils/feature-builders.ts`, random values where the exact value does not matter.
- Files use LF line endings (the repo stores LF). On this Windows machine, check `git diff --stat` after writing files: a whole-file diff means CRLF crept in.
- Commit messages end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The vector tiles flow (`vector-layer-renderer.ts`, commented lines in `main.ts`) stays untouched.

## Review Focus

1. **Features without an `id`** (common in real GeoJSON): each gets a unique `featureId` (`String(index)` fallback), so shapes don't collide in `ShapeLayer` or picking. Test in Task 3.
2. **A dataset with no clusterable items** (only shapes with `R <= 0`): building must not throw, and tiles return `features: []` plus the shapes. Test in Task 3.
3. **Polygon with a hole:** the anchor must not fall inside the hole (a centroid of a ring with a centred hole does). Test in Task 1.
4. **Zero-length line** (all vertices equal): the anchor is that vertex and `R = maxZoom + 1`, with no exception. Test in Task 1.
5. **Tile with no data at all:** Supercluster's `getTile` returns `null`. `FeatureIndex.getTile` must return `{ features: [], shapes: [] }`. Test in Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/indexing/mercator.ts` (new) | Pure web-mercator helpers: `lngX`, `latY`, `tileBBox` |
| `src/indexing/reveal.ts` (new) | `revealZoom(bbox, maxZoom)`, `anchorPoint(geometry)` |
| `src/indexing/reveal-supercluster.ts` (new) | `RevealSupercluster`: Supercluster with shapes added at their reveal level |
| `src/indexing/feature-index.ts` (new) | `toIndexItems`, `FeatureIndex` (cluster index + Flatbush shape index, tile query, leaves) |
| `src/rendering/shape-layer.ts` (new) | `ShapeDrawer` interface, `ShapeLayer` (ref counting per tile) |
| `src/rendering/entity-shape-drawer.ts` (new) | `EntityShapeDrawer`: `ShapeDrawer` using Cesium entities |
| `src/test-utils/feature-builders.ts` (new) | Test data builders |
| `src/global.d.ts` | `TileShape` type, `build` request and `tile` response shapes |
| `src/cluster-worker.ts`, `src/cluster-worker-client.ts` | Use `FeatureIndex`; send shapes with tiles |
| `src/rendering/tile-renderer.ts`, `src/picking.ts`, `src/data.ts`, `src/main.ts`, `index.html`, `src/map-constants.ts` | Integration |

The spec's single `src/shape-index.ts` is split into the four focused `src/indexing/` files above. The spec's `shape-index.test.ts` is split the same way (`reveal-supercluster.test.ts`, `feature-index.test.ts`).

---

### Task 1: Test setup, mercator and reveal helpers

**Files:**
- Modify: `package.json`, `vite.config.ts`, `src/map-constants.ts`
- Create: `src/indexing/mercator.ts`, `src/indexing/reveal.ts`, `src/test-utils/feature-builders.ts`
- Test: `src/indexing/reveal.test.ts`

**Interfaces:**
- Produces:
  - `lngX(lng: number): number` and `latY(lat: number): number`: the same formulas as Supercluster's module-private ones (`node_modules/supercluster/index.js:408-415`), so results are bit-identical.
  - `tileBBox(z: number, x: number, y: number): BBox`: `[west, south, east, north]` in degrees.
  - `revealZoom(bbox: BBox, maxZoom: number, revealSizePx?: number): number` (default `REVEAL_SIZE_PX`).
  - `anchorPoint(geometry: GeoJSON.Polygon | GeoJSON.LineString): [number, number]`.
  - `REVEAL_SIZE_PX` and the `SHAPE_*` colors in `map-constants.ts`.
  - Builders:
    - `randomPoints(count: number, bbox: BBox): Feature<Point>[]` (random UUID ids)
    - `squarePolygon(center: [number, number], sideDeg: number, id?: string): Feature<Polygon>`
    - `squareWithHole(center: [number, number], sideDeg: number): Feature<Polygon>` (hole = centred square of half the side)
    - `uShapedPolygon(center: [number, number], sizeDeg: number): Feature<Polygon>` (centroid outside the shape)
    - `rectanglePolygon(bbox: BBox, id?: string): Feature<Polygon>`
    - `straightLine(start: [number, number], lengthDeg: number, id?: string): Feature<LineString>` (2 vertices, due east)
    - `randomLocation(bbox: BBox): [number, number]`
    - `tilesCovering(bbox: BBox, z: number): { x: number; y: number }[]`

- [ ] **Step 1: Add dependencies and the test setup**

```
npm install --save-exact supercluster@8.0.1
npm install flatbush@^4.4.0 @turf/point-on-feature@^7.1.0 @turf/along@^7.1.0 @turf/length@^7.1.0 @turf/bbox@^7.1.0
npm install -D vitest@^2.1.9 @turf/boolean-point-in-polygon@^7.1.0
```

- In `package.json` scripts, add `"test": "vitest run"`.
- In `vite.config.ts`, add `/// <reference types="vitest" />` and `test: { environment: "node", include: ["src/**/*.test.ts"] }`.
- In `map-constants.ts`, add `REVEAL_SIZE_PX` and the three `SHAPE_*` colors (values in Global Constraints), each with a one-line comment.
- Write the builders in `src/test-utils/feature-builders.ts`.

- [ ] **Step 2: Write the failing tests** in `src/indexing/reveal.test.ts`

```ts
describe("revealZoom", () => {
    it("revealZoom given a shape 1/256 of the world wide returns 5", () => {
        // given: 1/256 of the world = 1px at z0, so 32px is reached at z5
        const bbox: BBox = [0, 0, 360 / 256, 0];
        // when
        const zoom = revealZoom(bbox, 18);
        // then
        expect(zoom).toBe(5);
    });
    it("revealZoom given a zero-size bbox returns maxZoom + 1", () => {
        // given
        const [lon, lat] = randomLocation([30, 30, 40, 40]);
        // when / then
        expect(revealZoom([lon, lat, lon, lat], 18)).toBe(19);
    });
    it("revealZoom given a tiny shape clamps to maxZoom + 1", () => {
        // given
        const bbox: BBox = [35, 31, 35 + 1e-9, 31 + 1e-9];
        // when / then
        expect(revealZoom(bbox, 18)).toBe(19);
    });
    it("revealZoom given a world-sized shape returns <= 0", () => {
        // given
        const bbox: BBox = [-180, -85, 180, 85];
        // when / then
        expect(revealZoom(bbox, 18)).toBeLessThanOrEqual(0);
    });
});

describe("anchorPoint", () => {
    it("anchorPoint given a U-shaped polygon returns a point on the polygon", () => {
        // given: its centroid lies in the gap of the U
        const polygon = uShapedPolygon(randomLocation([30, 30, 40, 40]), 0.1);
        // when
        const anchor = anchorPoint(polygon.geometry);
        // then
        expect(booleanPointInPolygon(anchor, polygon)).toBe(true);
    });
    it("anchorPoint given a polygon with a centred hole returns a point outside the hole", () => {
        // given
        const polygon = squareWithHole(randomLocation([30, 30, 40, 40]), 0.1);
        // when
        const anchor = anchorPoint(polygon.geometry);
        // then: booleanPointInPolygon respects holes
        expect(booleanPointInPolygon(anchor, polygon)).toBe(true);
    });
    it("anchorPoint given a straight line returns its middle", () => {
        // given
        const line = straightLine([0, 0], 2);
        // when
        const [lon, lat] = anchorPoint(line.geometry);
        // then
        expect(lon).toBeCloseTo(1, 6);
        expect(lat).toBeCloseTo(0, 6);
    });
    it("anchorPoint given a zero-length line returns its vertex", () => {
        // given
        const vertex = randomLocation([30, 30, 40, 40]);
        const line: GeoJSON.LineString = { type: "LineString", coordinates: [vertex, vertex] };
        // when / then
        expect(anchorPoint(line)).toEqual(vertex);
    });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/indexing/reveal.test.ts`
Expected: FAIL (cannot resolve `./reveal`).

- [ ] **Step 4: Implement `mercator.ts` and `reveal.ts`**

- `revealZoom`: `s = max(lngX(east) - lngX(west), latY(south) - latY(north))`. Return `maxZoom + 1` for `s <= 0`, otherwise `min(maxZoom + 1, ceil(log2(revealSizePx / (s * TILE_SIZE_PX))))`.
- `anchorPoint`:
  - Polygon: `pointOnFeature` (`@turf/point-on-feature`) coordinates.
  - LineString: `along(line, length(line) / 2)` (`@turf/along`, `@turf/length`). If `length === 0`, return the first vertex.
- `tileBBox`: the inverse of the tile math used in `tile-renderer.ts` (`lon = x / 2^z * 360 - 180`, `lat = atan(sinh(π(1 - 2y / 2^z)))` in degrees).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/indexing/reveal.test.ts` → Expected: 8 passed.
Run: `npx tsc --noEmit -p .` → Expected: no output.

- [ ] **Step 6: Commit**

```
git add package.json package-lock.json vite.config.ts src/map-constants.ts src/indexing src/test-utils
git commit -m "feat: add reveal zoom and anchor point helpers with test setup"
```

---

### Task 2: RevealSupercluster

**Files:**
- Create: `src/indexing/reveal-supercluster.ts`
- Test: `src/indexing/reveal-supercluster.test.ts`

**Interfaces:**
- Consumes: `lngX`, `latY` (Task 1).
- Produces: `class RevealSupercluster<P extends { revealZoom?: number }, C extends Supercluster.AnyProps> extends Supercluster<P, C>`, same constructor options as Supercluster. `load(points)` reads `properties.revealZoom` (missing = `Infinity`, an always-clusterable point).

- [ ] **Step 1: Write the failing tests** in `src/indexing/reveal-supercluster.test.ts`

```ts
const OPTIONS = { minPoints: 2, radius: 64 * 4096 / 256, extent: 4096, maxZoom: 18 };
const BBOX: BBox = [34.9, 31.0, 35.1, 31.2];

it("load given points only produces identical tiles to Supercluster", () => {
    // given
    const points = randomPoints(5000, BBOX);
    const plain = new Supercluster(OPTIONS).load(points);
    const reveal = new RevealSupercluster(OPTIONS).load(points);
    // when / then
    for (const z of [0, 5, 10, 15]) {
        for (const { x, y } of tilesCovering(BBOX, z)) {
            expect(reveal.getTile(z, x, y)).toEqual(plain.getTile(z, x, y));
        }
    }
});

it("load given a shape anchor with revealZoom R puts it in a cluster at R - 1 only", () => {
    // given: dense points around the anchor, so it is clustered at R - 1
    const center = randomLocation(BBOX);
    const R = 10;
    const anchor = { type: "Feature", id: "shape-1", properties: { revealZoom: R },
                     geometry: { type: "Point", coordinates: center } } as const;
    const points = randomPoints(200, [center[0] - 0.01, center[1] - 0.01, center[0] + 0.01, center[1] + 0.01]);
    const index = new RevealSupercluster(OPTIONS).load([...points, anchor]);
    const world: BBox = [-180, -85, 180, 85];
    const inClusters = (z: number) => index.getClusters(world, z)
        .filter(f => f.properties.cluster)
        .some(c => index.getLeaves(c.properties.cluster_id, Infinity).some(l => l.id === "shape-1"));
    const asSingle = (z: number) => index.getClusters(world, z).some(f => !f.properties.cluster && f.id === "shape-1");
    // when / then
    expect(inClusters(R - 1)).toBe(true);
    expect(inClusters(R)).toBe(false);
    expect(asSingle(R)).toBe(true);        // still in trees[R]; FeatureIndex filters it out
    expect(inClusters(R + 1) || asSingle(R + 1)).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/indexing/reveal-supercluster.test.ts`
Expected: FAIL (cannot resolve `./reveal-supercluster`).

- [ ] **Step 3: Implement `RevealSupercluster.load` in `src/indexing/reveal-supercluster.ts`**

Access the internals through a typed cast, not `any` scattered around:

```ts
// Supercluster 8.0.1 internals this subclass depends on (see node_modules/supercluster/index.js)
interface SuperclusterInternals {
    options: Required<Supercluster.Options<any, any>>;
    trees: Array<KDBushWithData>;   // KDBush instance with a `data: number[]` field set by _createTree
    points: Array<GeoJSON.Feature<GeoJSON.Point>>;
    stride: number;
    _createTree(data: number[]): KDBushWithData;
    _cluster(tree: KDBushWithData, zoom: number): number[];
}
```

Algorithm, a copy of the library's `load()` (`index.js:39-87`) with the marked change:

```
this.points = points
level(i) = min(points[i].properties?.revealZoom ?? Infinity, maxZoom + 1)
pushItem(data, i): data.push(fround(lngX(lng)), fround(latY(lat)), Infinity, i, -1, 1); if reduce: data.push(0)
   (skip points without geometry, as the library does)
data = [items with level === maxZoom + 1]
trees[maxZoom + 1] = _createTree(data)
for z = maxZoom down to minZoom:
    // CHANGE: add the shapes that become points below level z + 1
    if any items have level === z + 1 (and z + 1 <= maxZoom):
        trees[z + 1] = _createTree([...trees[z + 1].data, ...those items])
    trees[z] = _createTree(_cluster(trees[z + 1], z))
return this
```

Group the item indices by level once, before the loop (a `Map<number, number[]>`). Keep `log` timing out (YAGNI). Add a header comment saying that it mirrors supercluster 8.0.1 `load()`, and that the equivalence test guards upgrades.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/indexing/reveal-supercluster.test.ts` → Expected: 2 passed.

- [ ] **Step 5: Commit**

```
git add src/indexing/reveal-supercluster.ts src/indexing/reveal-supercluster.test.ts
git commit -m "feat: add RevealSupercluster that adds shapes at their reveal zoom"
```

---

### Task 3: FeatureIndex

**Files:**
- Create: `src/indexing/feature-index.ts`
- Modify: `src/global.d.ts` (add `TileShape`)
- Test: `src/indexing/feature-index.test.ts`

**Interfaces:**
- Consumes: `revealZoom`, `anchorPoint`, `tileBBox` (Task 1), `RevealSupercluster` (Task 2), `EXTENT`, `TILE_SIZE_PX` (`map-constants.ts`).
- Produces:
  - In `global.d.ts`: `export type TileShape = { id: string; kind: "polygon" | "line"; coordinates: number[][][] | number[][] };`
  - In `feature-index.ts`:
    - `export type ItemKind = "point" | "polygon" | "line";`
    - `export type ItemProps = { kind: ItemKind; featureId: string; revealZoom: number };`
    - `export type ClusterBreakdown = { points: number; polygons: number; lines: number };`
    - `export type IndexOptions = { minPoints: number; radiusPx: number; maxZoom: number };`
    - `export type IndexedShape = TileShape & { bbox: BBox; revealZoom: number };`
    - `export function toIndexItems(features: GeoJSON.Feature<GeoJSON.Geometry | null>[], maxZoom: number): { items: GeoJSON.Feature<GeoJSON.Point, ItemProps>[]; shapes: IndexedShape[]; skipped: number }`
    - `export class FeatureIndex`:
      - `constructor(options: IndexOptions)`
      - `load(features: GeoJSON.Feature<GeoJSON.Geometry | null>[]): void`
      - `readonly skipped: number`
      - `getTile(z: number, x: number, y: number): { features: Supercluster.TileFeature<ItemProps, ClusterBreakdown>[]; shapes: TileShape[] }`
      - `getLeaves(clusterId: number): GeoJSON.Feature<GeoJSON.Point, ItemProps>[]`

- [ ] **Step 1: Write the failing tests** in `src/indexing/feature-index.test.ts`

```ts
const OPTIONS: IndexOptions = { minPoints: 2, radiusPx: 64, maxZoom: 18 };
const BBOX: BBox = [34.9, 31.0, 35.1, 31.2];
const owned = (f: { geometry: number[][] }) => {
    const [px, py] = f.geometry[0];
    return px >= 0 && px < EXTENT && py >= 0 && py < EXTENT;
};

it("getTile given a shape returns it as a point below R and as a shape from R on", () => {
    // given: a 0.01° square has R = 13; scan all data tiles, because the cluster that absorbs the shape
    // can be centred outside the polygon's own bbox
    const polygon = squarePolygon(randomLocation(BBOX), 0.01, "poly-1");
    const index = new FeatureIndex(OPTIONS);
    index.load([...randomPoints(500, BBOX), polygon]);
    const R = revealZoom(bbox(polygon) as BBox, OPTIONS.maxZoom);
    // when / then
    for (let z = R - 3; z <= R + 1; z++) {
        const tiles = tilesCovering(BBOX, z).map(({ x, y }) => index.getTile(z, x, y));
        const asPoint = tiles.some(t => t.features.some(f => owned(f) && (f.tags.cluster
            ? index.getLeaves(f.tags.cluster_id as number).some(l => l.properties.featureId === "poly-1")
            : f.id === "poly-1")));
        const asShape = tiles.some(t => t.shapes.some(s => s.id === "poly-1"));
        expect([z, asPoint, asShape]).toEqual([z, z < R, z >= R]);
    }
});

it("getTile given mixed data keeps counts and breakdowns consistent at every zoom", () => {
    // given
    const shapes = Array.from({ length: 300 }, (_, i) =>
        i % 2 ? squarePolygon(randomLocation(BBOX), Math.random() * 0.05) : straightLine(randomLocation(BBOX), Math.random() * 0.05));
    const points = randomPoints(3000, BBOX);
    const index = new FeatureIndex(OPTIONS);
    index.load([...points, ...shapes]);
    const R = new Map(shapes.map(s => [String(s.id), revealZoom(bbox(s) as BBox, OPTIONS.maxZoom)]));
    // shapes near the edge can have their anchor outside BBOX, so scan a padded area
    const padded: BBox = [BBOX[0] - 0.1, BBOX[1] - 0.1, BBOX[2] + 0.1, BBOX[3] + 0.1];
    for (const z of [0, 4, 8, 12]) {
        // when
        let total = 0;
        for (const { x, y } of tilesCovering(padded, z)) {
            for (const f of index.getTile(z, x, y).features.filter(owned)) {
                if (f.tags.cluster) {
                    const { points: p, polygons, lines, point_count } = f.tags as any;
                    expect(p + polygons + lines).toBe(point_count);
                    total += point_count;
                } else total += 1;
            }
        }
        // then
        const unrevealed = [...R.values()].filter(r => r > z).length;
        expect(total).toBe(points.length + unrevealed);
    }
});

it("load given missing and Multi geometries skips and counts them", () => {
    // given
    const bad = [
        { type: "Feature", properties: {}, geometry: null },
        { type: "Feature", properties: {}, geometry: { type: "MultiPolygon", coordinates: [] } },
    ] as GeoJSON.Feature<GeoJSON.Geometry | null>[];
    const index = new FeatureIndex(OPTIONS);
    // when
    index.load([...randomPoints(100, BBOX), ...bad]);
    // then
    expect(index.skipped).toBe(2);
});

it("toIndexItems given features without ids assigns unique featureIds", () => {
    // given
    const features = randomPoints(3, BBOX).map(({ id, ...rest }) => rest) as GeoJSON.Feature[];
    // when
    const { items } = toIndexItems(features, 18);
    // then
    expect(new Set(items.map(i => i.properties.featureId)).size).toBe(3);
});

it("getTile given only world-sized shapes returns no features and the shapes", () => {
    // given: 300° wide, so R <= 0 and nothing enters the cluster index
    const huge = rectanglePolygon([-150, -60, 150, 60], "huge");
    const index = new FeatureIndex(OPTIONS);
    // when
    index.load([huge]);
    const tile = index.getTile(2, 2, 1);
    // then
    expect(tile.features).toEqual([]);
    expect(tile.shapes.map(s => s.id)).toEqual(["huge"]);
});

it("getTile given a tile without data returns empty features and shapes", () => {
    // given
    const index = new FeatureIndex(OPTIONS);
    index.load(randomPoints(100, BBOX));
    // when: a tile on the other side of the world
    const tile = index.getTile(10, 0, 0);
    // then
    expect(tile).toEqual({ features: [], shapes: [] });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/indexing/feature-index.test.ts`
Expected: FAIL (cannot resolve `./feature-index`).

- [ ] **Step 3: Implement `toIndexItems` and `FeatureIndex`**

- `toIndexItems`:
  - `featureId = String(feature.id ?? index)`.
  - Point → item with `revealZoom: Infinity`.
  - Polygon / LineString → `bbox` (`@turf/bbox`), `R = revealZoom(bbox, maxZoom)`, an `IndexedShape` (`coordinates` = the GeoJSON coordinates), plus an anchor item when `R > 0`.
  - Every item has `id: featureId`.
  - Null geometry and any other type → `skipped++`.
- `FeatureIndex.load`:
  - Builds `RevealSupercluster` with `{ minPoints, maxZoom, extent: EXTENT, radius: radiusPx * EXTENT / TILE_SIZE_PX, map, reduce }`. `map` turns `kind` into `{ points, polygons, lines }` (1 for its own kind, 0 otherwise), and `reduce` sums them.
  - Builds `Flatbush` over the shapes with `revealZoom <= maxZoom`; keeps a `shapes[]` array in the same order as the Flatbush items.
  - Logs `skipped` once with `console.warn` when it is above 0.
- `getTile`:
  - `features` = `(cluster.getTile(z, x, y)?.features ?? [])`, minus the non-cluster features with `tags.revealZoom <= z`.
  - `shapes` = Flatbush `search(...tileBBox(z, x, y))`, filtered by `revealZoom <= z`, mapped to `{ id, kind, coordinates }`.
- `getLeaves(clusterId)` = `cluster.getLeaves(clusterId, Infinity, 0)`.
- If Flatbush has zero items, skip creating it (`new Flatbush(0)` throws); `search` then returns `[]`.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run` → Expected: all passed (Tasks 1–3).
Run: `npx tsc --noEmit -p .` → Expected: no output.

- [ ] **Step 5: Commit**

```
git add src/global.d.ts src/indexing/feature-index.ts src/indexing/feature-index.test.ts
git commit -m "feat: add FeatureIndex combining clusters and revealed shapes per tile"
```

---

### Task 4: ShapeLayer

**Files:**
- Create: `src/rendering/shape-layer.ts`
- Test: `src/rendering/shape-layer.test.ts`

**Interfaces:**
- Consumes: `TileShape` (`global.d.ts`, Task 3).
- Produces:
  - `export interface ShapeDrawer { add(shape: TileShape): void; remove(id: string): void; count(): number }`
  - `export class ShapeLayer { constructor(drawer: ShapeDrawer); addTile(tileKey: string, shapes: TileShape[]): void; removeTile(tileKey: string): void; count(): number }`

- [ ] **Step 1: Write the failing tests** with a recording fake drawer (defined at the end of the test file)

```ts
it("addTile given the same shape in two tiles draws it once", () => {
    // given
    const drawer = new FakeDrawer(); const layer = new ShapeLayer(drawer); const shape = randomShape();
    // when
    layer.addTile("10/1/1", [shape]); layer.addTile("10/1/2", [shape]);
    // then
    expect(drawer.added).toEqual([shape.id]);
});
it("removeTile given a shape in two tiles removes it only after both are removed", () => {
    // given
    const drawer = new FakeDrawer(); const layer = new ShapeLayer(drawer); const shape = randomShape();
    layer.addTile("10/1/1", [shape]); layer.addTile("10/1/2", [shape]);
    // when
    layer.removeTile("10/1/1");
    // then
    expect(drawer.removed).toEqual([]);
    // when
    layer.removeTile("10/1/2");
    // then
    expect(drawer.removed).toEqual([shape.id]);
});
it("addTile given a zoom swap keeps a shared shape without redrawing it", () => {
    // given: zoom 10 tile ready, then zoom 11 tiles arrive before the zoom 10 tile is removed (stale tiles)
    const drawer = new FakeDrawer(); const layer = new ShapeLayer(drawer); const shape = randomShape();
    layer.addTile("10/1/1", [shape]);
    // when
    layer.addTile("11/2/2", [shape]); layer.removeTile("10/1/1");
    // then
    expect(drawer.added).toEqual([shape.id]);
    expect(drawer.removed).toEqual([]);
});
it("removeTile given an unknown tile does nothing", () => {
    // given
    const drawer = new FakeDrawer(); const layer = new ShapeLayer(drawer);
    // when
    layer.removeTile("3/1/1");
    // then
    expect(drawer.removed).toEqual([]);
});
```

`randomShape()` (a helper at the end of the file) returns `{ id: crypto.randomUUID(), kind: "line", coordinates: [[0, 0], [1, 1]] }`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/rendering/shape-layer.test.ts` → Expected: FAIL (cannot resolve `./shape-layer`).

- [ ] **Step 3: Implement `ShapeLayer`**

Keep `Map<string, number>` (ref counts) and `Map<string, string[]>` (tile → shape ids). `addTile` on an already-known tile key is ignored, so a tile is never counted twice.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/rendering/shape-layer.test.ts` → Expected: 4 passed.

- [ ] **Step 5: Commit**

```
git add src/rendering/shape-layer.ts src/rendering/shape-layer.test.ts
git commit -m "feat: add ref-counted ShapeLayer"
```

---

### Task 5: Worker protocol

**Files:**
- Modify: `src/global.d.ts`, `src/cluster-worker.ts`, `src/cluster-worker-client.ts`

**Interfaces:**
- Consumes: `FeatureIndex`, `IndexOptions` (Task 3), `TileShape`.
- Produces:
  - `WorkerRequest` `build`: `{ type: "build"; features: GeoJSON.Feature<GeoJSON.Geometry>[]; options: IndexOptions }`.
  - `WorkerResponse` / `TileResponse` `tile`: adds `shapes: TileShape[]`.
  - `ClusterWorkerClient.build(features: GeoJSON.Feature<GeoJSON.Geometry>[], options: IndexOptions)`.
  - `leaves` responses carry `Feature<Point, ItemProps>` (`kind`, `featureId`).

- [ ] **Step 1: Replace the worker's Supercluster usage with `FeatureIndex`**

- `build` → `index = new FeatureIndex(msg.options); index.load(msg.features)`, then post `built`.
- `tile` → `const { features, shapes } = index.getTile(z, x, y)`, then post `{ type: "tile", z, x, y, extent: EXTENT, features, shapes }`.
- `leaves` → `index.getLeaves(cluster_id)`.
- Remove the radius conversion from the worker (`FeatureIndex` does it now). Remove the `clusters` request/response (unused since `ClusterRenderer` is not wired). Keep the `buildVectorTiles` / `getVectorTile` handlers unchanged.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit -p .`
Expected: errors only in `main.ts` / `picking.ts` / `cluster-renderer.ts` call sites of the changed signatures. Fix `cluster-renderer.ts` by deleting it and its export in `rendering/index.ts`: it depends on the removed `clusters` request and is not wired. The other two call sites are updated in Task 6.

- [ ] **Step 3: Commit** (together with Task 6, when everything compiles; do not commit a non-compiling tree)

---

### Task 6: Rendering integration, data and docs

**Files:**
- Create: `src/rendering/entity-shape-drawer.ts`
- Modify: `src/rendering/tile-renderer.ts`, `src/picking.ts`, `src/data.ts`, `src/main.ts`, `index.html`, `docs/cluster-flow.md`

**Interfaces:**
- Consumes: `ShapeLayer`, `ShapeDrawer` (Task 4), `TileResponse.shapes` (Task 5), `SHAPE_*` colors.
- Produces:
  - `class EntityShapeDrawer implements ShapeDrawer { constructor(viewer: Viewer) }`
  - `buildRandomShapeFeatures(polygonCount: number, lineCount: number, bbox: BBox): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString>[]`
  - `setupPicking(viewer, client, features: GeoJSON.Feature<GeoJSON.Geometry>[])`

- [ ] **Step 1: `EntityShapeDrawer`**

- A `CustomDataSource("shapes")` added to `viewer.dataSources`. Entity id is `shape:${id}`, and `properties: { featureId: id }`.
- Polygon: `hierarchy` = outer ring plus holes (`PolygonHierarchy`, `Cartesian3.fromDegreesArray`), `height: 0`, `material: Color.fromCssColorString(SHAPE_POLYGON_FILL)`, `outline: true`, `outlineColor: Color.fromCssColorString(SHAPE_POLYGON_OUTLINE)`.
- Line: `positions`, `width: 2`, `material: Color.fromCssColorString(SHAPE_LINE_COLOR)`.
- `remove(id)` → `entities.removeById("shape:" + id)`. `count()` → `entities.values.length`.
- Call `viewer.scene.requestRender()` after `add` / `remove`.

- [ ] **Step 2: `TileRenderer`**

- Field `private readonly shapeLayer = new ShapeLayer(new EntityShapeDrawer(this.viewer))`. Initialise it in the constructor after `super`.
- `drawTile` passes `tile.shapes` into `processTileFeatures`, which calls `this.shapeLayer.addTile(tileKey, shapes)` before `updateTileRendered`.
- `removeTile(tileKey)` calls `this.shapeLayer.removeTile(tileKey)`.
- Override `updateHUD()`: call `super.updateHUD()`, then set `#hudShapes` to `this.shapeLayer.count()`.

- [ ] **Step 3: HUD, picking, data, main**

- `index.html`: add `<div>Shapes (drawn): <code id="hudShapes">0</code></div>` after the points line.
- `picking.ts`:
  - For a picked `Entity` (`p.id instanceof Entity`), log `byId.get(entity.properties.featureId.getValue())`.
  - The leaves listener logs `leafFeatures.map(l => byId.get(l.properties.featureId))`.
  - `buildFeatureIndex` and the `features` parameter accept `Feature<Geometry>[]`.
- `data.ts`: `buildRandomShapeFeatures` splits each count evenly over the size buckets `[0.001, 0.01, 0.1, 0.5]` degrees (about 100 m, 1 km, 10 km, 50 km):
  - polygons: `randomPolygon(n, { bbox, max_radial_length: size })`;
  - lines: `randomLineString(n, { bbox, num_vertices: 10, max_length: size / 9 })`;
  - unique ids via `ensureId()`.
- `main.ts`: `features = [...buildRandomPointFeatures(60_000, bbox), ...buildRandomShapeFeatures(30_000, 10_000, bbox)]`, `client.build(features, { minPoints: 2, radiusPx: CLUSTER_RADIUS_PX, maxZoom })`, `setupPicking(viewer, client, features)`. Leave the commented vector-tiles lines as they are.

- [ ] **Step 4: Docs**

In `docs/cluster-flow.md`, add a "Shapes" section summarising:
- the reveal zoom and anchor point;
- `RevealSupercluster` and the pinned version with the upgrade check (`npm test`);
- `ShapeLayer` ref counting;
- the brief double representation on a zoom change.

Link the spec.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p .` → Expected: no output.
Run: `npx vitest run` → Expected: all passed.
Run: `npx vite build` → Expected: `✓ built`, then delete `dist/`.
Run: `git diff --stat` → Expected: no whole-file diffs (LF check).
Manual (`npm run dev`):
- When zoomed out, the 10 km / 50 km polygons are visible next to the bubbles.
- Zooming in, smaller shapes come out of their bubbles and are drawn as geometry.
- Once tiles settle, no shape is visible both as geometry and inside a bubble.
- The "Shapes (drawn)" HUD changes as you zoom.
- Clicking a cluster logs shapes among its members; clicking a shape logs its feature.

- [ ] **Step 6: Commit (Tasks 5 and 6)**

```
git add -A
git commit -m "feat: draw revealed shapes and cluster unrevealed ones in the cluster flow"
```
