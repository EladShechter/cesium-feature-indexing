declare const CESIUM_BASE_URL: string; // set by Vite define


export type BBox = [number, number, number, number];

export type WorkerRequest =
    | { type: "build"; points: GeoJSON.Feature<GeoJSON.Point>[]; options?: any }
    | { type: "clusters"; bbox: BBox; zoom: number }
    | { type: "leaves"; cluster_id: number };

export type WorkerResponse =
    | { type: "built"; ok: true }
    | { type: "clusters"; features: GeoJSON.Feature<GeoJSON.Point, any>[] }
    | { type: "leaves"; features: GeoJSON.Feature<GeoJSON.Point>[] };
