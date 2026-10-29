// Worker-side: keep free of Cesium imports
import along from "@turf/along";
import length from "@turf/length";
import pointOnFeature from "@turf/point-on-feature";
import type { BBox } from "../global";
import { REVEAL_SIZE_PX, TILE_SIZE_PX } from "../map-constants";
import { latY, lngX } from "./mercator";

// Zoom from which a shape is drawn as geometry instead of a clusterable point: the first zoom where its
// larger bbox side reaches revealSizePx. Clamped to maxZoom + 1 (never revealed within the index).
export function revealZoom(bbox: BBox, maxZoom: number, revealSizePx: number = REVEAL_SIZE_PX): number {
    const [west, south, east, north] = bbox;
    const s = Math.max(lngX(east) - lngX(west), latY(south) - latY(north));
    if (s <= 0) return maxZoom + 1;
    return Math.min(maxZoom + 1, Math.ceil(Math.log2(revealSizePx / (s * TILE_SIZE_PX))));
}

// A point guaranteed to lie on the shape (a polygon centroid can fall outside it)
export function anchorPoint(geometry: GeoJSON.Polygon | GeoJSON.LineString): [number, number] {
    if (geometry.type === "Polygon") {
        return pointOnFeature(geometry).geometry.coordinates as [number, number];
    }
    const line: GeoJSON.Feature<GeoJSON.LineString> = { type: "Feature", properties: {}, geometry };
    const len = length(line);
    if (len === 0) return geometry.coordinates[0] as [number, number];
    return along(line, len / 2).geometry.coordinates as [number, number];
}
