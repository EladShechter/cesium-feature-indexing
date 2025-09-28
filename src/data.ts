import { randomPoint } from "@turf/random";
import type { BBox } from "./global";

export type Feature = GeoJSON.Feature<GeoJSON.Point>;

function ensureId(): string {
    // Prefer Web Crypto if available, otherwise simple fallback
    const c = (globalThis as any).crypto;
    if (c?.randomUUID) return c.randomUUID();
    return `${Date.now()}-${Math.random()}`;
}

export function buildRandomFeatures(N: number, bbox: BBox): Feature[] {
    const random = randomPoint(N, { bbox });
    random.features.forEach(feature => feature.id = ensureId());

    return random.features;
}

export function buildFeatureIndex(features: Feature[]): Map<string, Feature> {
    const byId = new Map<string, Feature>();
    features.forEach(feature => byId.set(String(feature.id), feature))
    return byId;
}
