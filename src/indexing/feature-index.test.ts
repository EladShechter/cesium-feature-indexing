import bbox from "@turf/bbox";
import { describe, expect, it } from "vitest";
import type { BBox } from "../global";
import { EXTENT } from "../map-constants";
import { randomLocation, randomPoints, rectanglePolygon, squarePolygon, straightLine, tilesCovering } from "../test-utils/feature-builders";
import { FeatureIndex, toIndexItems, type IndexOptions } from "./feature-index";
import { revealZoom } from "./reveal";

const OPTIONS: IndexOptions = { minPoints: 2, radiusPx: 64, maxZoom: 18 };
const BBOX: BBox = [34.9, 31.0, 35.1, 31.2];
const owned = (f: { geometry: number[][] }) => {
    const [px, py] = f.geometry[0];
    return px >= 0 && px < EXTENT && py >= 0 && py < EXTENT;
};

describe("FeatureIndex", () => {
    it("getTile given a shape returns it as a point below R and as a shape from R on", () => {
        // given: scan all data tiles, because the cluster that absorbs the shape
        // can be centred outside the polygon's own bbox
        const polygon = squarePolygon(randomLocation(BBOX), 0.01, "poly-1");
        const index = new FeatureIndex(OPTIONS);
        index.load([...randomPoints(500, BBOX), polygon]);
        const R = revealZoom(bbox(polygon) as BBox, OPTIONS.maxZoom);
        // when / then
        for (let z = R - 3; z <= R + 1; z++) {
            const tiles = tilesCovering(BBOX, z).map(({ x, y }) => index.getTile(z, x, y));
            const asPoint = tiles.some(t => t.features.some(f => owned(f) && ("cluster" in f.tags
                ? index.getLeaves(f.tags.cluster_id).some(l => l.properties.featureId === "poly-1")
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
                    if ("cluster" in f.tags) {
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
});
