// Worker-side: keep free of Cesium imports
import type { BBox } from "../global";

// Same formulas as supercluster's module-private ones, so results are bit-identical.
// Longitude/latitude to spherical mercator in [0..1] range.
export function lngX(lng: number): number {
    return lng / 360 + 0.5;
}

export function latY(lat: number): number {
    const sin = Math.sin(lat * Math.PI / 180);
    const y = (0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI);
    return y < 0 ? 0 : y > 1 ? 1 : y;
}

// Inverse of the tile math in tile-renderer.ts: [west, south, east, north] in degrees
export function tileBBox(z: number, x: number, y: number): BBox {
    const n = Math.pow(2, z);
    const lon = (tx: number) => (tx / n) * 360 - 180;
    const lat = (ty: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
    return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}
