import { randomPoint, randomLineString, randomPolygon } from "@turf/random";
import type { BBox } from "./global";

function ensureId(): string {
    // Prefer Web Crypto if available, otherwise simple fallback
    const c = (globalThis as any).crypto;
    if (c?.randomUUID) return c.randomUUID();
    return `${Date.now()}-${Math.random()}`;
}

export function buildRandomPointFeatures(N: number, bbox: BBox): GeoJSON.Feature<GeoJSON.Point>[] {
    const random = randomPoint(N, { bbox });
    random.features.forEach(feature => feature.id = ensureId());

    return random.features;
}

export function buildRandomLineStringFeatures(N: number, bbox: BBox): GeoJSON.Feature<GeoJSON.LineString>[] {
    const random = randomLineString(N, { bbox });
    random.features.forEach(feature => feature.id = ensureId());

    return random.features;
}

export function buildRandomPolygonFeatures(N: number, bbox: BBox): GeoJSON.Feature<GeoJSON.Polygon>[] {
    // turf's default max_radial_length is 10 degrees, larger than a country-sized bbox (turf throws)
    const random = randomPolygon(N, { bbox, max_radial_length: 0.01 });
    random.features.forEach(feature => feature.id = ensureId());

    return random.features;
}

// Size buckets in degrees (about 100 m, 1 km, 10 km, 50 km), so shapes reveal at very different zooms
const SHAPE_SIZES_DEG = [0.001, 0.01, 0.1, 0.5];

export function buildRandomShapeFeatures(polygonCount: number, lineCount: number, bbox: BBox): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString>[] {
    const features: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString>[] = [];
    for (const size of SHAPE_SIZES_DEG) {
        features.push(...randomPolygon(Math.round(polygonCount / SHAPE_SIZES_DEG.length), { bbox, max_radial_length: size }).features);
        features.push(...randomLineString(Math.round(lineCount / SHAPE_SIZES_DEG.length), { bbox, num_vertices: 10, max_length: size / 9 }).features);
    }
    features.forEach(feature => feature.id = ensureId());
    return features;
}

export function buildFeatureIndex(features: GeoJSON.Feature<GeoJSON.Geometry>[]): Map<string, GeoJSON.Feature<GeoJSON.Geometry>> {
    const byId = new Map<string, GeoJSON.Feature<GeoJSON.Geometry>>();
    features.forEach(feature => byId.set(String(feature.id), feature))
    return byId;
}
