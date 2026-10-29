/// <reference lib="webworker" />
import Supercluster from "supercluster";
import GeoJSONVT from 'geojson-vt';
import type * as GeoJSON from 'geojson';

import type { BBox, WorkerRequest, WorkerResponse } from "./global";
import { CLUSTER_RADIUS_PX, EXTENT, TILE_SIZE_PX } from "./map-constants";

type Feature = GeoJSON.Feature<GeoJSON.Point>;

let index: Supercluster<any, any> | null = null;
let vectorTileIndex: any = null;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
    const msg = e.data;

    if (msg.type === "build") {
        // options.radius is in screen pixels, but supercluster measures radius in extent units
        const radiusPx = msg.options?.radius ?? CLUSTER_RADIUS_PX;
        index = new Supercluster({
            minPoints: 2,
            maxZoom: 18,
            ...(msg.options || {}),
            extent: EXTENT,
            radius: radiusPx * EXTENT / TILE_SIZE_PX
        });
        index.load(msg.points);
        const res: WorkerResponse = { type: "built", ok: true };
        postMessage(res);
        return;
    }
    
    if (msg.type === "buildVectorTiles") {
        vectorTileIndex = GeoJSONVT(msg.features, {
            maxZoom: 18,
            indexMaxZoom: 5,
            indexMaxPoints: 100000,
            tolerance: 3,
            extent: EXTENT,
            buffer: 64,
            lineMetrics: true,
            promoteId: null,
            generateId: false,
            debug: 0,
            ...(msg.options || {})
        });
        const res: WorkerResponse = { type: "built", ok: true };
        postMessage(res);
        return;
    }

    if (msg.type === "clusters") {
        if (!index) return;
        const { bbox, zoom } = msg;
        const features = index.getClusters(bbox as any as BBox, zoom);
        const res: WorkerResponse = { type: "clusters", features };
        postMessage(res);
        return;
    }

    if (msg.type === "leaves") {
        if (!index) return;
        let features: Feature[] = [];
        if (typeof msg.cluster_id === "number") {
            features = index.getLeaves(msg.cluster_id, Infinity, 0);
        }
        const res: WorkerResponse = { type: "leaves", features };
        postMessage(res);
        return;
    }

    if (msg.type === "tile") {
        if (!index) return;
        const { z, x, y } = msg;
        const tile = index.getTile(z, x, y);
        const extent = EXTENT;
        const features = tile?.features ?? [];
        const res: WorkerResponse = { type: "tile", z, x, y, extent, features };
        postMessage(res);
        return;
    }

    if (msg.type === "getVectorTile") {
        if (!vectorTileIndex) {
            postMessage({ type: "vectorTile", z: msg.z, x: msg.x, y: msg.y, features: [] });
            return;
        }
        
        const tile = vectorTileIndex.getTile(msg.z, msg.x, msg.y);
        const features = tile
            ? tile.features.flatMap((f: any) => toGeoJsonFeatures(f, msg.z, msg.x, msg.y))
            : [];

        postMessage({ 
            type: "vectorTile", 
            z: msg.z, 
            x: msg.x, 
            y: msg.y, 
            features: features as GeoJSON.Feature<GeoJSON.Geometry>[] 
        });
        return;
    }
};

// geojson-vt tile features use numeric types (1 = point, 2 = line, 3 = polygon) and tile-pixel
// coordinates in [0, EXTENT], so convert them back to lon/lat GeoJSON.
// Multi-part points/lines are split into one feature per part (all sharing the source id).
function toGeoJsonFeatures(f: any, z: number, x: number, y: number): GeoJSON.Feature<GeoJSON.Geometry>[] {
    const toLonLat = (p: [number, number]) => tilePixelToLonLat(p, z, x, y);
    const feature = (geometry: GeoJSON.Geometry): GeoJSON.Feature<GeoJSON.Geometry> =>
        ({ type: 'Feature', id: f.id, geometry, properties: f.tags });

    if (f.type === 1) {
        return f.geometry.map((p: [number, number]) => feature({ type: 'Point', coordinates: toLonLat(p) }));
    }
    if (f.type === 2) {
        return f.geometry.map((line: [number, number][]) => feature({ type: 'LineString', coordinates: line.map(toLonLat) }));
    }
    if (f.type === 3) {
        // NOTE: the first ring is treated as the outer ring and the rest as holes, so MultiPolygons are not supported
        return [feature({ type: 'Polygon', coordinates: f.geometry.map((ring: [number, number][]) => ring.map(toLonLat)) })];
    }
    return [];
}

function tilePixelToLonLat([px, py]: [number, number], z: number, x: number, y: number): [number, number] {
    const n = Math.pow(2, z);
    const worldX = (px / EXTENT + x) / n;
    const worldY = (py / EXTENT + y) / n;
    const lon = worldX * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY))) * 180) / Math.PI;
    return [lon, lat];
}
