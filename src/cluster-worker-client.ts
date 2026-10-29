import type { TileShape, WorkerRequest, WorkerResponse } from "./global";
import type { IndexOptions, ItemProps, TileItem } from "./indexing/feature-index";
import type * as GeoJSON from 'geojson';

export type LeafFeature = GeoJSON.Feature<GeoJSON.Point, ItemProps>;
export type TileResponse = { type: "tile"; z: number; x: number; y: number; extent: number; features: TileItem[]; shapes: TileShape[] };
export type VectorTileResponse = { type: "vectorTile"; z: number; x: number; y: number; features: GeoJSON.Feature<GeoJSON.Geometry>[] };

export class ClusterWorkerClient {
    private worker: Worker;
    private builtHandlers: Array<() => void> = [];
    private leafHandlers: Array<(features: LeafFeature[]) => void> = [];
    private tileHandlers: Array<(tile: TileResponse) => void> = [];
    private vectorTileHandlers: Array<(tile: VectorTileResponse) => void> = [];
    private indexBuilt = false;

    constructor(worker: Worker) {
        this.worker = worker;
        this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
            const data = e.data as WorkerResponse;
            if (data.type === "built") {
                this.indexBuilt = true;
                this.builtHandlers.forEach((h) => h());
                return;
            }
            if (data.type === "leaves") {
                const features = data.features as LeafFeature[];
                this.leafHandlers.forEach((h) => h(features));
                return;
            }
            if (data.type === "tile") {
                const tile = data as unknown as TileResponse;
                this.tileHandlers.forEach((h) => h(tile));
                return;
            }
            if (data.type === "vectorTile") {
                const tile = data as unknown as VectorTileResponse;
                this.vectorTileHandlers.forEach((h) => h(tile));
                return;
            }
        };
    }

    // subscribe hooks
    addBuiltListener(handler: () => void) {
        this.builtHandlers.push(handler);
    }

    addLeavesListener(handler: (features: LeafFeature[]) => void) {
        this.leafHandlers.push(handler);
    }

    addTileListener(handler: (tile: TileResponse) => void) {
        this.tileHandlers.push(handler);
    }

    removeBuiltListener(handler: () => void) {
        this.builtHandlers = this.builtHandlers.filter(h => h !== handler);
    }

    removeLeavesListener(handler: (features: LeafFeature[]) => void) {
        this.leafHandlers = this.leafHandlers.filter(h => h !== handler);
    }

    removeTileListener(handler: (tile: TileResponse) => void) {
        this.tileHandlers = this.tileHandlers.filter((h) => h !== handler);
    }

    // Vector tile methods
    buildVectorTiles(features: GeoJSON.FeatureCollection<GeoJSON.Geometry>, options?: any) {
        this.worker.postMessage({ type: "buildVectorTiles", features, options } as WorkerRequest);
    }

    getVectorTile(z: number, x: number, y: number) {
        this.worker.postMessage({ type: "getVectorTile", z, x, y } as WorkerRequest);
    }

    addVectorTileListener(handler: (tile: VectorTileResponse) => void) {
        this.vectorTileHandlers.push(handler);
    }

    removeVectorTileListener(handler: (tile: VectorTileResponse) => void) {
        this.vectorTileHandlers = this.vectorTileHandlers.filter((h) => h !== handler);
    }

    // posting methods
    build(features: GeoJSON.Feature<GeoJSON.Geometry>[], options: IndexOptions) {
        const msg: WorkerRequest = { type: "build", features, options };
        this.worker.postMessage(msg);
    }

    leaves(cluster_id: number) {
        const msg: WorkerRequest = { type: "leaves", cluster_id } as any;
        this.worker.postMessage(msg);
    }

    tile(z: number, x: number, y: number) {
        const msg: WorkerRequest = { type: "tile", z, x, y } as any;
        this.worker.postMessage(msg);
    }

    isIndexBuilt(): boolean {
        return this.indexBuilt;
    }
}

