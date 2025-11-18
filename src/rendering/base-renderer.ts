import {
    Billboard,
    BillboardCollection,
    Cartesian3,
    Color, PointPrimitive,
    PointPrimitiveCollection,
    VerticalOrigin,
    Viewer
} from "cesium";
import { ClusterWorkerClient } from "../cluster-worker-client";
import { colorForCount, formatCount, makeClusterSprite, sizeForCount } from "../sprite-cache";
import Supercluster, { ClusterProperties } from 'supercluster';

export abstract class BaseRenderer {
    protected readonly hudClusters: HTMLElement;
    protected readonly hudSingles: HTMLElement;
    protected readonly billboardCollection: BillboardCollection;
    protected readonly pointCollection: PointPrimitiveCollection;

    protected constructor(
        protected readonly viewer: Viewer,
        protected readonly client: ClusterWorkerClient
    ) {
        this.hudClusters = document.getElementById("hudClusters")!;
        this.hudSingles = document.getElementById("hudSingles")!;
        this.billboardCollection = viewer.scene.primitives.add(new BillboardCollection());
        this.pointCollection = viewer.scene.primitives.add(new PointPrimitiveCollection());
    }

    protected drawFeature(pos: Cartesian3, props: Supercluster.ClusterProperties, id: string): Billboard | PointPrimitive | null {
        try {
            if (props.cluster) {
                const count: number = props.point_count;
                const size = sizeForCount(count);
                const color = colorForCount(count);
                const text = formatCount(count);
                const sprite = makeClusterSprite(size, color, text);

                const billboard = this.billboardCollection.add({
                    position: pos,
                    image: sprite,
                    verticalOrigin: VerticalOrigin.CENTER,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                });

                billboard.id = {
                    kind: "cluster",
                    id: props.cluster_id,
                    count
                };
                return billboard;
            } else {
                const point = this.pointCollection.add({
                    position: pos,
                    pixelSize: 6,
                    color: Color.SKYBLUE,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                });
                point.id = {
                    kind: "point",
                    id: id
                };
                return point;
            }
        } catch (error) {
            console.error("Error drawing feature:", error);
            return null;
        }
    }

    /**
     * Update the HUD with current counts
     */
    protected updateHUD(): void {
        this.hudClusters.textContent = String(this.billboardCollection.length);
        this.hudSingles.textContent = String(this.pointCollection.length);
    }

    /**
     * Clean up resources
     */
    public destroy(): void {
        this.billboardCollection.removeAll();
        this.pointCollection.removeAll();
    }
}
