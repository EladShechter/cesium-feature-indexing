import type { IndexOptions, ItemProps, TileItem } from './indexing/feature-index';

declare const CESIUM_BASE_URL: string; // set by Vite define

export type BBox = [number, number, number, number];

export type TileShape = { id: string; kind: "polygon" | "line"; coordinates: number[][][] | number[][] };

export type WorkerRequest =
    | { type: "build"; features: GeoJSON.Feature<GeoJSON.Geometry>[]; options: IndexOptions }
    | { type: "leaves"; cluster_id: number }
    | { type: "tile"; z: number; x: number; y: number }
    | { type: "buildVectorTiles"; features: GeoJSON.FeatureCollection<GeoJSON.Geometry>; options?: any }
    | { type: "getVectorTile"; z: number; x: number; y: number };

export type WorkerResponse =
    | { type: "built"; ok: true }
    | { type: "leaves"; features: GeoJSON.Feature<GeoJSON.Point, ItemProps>[] }
    | { type: "tile"; z: number; x: number; y: number; extent: number; features: TileItem[]; shapes: TileShape[] }
    | { type: "vectorTile"; z: number; x: number; y: number; features: Array<GeoJSON.Feature<GeoJSON.Geometry>> };
