/// <reference lib="webworker" />
import Supercluster from "supercluster";
import GeoJSONVT from 'geojson-vt';
import type * as GeoJSON from 'geojson';

import type { BBox, WorkerRequest, WorkerResponse } from "./global";

type Feature = GeoJSON.Feature<GeoJSON.Point>;

let index: Supercluster<any, any> | null = null;
let vectorTileIndex: any = null;
const EXTENT = 4096;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
    const msg = e.data;

    if (msg.type === "build") {
        index = new Supercluster({
            minPoints: 2,
            radius: 40,   // pixels
            maxZoom: 18,
            extent: EXTENT,
            // web mercator zooms
            ...(msg.options || {})
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
        const features = tile ? tile.features.map((f: any) => ({
            type: 'Feature',
            id: f.id,
            geometry: f.geometry,
            properties: f.tags
        })) : [];
        
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
