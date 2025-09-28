import type { BBox, WorkerRequest, WorkerResponse } from "./global";

export type ClustersFeature = GeoJSON.Feature<GeoJSON.Point, any>;
export type LeafFeature = GeoJSON.Feature<GeoJSON.Point>;

export class ClusterWorkerClient {
    private worker: Worker;
    private builtHandlers: Array<() => void> = [];
    private clusterHandlers: Array<(features: ClustersFeature[]) => void> = [];
    private leafHandlers: Array<(features: LeafFeature[]) => void> = [];
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
            if (data.type === "clusters") {
                const features = data.features as ClustersFeature[];
                this.clusterHandlers.forEach((h) => h(features));
                return;
            }
            if (data.type === "leaves") {
                const features = data.features as LeafFeature[];
                this.leafHandlers.forEach((h) => h(features));
                return;
            }
        };
    }

    // subscribe hooks
    addBuiltListener(handler: () => void) {
        this.builtHandlers.push(handler);
    }

    addClustersListener(handler: (features: ClustersFeature[]) => void) {
        this.clusterHandlers.push(handler);
    }

    addLeavesListener(handler: (features: LeafFeature[]) => void) {
        this.leafHandlers.push(handler);
    }

    removeBuiltListener(handler: () => void) {
        this.builtHandlers = this.builtHandlers.filter(h => h !== handler);
    }

    removeClustersListener(handler: (features: ClustersFeature[]) => void) {
        this.clusterHandlers = this.clusterHandlers.filter(h => h !== handler);
    }

    removeLeavesListener(handler: (features: LeafFeature[]) => void) {
        this.leafHandlers = this.leafHandlers.filter(h => h !== handler);
    }

    // posting methods
    build(points: GeoJSON.Feature<GeoJSON.Point>[], options?: any) {
        const msg: WorkerRequest = { type: "build", points, options } as any;
        this.worker.postMessage(msg);
    }

    clusters(bbox: BBox, zoom: number) {
        const msg: WorkerRequest = { type: "clusters", bbox, zoom } as any;
        this.worker.postMessage(msg);
    }

    leaves(cluster_id: number) {
        const msg: WorkerRequest = { type: "leaves", cluster_id } as any;
        this.worker.postMessage(msg);
    }

    isIndexBuilt(): boolean {
        return this.indexBuilt;
    }
}
