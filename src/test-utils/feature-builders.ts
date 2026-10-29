import type Supercluster from "supercluster";
import type { BBox } from "../global";

type Pos = [number, number];

export function randomLocation(bbox: BBox): Pos {
    const [west, south, east, north] = bbox;
    return [west + Math.random() * (east - west), south + Math.random() * (north - south)];
}

export function randomPoints(count: number, bbox: BBox): Supercluster.PointFeature<Supercluster.AnyProps>[] {
    return Array.from({ length: count }, () => ({
        type: "Feature" as const,
        id: crypto.randomUUID(),
        properties: {},
        geometry: { type: "Point" as const, coordinates: randomLocation(bbox) }
    }));
}

function polygon(rings: Pos[][], id: string = crypto.randomUUID()): GeoJSON.Feature<GeoJSON.Polygon> {
    return { type: "Feature", id, properties: {}, geometry: { type: "Polygon", coordinates: rings } };
}

function square(center: Pos, sideDeg: number): Pos[] {
    const h = sideDeg / 2;
    const [x, y] = center;
    return [[x - h, y - h], [x + h, y - h], [x + h, y + h], [x - h, y + h], [x - h, y - h]];
}

export function squarePolygon(center: Pos, sideDeg: number, id?: string): GeoJSON.Feature<GeoJSON.Polygon> {
    return polygon([square(center, sideDeg)], id);
}

// The hole is a centred square of half the side
export function squareWithHole(center: Pos, sideDeg: number): GeoJSON.Feature<GeoJSON.Polygon> {
    return polygon([square(center, sideDeg), square(center, sideDeg / 2)]);
}

// A "U" opening upwards: its centroid lies in the gap, outside the shape
export function uShapedPolygon(center: Pos, sizeDeg: number): GeoJSON.Feature<GeoJSON.Polygon> {
    const [cx, cy] = center;
    const u = sizeDeg / 3;
    const [x0, y0] = [cx - 1.5 * u, cy - 1.5 * u];
    const ring: Pos[] = [
        [x0, y0], [x0 + 3 * u, y0], [x0 + 3 * u, y0 + 3 * u], [x0 + 2 * u, y0 + 3 * u],
        [x0 + 2 * u, y0 + u], [x0 + u, y0 + u], [x0 + u, y0 + 3 * u], [x0, y0 + 3 * u], [x0, y0]
    ];
    return polygon([ring]);
}

export function rectanglePolygon(bbox: BBox, id?: string): GeoJSON.Feature<GeoJSON.Polygon> {
    const [w, s, e, n] = bbox;
    return polygon([[[w, s], [e, s], [e, n], [w, n], [w, s]]], id);
}

// Two vertices, due east
export function straightLine(start: Pos, lengthDeg: number, id: string = crypto.randomUUID()): GeoJSON.Feature<GeoJSON.LineString> {
    return {
        type: "Feature",
        id,
        properties: {},
        geometry: { type: "LineString", coordinates: [start, [start[0] + lengthDeg, start[1]]] }
    };
}

// Same tile selection as TileRenderer.computeCoveringTiles, minus antimeridian wrapping
export function tilesCovering(bbox: BBox, z: number): { x: number; y: number }[] {
    const [west, south, east, north] = bbox;
    const n = Math.pow(2, z);
    const tx = (lon: number) => Math.floor(((lon + 180) / 360) * n);
    const ty = (lat: number) => {
        const rad = (lat * Math.PI) / 180;
        return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
    };
    const clamp = (v: number) => Math.max(0, Math.min(n - 1, v));
    const tiles: { x: number; y: number }[] = [];
    for (let x = clamp(tx(west)); x <= clamp(tx(east)); x++) {
        for (let y = clamp(ty(north)); y <= clamp(ty(south)); y++) tiles.push({ x, y });
    }
    return tiles;
}
