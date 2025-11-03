import { BBox } from "../global";
import { Cartesian3, Cartographic, Math as CesiumMath, Rectangle } from "cesium";

export interface TileCoord {
    x: number;
    y: number;
    z: number;
}

/**
 * Convert a tile coordinate to a bounding box in WGS84 (EPSG:4326)
 */
export function tileToBBox(x: number, y: number, z: number): BBox {
    // Convert tile coordinates to WGS84 coordinates
    const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
    const w = (x / Math.pow(2, z) * 360 - 180);
    const s = Math.PI - (2 * Math.PI * (y + 1)) / Math.pow(2, z);
    const e = ((x + 1) / Math.pow(2, z) * 360 - 180);
    
    // Convert to degrees
    const north = CesiumMath.toDegrees(Math.atan(Math.sinh(n)));
    const south = CesiumMath.toDegrees(Math.atan(Math.sinh(s)));
    
    return [w, south, e, north];
}

/**
 * Convert a bounding box to tile coordinates at the specified zoom level
 */
export function bboxToTile(bbox: BBox, z: number): TileCoord {
    const [w, s, e, n] = bbox;
    
    // Convert to tile coordinates
    const lat = CesiumMath.toRadians(n);
    const x = Math.floor((w + 180) / 360 * Math.pow(2, z));
    const y = Math.floor((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 * Math.pow(2, z));
    
    return { x, y, z };
}

/**
 * Get all tile coordinates that intersect with the given bounding box at the specified zoom level
 */
export function getTilesInBbox(bbox: BBox, z: number): TileCoord[] {
    const [w, s, e, n] = bbox;
    const start = bboxToTile([w, s, w, n], z);
    const end = bboxToTile([e, s, e, n], z);
    
    const tiles: TileCoord[] = [];
    
    for (let x = Math.min(start.x, end.x); x <= Math.max(start.x, end.x); x++) {
        for (let y = Math.min(start.y, end.y); y <= Math.max(start.y, end.y); y++) {
            // Skip tiles that are out of bounds
            if (x < 0 || y < 0 || x >= Math.pow(2, z) || y >= Math.pow(2, z)) {
                continue;
            }
            tiles.push({ x, y, z });
        }
    }
    
    return tiles;
}

/**
 * Convert a tile coordinate to a Cesium Rectangle
 */
export function tileToRectangle(x: number, y: number, z: number): Rectangle {
    const bbox = tileToBBox(x, y, z);
    return Rectangle.fromDegrees(bbox[0], bbox[1], bbox[2], bbox[3]);
}

/**
 * Generate a unique key for a tile
 */
export function getTileKey(x: number, y: number, z: number): string {
    return `${z}/${x}/${y}`;
}
