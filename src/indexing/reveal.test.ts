import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { describe, expect, it } from "vitest";
import type { BBox } from "../global";
import { randomLocation, squareWithHole, straightLine, uShapedPolygon } from "../test-utils/feature-builders";
import { anchorPoint, revealZoom } from "./reveal";

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
        // when
        const zoom = revealZoom([lon, lat, lon, lat], 18);
        // then
        expect(zoom).toBe(19);
    });
    it("revealZoom given a tiny shape clamps to maxZoom + 1", () => {
        // given
        const bbox: BBox = [35, 31, 35 + 1e-9, 31 + 1e-9];
        // when
        const zoom = revealZoom(bbox, 18);
        // then
        expect(zoom).toBe(19);
    });
    it("revealZoom given a world-sized shape returns <= 0", () => {
        // given
        const bbox: BBox = [-180, -85, 180, 85];
        // when
        const zoom = revealZoom(bbox, 18);
        // then
        expect(zoom).toBeLessThanOrEqual(0);
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
        // when
        const anchor = anchorPoint(line);
        // then
        expect(anchor).toEqual(vertex);
    });
});
