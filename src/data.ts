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

export function buildFeatureIndex(features: GeoJSON.Feature<GeoJSON.Geometry>[]): Map<string, GeoJSON.Feature<GeoJSON.Geometry>> {
    const byId = new Map<string, GeoJSON.Feature<GeoJSON.Geometry>>();
    features.forEach(feature => byId.set(String(feature.id), feature))
    return byId;
}
