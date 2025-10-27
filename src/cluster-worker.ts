/// <reference lib="webworker" />
import Supercluster from "supercluster";

import type { BBox, WorkerRequest, WorkerResponse } from "./global";

type Feature = GeoJSON.Feature<GeoJSON.Point>;

let index: Supercluster<any, any> | null = null;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
    const msg = e.data;

    if (msg.type === "build") {
        index = new Supercluster({
            minPoints: 2,
            radius: 40,   // pixels
            maxZoom: 18,  // web mercator zooms
            ...(msg.options || {})
        });
        index.load(msg.points);
        const res: WorkerResponse = { type: "built", ok: true };
        postMessage(res);
        return;
    }

    if (!index) return;

    if (msg.type === "clusters") {
        const { bbox, zoom } = msg;
        const features = index.getClusters(bbox as any as BBox, zoom);
        const res: WorkerResponse = { type: "clusters", features };
        postMessage(res);
        return;
    }

    if (msg.type === "leaves") {
        let features: Feature[] = [];
        if (index && typeof msg.cluster_id === "number") {
            features = index.getLeaves(msg.cluster_id, Infinity, 0);
        }
        const res: WorkerResponse = { type: "leaves", features };
        postMessage(res);
        return;
    }

    if (msg.type === "tile") {
        const { z, x, y } = msg;
        const tile = index.getTile(z, x, y);
        const extent = 4096;
        const features = tile?.features ?? [];
        const res: WorkerResponse = { type: "tile", z, x, y, extent, features };
        postMessage(res);
        return;
    }
};
