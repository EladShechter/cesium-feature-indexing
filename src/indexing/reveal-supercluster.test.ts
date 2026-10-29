import Supercluster from "supercluster";
import { describe, expect, it } from "vitest";
import type { BBox } from "../global";
import { randomLocation, randomPoints, tilesCovering } from "../test-utils/feature-builders";
import { RevealSupercluster } from "./reveal-supercluster";

const OPTIONS = { minPoints: 2, radius: 64 * 4096 / 256, extent: 4096, maxZoom: 18 };
const BBOX: BBox = [34.9, 31.0, 35.1, 31.2];

describe("RevealSupercluster", () => {
    it("load given points only produces identical tiles to Supercluster", () => {
        // given
        const points = randomPoints(5000, BBOX);
        const plain = new Supercluster(OPTIONS).load(points);
        const reveal = new RevealSupercluster(OPTIONS).load(points);
        // when
        const tiles = tilesOf(reveal);
        // then
        expect(tiles).toEqual(tilesOf(plain));
    });

    it("load given points with map and reduce produces identical tiles to Supercluster", () => {
        // given
        const options = {
            ...OPTIONS,
            map: () => ({ n: 1 }),
            reduce: (acc: { n: number }, props: { n: number }) => { acc.n += props.n; },
        };
        const points = randomPoints(5000, BBOX);
        const plain = new Supercluster<object, { n: number }>(options).load(points);
        const reveal = new RevealSupercluster<object, { n: number }>(options).load(points);
        // when
        const tiles = tilesOf(reveal);
        // then
        expect(tiles).toEqual(tilesOf(plain));
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
        // when
        const clusteredBelow = inClusters(R - 1);
        const clusteredAt = inClusters(R);
        const singleAt = asSingle(R);
        const presentAbove = inClusters(R + 1) || asSingle(R + 1);
        // then
        expect(clusteredBelow).toBe(true);
        expect(clusteredAt).toBe(false);
        expect(singleAt).toBe(true);        // still in trees[R]; FeatureIndex filters it out
        expect(presentAbove).toBe(false);
    });
});

function tilesOf(index: { getTile(z: number, x: number, y: number): unknown }): unknown[] {
    return [0, 5, 10, 15].flatMap(z => tilesCovering(BBOX, z).map(({ x, y }) => index.getTile(z, x, y)));
}
