import { Cartesian3, Viewer } from "cesium";
import { IRenderer } from "./renderer.interface";
import { BaseRenderer } from "./base-renderer";
import type { BBox } from "../global";
import { ClustersFeature, ClusterWorkerClient } from '../cluster-worker-client';

export class ClusterRenderer extends BaseRenderer implements IRenderer {
    constructor(
        viewer: Viewer,
        client: ClusterWorkerClient
    ) {
        super(viewer, client);
    }

    requestRenderByBboxAndZoom(bbox: BBox, zoom: number): void {
        this.client.clusters(bbox, zoom);
    }

    registerRenderingResult(): void {
        this.client.addClustersListener((features: ClustersFeature[]) => {
            this.drawClustersAndSingles(features);
        });
    }

    private drawClustersAndSingles(features: ClustersFeature[]): void {
        this.billboardCollection.removeAll();
        this.pointCollection.removeAll();

        for (const f of features) {
            const [lon, lat] = f.geometry.coordinates as [number, number];
            const pos = Cartesian3.fromDegrees(lon, lat);
            const props = f.properties || {};

            this.drawFeature(pos, props, (f as any).id ?? "");
        }

        this.updateHUD();
        this.viewer.scene.requestRender();
    }
}
